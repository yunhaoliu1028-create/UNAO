"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  calcLineAmount,
  detectOperationsDetailed,
  extractMetadata,
  generateFallbackLines,
  generateInvoiceViaApi,
  parseNumber,
  parseVehicleFromYMM,
  type InvoiceLine,
  type InvoiceMeta,
  type OperationDetectionCandidate
} from "@/lib/invoice";
import { InvoiceExportPages } from "@/components/invoice/invoice-export-pages";
import { SummaryExportPages, type SummaryOperationBlock as SharedSummaryOperationBlock } from "@/components/invoice/summary-export-pages";

type StatusTone = "" | "ok" | "error";

function resolveApiBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  if (!configuredUrl) {
    return "";
  }

  if (typeof window === "undefined") {
    return configuredUrl;
  }

  try {
    const configured = new URL(configuredUrl);
    const current = window.location;
    const isLocalApi = configured.hostname === "localhost" || configured.hostname === "127.0.0.1";
    if (isLocalApi && configured.port !== current.port) {
      return "";
    }
  } catch {
    return configuredUrl;
  }

  return configuredUrl;
}

function getTodayDateText(): string {
  return new Date().toLocaleDateString();
}

function buildDefaultMeta(): InvoiceMeta {
  return {
    invoiceNo: "INV-DRAFT-001",
    roNo: "",
    vin: "",
    yearMakeModel: "",
    insuranceCompany: "",
    repairDate: getTodayDateText(),
    currency: "USD",
    notes: ""
  };
}

type BodyShopInfo = {
  name: string;
  addressLine1: string;
};

type LogicTemplateLine = {
  partNo?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
};

type SavedLogicTemplate = {
  id: string;
  name: string;
  estimateKeywords: string[];
  operationKeywords: string[];
  lines: LogicTemplateLine[];
  createdAt: string;
  updatedAt: string;
};

const defaultBodyShopInfo: BodyShopInfo = {
  name: "",
  addressLine1: ""
};

const SUMMARY_PAGE_ROW_LIMIT = 28;
const DASHBOARD_INTAKE_STORAGE_KEY = "unao.dashboard.intake";
const DASHBOARD_INTAKE_DB_NAME = "unao-dashboard-intake";
const DASHBOARD_INTAKE_STORE_NAME = "files";
const DASHBOARD_INTAKE_RECORD_KEY = "latest";

type DashboardIntakeRecord = {
  blob?: Blob;
  name?: string;
  type?: string;
  savedAt?: number;
};

type DashboardIntakeResult = {
  file: File;
  savedAt: number;
};

function openDashboardIntakeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DASHBOARD_INTAKE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DASHBOARD_INTAKE_STORE_NAME)) {
        db.createObjectStore(DASHBOARD_INTAKE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open intake database."));
  });
}

async function consumeDashboardIntakeFromDb(): Promise<DashboardIntakeResult | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDashboardIntakeDb();
    const record = await new Promise<DashboardIntakeRecord | undefined>((resolve, reject) => {
      const tx = db!.transaction(DASHBOARD_INTAKE_STORE_NAME, "readwrite");
      const store = tx.objectStore(DASHBOARD_INTAKE_STORE_NAME);
      const getRequest = store.get(DASHBOARD_INTAKE_RECORD_KEY);
      let value: DashboardIntakeRecord | undefined;
      getRequest.onsuccess = () => {
        value = getRequest.result as DashboardIntakeRecord | undefined;
        store.delete(DASHBOARD_INTAKE_RECORD_KEY);
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? new Error("Failed to read intake database record."));
      tx.onabort = () => reject(tx.error ?? new Error("Intake database read aborted."));
    });
    if (!record?.blob) {
      return null;
    }
    return {
      file: new File([record.blob], String(record.name || "estimate.pdf"), {
        type: String(record.type || record.blob.type || "application/pdf")
      }),
      savedAt: Number(record.savedAt || 0)
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function consumeDashboardIntakeByToken(token: string): Promise<File | null> {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return null;
  }
  const response = await fetch(`/v1/estimates/intake?token=${encodeURIComponent(normalizedToken)}`);
  if (!response.ok) {
    return null;
  }
  const blob = await response.blob();
  const encodedName = response.headers.get("X-Intake-File-Name") || "";
  const name = encodedName ? decodeURIComponent(encodedName) : "estimate.pdf";
  const type = response.headers.get("X-Intake-File-Type") || blob.type || "application/pdf";
  return new File([blob], name, { type });
}

type SummaryOperationBlock = SharedSummaryOperationBlock;

function parsePartNumberFromSource(source: string): string {
  const match = String(source || "").match(/:3m(\d{3,6})\b/i);
  return match ? `3M ${match[1]}` : "";
}

function normalizePartNoInput(partNo: string): string {
  const text = String(partNo || "").trim().toUpperCase();
  if (!text) {
    return "";
  }
  const digitMatch = text.match(/\b(\d{3,6})\b/);
  if (digitMatch) {
    return `3M ${digitMatch[1]}`;
  }
  const compact = text.replace(/\s+/g, " ");
  return compact.startsWith("3M ") ? compact : compact;
}

function partNoLookupKey(partNo: string): string {
  const digits = String(partNo || "").replace(/[^\d]/g, "");
  return digits || String(partNo || "").trim().toUpperCase();
}

function resolveLinePartNo(line: Pick<InvoiceLine, "partNo" | "source">): string {
  const manualPartNo = String(line.partNo || "").trim();
  if (manualPartNo) {
    return manualPartNo;
  }
  return parsePartNumberFromSource(line.source);
}

function normalizeTextLine(value: string): string {
  return String(value || "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitKeywordsInput(value: string): string[] {
  return String(value || "")
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildOperationKeywordHint(operation: string): string {
  const normalized = operationDedupeKey(operation);
  const action = normalized.includes("replace")
    ? "replace"
    : normalized.includes("repair")
      ? "repair"
      : normalized.includes("remove install")
        ? "remove install"
        : "";
  const location = /\bquarter panel\b/.test(normalized)
    ? "quarter"
    : /\bbumper cover\b/.test(normalized)
      ? "bumper"
      : /\bfront door\b/.test(normalized)
        ? "front door"
        : /\brear door\b/.test(normalized)
          ? "rear door"
          : /\bfender\b/.test(normalized)
            ? "fender"
            : /\bliftgate\b/.test(normalized)
              ? "liftgate"
              : "";
  return [action, location].filter(Boolean).join(" ").trim();
}

function extractBodyShopInfo(firstPagePlainText: string, firstPageTableText: string): BodyShopInfo {
  const raw = `${firstPageTableText}\n${firstPagePlainText}`.trim();
  if (!raw) {
    return defaultBodyShopInfo;
  }

  const sourceLines = raw
    .split(/\r?\n/)
    .flatMap((line) => line.split("|"))
    .map((line) => normalizeTextLine(line))
    .filter(Boolean);
  const lines = Array.from(new Set(sourceLines)).slice(0, 60);

  const stopIndex = lines.findIndex((line) => /\b(vehicle information|repair application|ro\s*#|vin\b|year\b)\b/i.test(line));
  const headerLines = stopIndex > 0 ? lines.slice(0, stopIndex) : lines.slice(0, 16);
  const isSloganLine = (line: string): boolean =>
    /\b(relax,\s*we'?ll\s*take\s*it\s*from\s*here|auto\s*body\s*repair\s*experts)\b/i.test(line);
  const isLikelyAddressLine = (line: string): boolean => {
    if (!line || isSloganLine(line)) {
      return false;
    }
    if (/\b(phone|workfile id|federal id|resale number|license number|bar|ro number|customer|insurance|adjuster)\b/i.test(line)) {
      return false;
    }
    const hasStreetWord = /\b(ave|avenue|blvd|boulevard|st|street|rd|road|dr|drive|way|ct|court|ln|lane|hwy|highway|pkwy|parkway)\b/i.test(
      line
    );
    const hasHouseNumber = /^\d{2,6}\b/.test(line);
    const hasCityStateZip = /,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(line);
    return hasCityStateZip || (hasStreetWord && hasHouseNumber);
  };

  const shopName =
    headerLines.find(
      (line) =>
        /\b(collision|body|auto|carstar|caliber|repair|service|motors)\b/i.test(line) &&
        !/\b(estimate|invoice|materials)\b/i.test(line) &&
        !/\d{3,}/.test(line) &&
        !isSloganLine(line) &&
        !isLikelyAddressLine(line)
    ) || "";

  const addressCandidates = headerLines.filter((line) => {
    if (!line || line === shopName) {
      return false;
    }
    if (/\b(vehicle information|invoice|estimate)\b/i.test(line) || isSloganLine(line)) {
      return false;
    }
    return isLikelyAddressLine(line);
  });
  const shopNameIndex = shopName ? headerLines.indexOf(shopName) : -1;
  const scoredAddresses = addressCandidates
    .map((line) => {
      const index = headerLines.indexOf(line);
      const hasCityStateZip = /,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(line);
      const distancePenalty = shopNameIndex >= 0 && index >= 0 ? Math.min(Math.abs(index - shopNameIndex), 8) : 4;
      const completenessBonus = hasCityStateZip ? 20 : 8;
      const proximityBonus = 10 - distancePenalty;
      return {
        line,
        score: completenessBonus + proximityBonus
      };
    })
    .sort((a, b) => b.score - a.score);
  const addressLine1 = scoredAddresses[0]?.line || "";

  return {
    name: shopName,
    addressLine1
  };
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function simplifyOperationDisplay(value: string): string {
  const cleaned = value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\bA\/M\b/gi, " ")
    .replace(/\b(CAPA|KEYSIQ|NSF)\b/gi, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi, " ")
    .replace(/\b(?:frm|from)\b/gi, " ")
    .replace(/\blift[\s-]*gate\b/gi, "Liftgate")
    .replace(/\s+/g, " ")
    .trim();
  const titleCased = cleaned.replace(/\b([a-z])/g, (m) => m.toUpperCase());
  const materialTokens = new Set(["alu", "hss", "uhss"]);
  const tokens = titleCased.split(" ").filter(Boolean);
  const suffix: string[] = [];
  while (tokens.length > 0) {
    const tail = tokens[tokens.length - 1].toLowerCase();
    if (!materialTokens.has(tail)) {
      break;
    }
    suffix.unshift(tokens.pop()!.toUpperCase());
  }
  const base = tokens.join(" ").trim();
  if (suffix.length === 0) {
    return base;
  }
  return `${base} (${suffix.join("/")})`.trim();
}

function operationDedupeKey(value: string): string {
  return simplifyOperationDisplay(value)
    .toLowerCase()
    .replace(/\blift[\s-]*gate\b/g, "liftgate")
    .replace(/\bsect\b/g, "section")
    .replace(/\bsection\b/g, "replace")
    .replace(/\b(repl|rpl|remove\/replace|remove replace)\b/g, "replace")
    .replace(/\b(r&i|r\/i|remove\/install|remove install)\b/g, "remove install")
    .replace(/\b(without|w\/o|w o|with|w\/)\b.*$/g, "")
    .replace(/\b(assy|assembly|complete|us built|frm|from)\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasOperationActionToken(value: string): boolean {
  return /\b(remove\/replace|remove\/install|remove|replace|repair|section|sect|blend|refinish|overlap|add|sublet|repl|rpl|rpr|rep|r&i|r\/i|r&r|r\/r|blnd|refn|refin|o\/h)\b/i.test(
    value
  );
}

function isLikelyGroupHeading(label: string): boolean {
  const cleaned = String(label || "").trim();
  if (!cleaned || hasOperationActionToken(cleaned)) {
    return false;
  }
  if (/[#]/.test(cleaned) || /\d/.test(cleaned)) {
    return false;
  }
  if (cleaned.length < 3 || cleaned.length > 48) {
    return false;
  }
  const upper = cleaned.toUpperCase();
  const letters = cleaned.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) {
    return false;
  }
  return cleaned === upper;
}

type LineContextMeta = {
  lineNo: number;
  ver: string;
  groupLabel: string;
};

type GroupedDetectedOperation = {
  operation: string;
  key: string;
  duplicateFamilyKey: string;
  duplicateCount: number;
  isNormalizedDuplicate: boolean;
  context: LineContextMeta | null;
};

type GroupedDetectedOperationBucket = {
  groupLabel: string;
  items: GroupedDetectedOperation[];
};

function buildLineContextMap(parseText: string): Record<number, LineContextMeta> {
  const mapping: Record<number, LineContextMeta> = {};
  const lines = String(parseText || "").split(/\r?\n/);
  let currentGroup = "";

  for (const rawLine of lines) {
    const cells = rawLine.split("|").map((cell) => cell.trim());
    const lineNoText = cells[0] || "";
    const lineNo = Number.parseInt(lineNoText, 10);
    if (!Number.isFinite(lineNo)) {
      continue;
    }
    const actionCandidates = [1, 2, 3].filter((index) => index < cells.length);
    const actionIndex = actionCandidates.find((index) => hasOperationActionToken(cells[index] || "")) ?? -1;
    const headingCandidate = actionIndex < 0 ? cells[2] || cells[1] || "" : cells[2] || "";
    if (isLikelyGroupHeading(headingCandidate)) {
      currentGroup = headingCandidate;
    }
    const ver = actionIndex >= 2 ? (cells[1] || "").trim().toUpperCase() : "";
    const existing = mapping[lineNo];
    if (!existing) {
      mapping[lineNo] = { lineNo, ver, groupLabel: currentGroup };
    } else {
      mapping[lineNo] = {
        lineNo,
        ver: existing.ver || ver,
        groupLabel: existing.groupLabel || currentGroup
      };
    }
  }

  return mapping;
}

function formatOperationWithTriggerLabel(operation: string, context: LineContextMeta | null): string {
  if (!context || !context.lineNo) {
    return operation;
  }
  return `${operation} (Estimate line #${context.lineNo})`;
}

function tokenizeOperationKey(value: string): string[] {
  return operationDedupeKey(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function pickBestLineNosForOperation(operation: string, operationToLineNos: Record<string, number[]>): number[] {
  const exactKey = operationDedupeKey(operation);
  if (operationToLineNos[exactKey]?.length) {
    return operationToLineNos[exactKey];
  }
  const opTokens = tokenizeOperationKey(operation);
  if (opTokens.length === 0) {
    return [];
  }
  let bestKey = "";
  let bestScore = 0;
  for (const [key, lineNos] of Object.entries(operationToLineNos)) {
    if (!lineNos.length) {
      continue;
    }
    const score = opTokens.filter((token) => key.includes(token)).length;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestScore >= 2 ? operationToLineNos[bestKey] || [] : [];
}

function toDirectionAbbreviation(value: string): string {
  return value
    .replace(/\bLeft\b/gi, "LT")
    .replace(/\bRight\b/gi, "RT")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeOperationsForUi(ops: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const op of ops) {
    const display = simplifyOperationDisplay(op);
    const key = operationDedupeKey(display);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(display);
  }
  return output;
}

function normalizeGroupLabel(value: string): string {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    return "UNGROUPED";
  }
  return cleaned.replace(/\s+/g, " ").toUpperCase();
}

function shouldSkipConsumableOperation(operation: string): boolean {
  const normalizedOp = operationDedupeKey(operation);
  if (/\brivets?\b/.test(normalizedOp)) {
    return true;
  }
  return /\bfender liner\b/.test(normalizedOp) && /\b(replace|remove install)\b/.test(normalizedOp);
}

function resolveDetectedGroupLabel(rawGroupLabel: string, operation: string): string {
  const normalizedRawGroup = normalizeGroupLabel(rawGroupLabel);
  if (normalizedRawGroup !== "UNGROUPED") {
    return normalizedRawGroup;
  }
  const normalizedOp = operationDedupeKey(operation);
  const isRearBumperCoverAction = /\bbumper cover\b/.test(normalizedOp) && /\b(replace|remove install|repair)\b/.test(normalizedOp) && /\brear\b/.test(normalizedOp);
  if (isRearBumperCoverAction) {
    return "REAR BUMPER";
  }
  const isFrontBumperCoverAction = /\bbumper cover\b/.test(normalizedOp) && /\b(replace|remove install|repair)\b/.test(normalizedOp) && /\bfront\b/.test(normalizedOp);
  if (isFrontBumperCoverAction) {
    return "FRONT BUMPER & GRILLE";
  }
  return normalizedRawGroup;
}

function formatGroupLabelForDisplay(groupLabel: string): string {
  const normalized = normalizeGroupLabel(groupLabel);
  if (normalized === "FRONT BUMPER & GRILLE") {
    return "Front Bumper";
  }
  if (normalized === "REAR BUMPER") {
    return "Rear Bumper";
  }
  return toDirectionAbbreviation(
    normalized
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase())
      .replace(/\s+/g, " ")
      .trim()
  );
}

function formatOperationForInvoiceGroup(operation: string, groupLabel: string): string {
  const displayOp = toDirectionAbbreviation(simplifyOperationDisplay(operation));
  const normalizedOp = operationDedupeKey(operation);
  const normalizedGroup = normalizeGroupLabel(groupLabel);
  const groupDisplay = formatGroupLabelForDisplay(groupLabel);
  if (!groupDisplay || normalizedGroup === "UNGROUPED") {
    return displayOp;
  }
  const needsOuterPanelSuffix = /\bouter panel\b/.test(normalizedOp);
  const needsBumperCoverSuffix = /\bbumper cover\b/.test(normalizedOp);
  if (!(needsOuterPanelSuffix || needsBumperCoverSuffix)) {
    return displayOp;
  }
  const compactGroup = normalizedGroup.replace(/[^A-Z]/g, "");
  const compactOp = normalizedOp.replace(/[^a-z]/g, "");
  const compactGroupLower = compactGroup.toLowerCase();
  if (compactGroupLower && compactOp.includes(compactGroupLower)) {
    return displayOp;
  }
  return `${displayOp} (${groupDisplay})`;
}

function stableOperationGroupKey(operation: string): string {
  return operationDedupeKey(operation)
    .replace(/\b(nam built|us built|built|with blind spot|w\/blind spot|blind spot|panel panel)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldHideByDefaultInGroup(groupLabel: string, operation: string): boolean {
  const upperGroup = normalizeGroupLabel(groupLabel);
  const compactGroup = upperGroup.replace(/[^A-Z]/g, "");
  const normalizedOp = operationDedupeKey(operation);
  const isMiscOpsGroup = compactGroup === "MISCELANEOUSOPERATIONS" || compactGroup === "MISCELLANEOUSOPERATIONS";
  if (isMiscOpsGroup) {
    return true;
  }
  const isFuelDoorOp = /\b(repair|replace)\b/.test(normalizedOp) && /\bfuel door(?: rivet)?\b/.test(normalizedOp);
  if (compactGroup === "QUARTERPANEL" && isFuelDoorOp) {
    return true;
  }
  const isQuarterGlassOp = /\b(replace|repair|remove install)\b/.test(normalizedOp) && /\bquarter glass\b/.test(normalizedOp);
  return isQuarterGlassOp;
}

function buildWeldBurnLineNoSet(parseText: string): Set<number> {
  const output = new Set<number>();
  const lines = String(parseText || "").split(/\r?\n/);
  for (const rawLine of lines) {
    if (!/\bweld burn\b/i.test(rawLine)) {
      continue;
    }
    const lineNo = Number.parseInt(rawLine.split("|")[0]?.trim() || "", 10);
    if (Number.isFinite(lineNo)) {
      output.add(lineNo);
    }
  }
  return output;
}

function readFileAsPdf(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

type PdfTextItem = {
  text: string;
  x: number;
  y: number;
};

function normalizePdfToken(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function groupItemsByVisualLine(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => {
    const dy = Math.abs(a.y - b.y);
    if (dy > 1.8) {
      // PDF coordinate system usually has larger y near top.
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const current = rows[rows.length - 1];
    if (!current) {
      rows.push([item]);
      continue;
    }
    const anchorY = current[0]?.y ?? item.y;
    if (Math.abs(anchorY - item.y) <= 1.8) {
      current.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function rowToColumns(row: PdfTextItem[]): string[] {
  if (row.length === 0) {
    return [];
  }
  const columns: string[] = [];
  let current = normalizePdfToken(row[0]?.text || "");
  let prevX = row[0]?.x ?? 0;

  for (let i = 1; i < row.length; i += 1) {
    const token = normalizePdfToken(row[i]?.text || "");
    if (!token) {
      continue;
    }
    const x = row[i]?.x ?? prevX;
    const gap = x - prevX;
    // A larger x-gap is treated as a new table column.
    if (gap > 18) {
      if (current) {
        columns.push(current);
      }
      current = token;
    } else {
      current = current ? `${current} ${token}` : token;
    }
    prevX = x;
  }

  if (current) {
    columns.push(current);
  }
  return columns;
}

function buildTableAwarePageText(items: PdfTextItem[]): string {
  const rows = groupItemsByVisualLine(items);
  const lines = rows
    .map((row) => rowToColumns(row))
    .filter((cells) => cells.length > 0)
    .map((cells) => cells.join(" | "));
  return lines.join("\n");
}

type ExtractedPdfText = {
  plainText: string;
  tableText: string;
  firstPagePlainText: string;
  firstPageTableText: string;
};

async function extractPdfText(file: File): Promise<ExtractedPdfText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buffer = await readFileAsPdf(file);
  let pdf: Awaited<ReturnType<typeof pdfjs.getDocument>> extends { promise: Promise<infer T> } ? T : never;
  pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const plainPages: string[] = [];
  const tablePages: string[] = [];

  let firstPagePlainText = "";
  let firstPageTableText = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const textItems = content.items
      .map((item) => {
        if (!("str" in item) || !Array.isArray(item.transform)) {
          return null;
        }
        const text = normalizePdfToken(String(item.str || ""));
        if (!text) {
          return null;
        }
        const x = Number(item.transform[4] || 0);
        const y = Number(item.transform[5] || 0);
        return { text, x, y } as PdfTextItem;
      })
      .filter((item): item is PdfTextItem => Boolean(item));

    const plainPageText = textItems.map((item) => item.text).join(" ");
    const tablePageText = buildTableAwarePageText(textItems);
    plainPages.push(plainPageText);
    tablePages.push(tablePageText);
    if (pageNum === 1) {
      firstPagePlainText = plainPageText;
      firstPageTableText = tablePageText;
    }
  }

  return {
    plainText: plainPages.join("\n"),
    tableText: tablePages.join("\n\n"),
    firstPagePlainText,
    firstPageTableText
  };
}

async function extractPdfTextViaServer(file: File, apiBaseUrl: string): Promise<ExtractedPdfText> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/estimates/extract-text`, {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Server extract failed (${response.status}): ${message.slice(0, 300)}`);
  }
  const data = (await response.json()) as Partial<ExtractedPdfText>;
  return {
    plainText: String(data.plainText || ""),
    tableText: String(data.tableText || ""),
    firstPagePlainText: String(data.firstPagePlainText || ""),
    firstPageTableText: String(data.firstPageTableText || "")
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function EstimateToInvoiceContent() {
  const searchParams = useSearchParams();
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("Waiting for PDF...");
  const [statusTone, setStatusTone] = useState<StatusTone>("");
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [operations, setOperations] = useState<string[]>([]);
  const [operationContextByKey, setOperationContextByKey] = useState<Record<string, LineContextMeta | null>>({});
  const [operationDebugRows, setOperationDebugRows] = useState<OperationDetectionCandidate[]>([]);
  const [showOperationDebug, setShowOperationDebug] = useState(false);
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());
  const [weldBurnLineNos, setWeldBurnLineNos] = useState<Set<number>>(new Set());
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [recentlyAutofilledLineId, setRecentlyAutofilledLineId] = useState("");
  const [showSourceColumn, setShowSourceColumn] = useState(false);
  const [meta, setMeta] = useState<InvoiceMeta>(buildDefaultMeta);
  const [bodyShop, setBodyShop] = useState<BodyShopInfo>(defaultBodyShopInfo);
  const [tier, setTier] = useState<"T1" | "T2" | "T3">("T1");
  const [savedTemplates, setSavedTemplates] = useState<SavedLogicTemplate[]>([]);
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [templateEstimateKeywordsInput, setTemplateEstimateKeywordsInput] = useState("");
  const [templateOperationKeywordsInput, setTemplateOperationKeywordsInput] = useState("");
  const [templateTargetOperation, setTemplateTargetOperation] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [savedInvoiceId, setSavedInvoiceId] = useState("");
  const [loadingSavedInvoice, setLoadingSavedInvoice] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const usageSummaryExportRef = useRef<HTMLDivElement>(null);
  const invoiceExportRef = useRef<HTMLDivElement>(null);
  const autofillHighlightTimerRef = useRef<number | null>(null);
  const loadedInvoiceIdRef = useRef("");
  const autoDownloadKeyRef = useRef("");
  const dashboardIntakeConsumedRef = useRef(false);
  const apiBaseUrl = resolveApiBaseUrl();

  useEffect(() => {
    void refreshSavedTemplates();
  }, [apiBaseUrl]);

  useEffect(() => {
    const source = String(searchParams.get("source") || "").trim().toLowerCase();
    const intakeToken = String(searchParams.get("intakeToken") || "").trim();
    if (dashboardIntakeConsumedRef.current) {
      return;
    }
    dashboardIntakeConsumedRef.current = true;
    let cancelled = false;
    async function consumeDashboardIntake(): Promise<void> {
      const fromToken = await consumeDashboardIntakeByToken(intakeToken);
      if (fromToken) {
        if (cancelled) {
          return;
        }
        setFile(fromToken);
        setStatusMessage(`Loaded file: ${fromToken.name}. Parsing...`);
        void parseEstimate(fromToken);
        return;
      }

      const fromIndexedDb = await consumeDashboardIntakeFromDb();
      if (fromIndexedDb) {
        const intakeAgeMs = Date.now() - fromIndexedDb.savedAt;
        const isFreshIntake = Number.isFinite(intakeAgeMs) && intakeAgeMs >= 0 && intakeAgeMs <= 10 * 60 * 1000;
        if (!isFreshIntake) {
          return;
        }
        if (cancelled) {
          return;
        }
        setFile(fromIndexedDb.file);
        setStatusMessage(`Loaded file: ${fromIndexedDb.file.name}. Parsing...`);
        void parseEstimate(fromIndexedDb.file);
        return;
      }

      const payloadRaw = sessionStorage.getItem(DASHBOARD_INTAKE_STORAGE_KEY);
      if (!payloadRaw) {
        if (source === "dashboard") {
          setStatusMessage("Auto handoff missing. Please choose PDF again in NEW.", "error");
        }
        return;
      }
      sessionStorage.removeItem(DASHBOARD_INTAKE_STORAGE_KEY);
      try {
        const payload = JSON.parse(payloadRaw) as {
          blobUrl?: string;
          name?: string;
          type?: string;
        };
        const blobUrl = String(payload.blobUrl || "").trim();
        if (!blobUrl) {
          return;
        }
        const response = await fetch(blobUrl);
        if (!response.ok) {
          throw new Error(`Cannot load handoff file (${response.status}).`);
        }
        const blob = await response.blob();
        URL.revokeObjectURL(blobUrl);
        if (cancelled) {
          return;
        }
        const restoredFile = new File([blob], String(payload.name || "estimate.pdf"), {
          type: String(payload.type || blob.type || "application/pdf")
        });
        setFile(restoredFile);
        setStatusMessage(`Loaded file: ${restoredFile.name}. Parsing...`);
        void parseEstimate(restoredFile);
      } catch (error) {
        setStatusMessage(`Dashboard handoff failed: ${getErrorMessage(error)}`, "error");
      }
    }
    void consumeDashboardIntake();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + calcLineAmount(line), 0);
    const tax = 0;
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

  const groupedLines = useMemo(() => {
    const map = new Map<string, { operation: string; groupLabel: string; lines: InvoiceLine[] }>();
    for (const line of lines) {
      const operation = simplifyOperationDisplay(line.operation || "Unknown Operation");
      const contextGroupLabel = operationContextByKey[operationDedupeKey(operation)]?.groupLabel || "";
      const groupLabel = normalizeGroupLabel(contextGroupLabel || line.group || "Ungrouped");
      const key = `${operation}::${groupLabel}`;
      const existing = map.get(key);
      if (existing) {
        existing.lines.push(line);
      } else {
        map.set(key, { operation, groupLabel, lines: [line] });
      }
    }
    return Array.from(map.entries());
  }, [lines, operationContextByKey]);

  const summaryBlocks = useMemo<SummaryOperationBlock[]>(() => {
    const groupOrder = new Map<string, number>();
    const opBuckets = new Map<string, { groupLabel: string; operation: string; lines: InvoiceLine[] }>();
    const groupTotals = new Map<string, number>();

    lines.forEach((line, index) => {
      const operation = simplifyOperationDisplay(line.operation || "Unknown Operation");
      const contextGroupLabel = operationContextByKey[operationDedupeKey(operation)]?.groupLabel || "";
      const groupLabel = normalizeGroupLabel(contextGroupLabel || line.group || "Ungrouped");
      if (!groupOrder.has(groupLabel)) {
        groupOrder.set(groupLabel, index);
      }
      groupTotals.set(groupLabel, (groupTotals.get(groupLabel) || 0) + calcLineAmount(line));
      const key = `${groupLabel}::${operation}`;
      const existing = opBuckets.get(key);
      if (existing) {
        existing.lines.push(line);
      } else {
        opBuckets.set(key, { groupLabel, operation, lines: [line] });
      }
    });

    const ordered = Array.from(opBuckets.values()).sort((a, b) => {
      const groupOrderDelta = (groupOrder.get(a.groupLabel) ?? 99999) - (groupOrder.get(b.groupLabel) ?? 99999);
      if (groupOrderDelta !== 0) {
        return groupOrderDelta;
      }
      return a.operation.localeCompare(b.operation);
    });

    let previousGroup = "";
    return ordered.map((item, index) => {
      const context = operationContextByKey[operationDedupeKey(item.operation)] || null;
      const displayOperation = formatOperationWithTriggerLabel(toDirectionAbbreviation(item.operation), context);
      const showGroupHeader = item.groupLabel !== previousGroup;
      const nextGroupLabel = ordered[index + 1]?.groupLabel || "";
      const isGroupLastBlock = nextGroupLabel !== item.groupLabel;
      previousGroup = item.groupLabel;
      return {
        ...item,
        displayOperation,
        showGroupHeader,
        groupTotalAmount: groupTotals.get(item.groupLabel) || 0,
        isGroupLastBlock
      };
    });
  }, [lines, operationContextByKey]);

  const summaryPages = useMemo<SummaryOperationBlock[][]>(() => {
    if (summaryBlocks.length === 0) {
      return [];
    }
    const pages: SummaryOperationBlock[][] = [];
    let page: SummaryOperationBlock[] = [];
    let units = 0;

    for (const block of summaryBlocks) {
      const blockUnits = 1 + block.lines.length + (block.showGroupHeader ? 1 : 0);
      if (page.length > 0 && units + blockUnits > SUMMARY_PAGE_ROW_LIMIT) {
        pages.push(page);
        page = [];
        units = 0;
      }
      const showGroupHeader = page.length === 0 ? true : block.showGroupHeader;
      const pageBlock = { ...block, showGroupHeader };
      page.push(pageBlock);
      units += 1 + pageBlock.lines.length + (showGroupHeader ? 1 : 0);
    }
    if (page.length > 0) {
      pages.push(page);
    }
    return pages;
  }, [summaryBlocks]);

  const groupedDetectedOperations = useMemo<GroupedDetectedOperationBucket[]>(() => {
    const grouped = new Map<string, GroupedDetectedOperation[]>();
    const lineOrderByGroup = new Map<string, number>();

    for (const operation of operations) {
      const context = operationContextByKey[operationDedupeKey(operation)] || null;
      const groupLabel = resolveDetectedGroupLabel(context?.groupLabel || "", operation);
      const normalizedOp = operationDedupeKey(operation);
      const hideByGroupRule = shouldHideByDefaultInGroup(groupLabel, operation);
      const hideByConsumableRule = shouldSkipConsumableOperation(operation);
      const hideByWeldBurnText = /\bweld burn\b/.test(normalizedOp);
      const hideByWeldBurnNote =
        /\brepair\b/.test(normalizedOp) && typeof context?.lineNo === "number" && weldBurnLineNos.has(context.lineNo);
      if (hideByGroupRule || hideByConsumableRule || hideByWeldBurnText || hideByWeldBurnNote) {
        continue;
      }
      const byGroup = grouped.get(groupLabel) || [];
      const fallbackKey = operationDedupeKey(operation);
      byGroup.push({
        operation,
        key: `${fallbackKey}-${context?.lineNo ?? "na"}-${byGroup.length}`,
        duplicateFamilyKey: stableOperationGroupKey(operation) || fallbackKey,
        duplicateCount: 1,
        isNormalizedDuplicate: false,
        context
      });
      grouped.set(groupLabel, byGroup);

      const lineNo = context?.lineNo ?? Number.MAX_SAFE_INTEGER;
      const previous = lineOrderByGroup.get(groupLabel) ?? Number.MAX_SAFE_INTEGER;
      if (lineNo < previous) {
        lineOrderByGroup.set(groupLabel, lineNo);
      }
    }

    return Array.from(grouped.entries())
      .sort((a, b) => (lineOrderByGroup.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (lineOrderByGroup.get(b[0]) ?? Number.MAX_SAFE_INTEGER))
      .map(([groupLabel, items]) => {
        const duplicateFamilyCount = new Map<string, number>();
        for (const item of items) {
          duplicateFamilyCount.set(item.duplicateFamilyKey, (duplicateFamilyCount.get(item.duplicateFamilyKey) || 0) + 1);
        }
        const enhancedItems = items
          .map((item) => {
            const count = duplicateFamilyCount.get(item.duplicateFamilyKey) || 1;
            return {
              ...item,
              duplicateCount: count,
              isNormalizedDuplicate: count > 1
            };
          })
          .sort((a, b) => (a.context?.lineNo ?? Number.MAX_SAFE_INTEGER) - (b.context?.lineNo ?? Number.MAX_SAFE_INTEGER));
        return { groupLabel, items: enhancedItems };
      });
  }, [operations, operationContextByKey, weldBurnLineNos]);

  function setStatusMessage(message: string, tone: StatusTone = ""): void {
    setStatus(message);
    setStatusTone(tone);
  }

  async function refreshSavedTemplates(): Promise<void> {
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/logic-templates`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { templates?: SavedLogicTemplate[] };
      const templates = Array.isArray(data.templates) ? data.templates : [];
      setSavedTemplates(templates);
    } catch {
      // Ignore template list refresh failures to keep core flow stable.
    }
  }

  const loadSavedInvoice = useCallback(async (invoiceId: string): Promise<void> => {
    const normalizedId = String(invoiceId || "").trim();
    if (!normalizedId) {
      return;
    }
    setLoadingSavedInvoice(true);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/invoices/${encodeURIComponent(normalizedId)}`);
      if (!response.ok) {
        const errorText = await response.text();
        setStatusMessage(`Failed to load saved invoice: ${errorText.slice(0, 200)}`, "error");
        return;
      }
      const data = (await response.json()) as {
        invoice?: {
          id: string;
          meta?: Partial<InvoiceMeta>;
          bodyShop?: Partial<BodyShopInfo>;
          lines?: InvoiceLine[];
          parseState?: {
            rawText?: string;
            operations?: string[];
            selectedOperations?: string[];
          };
        };
      };
      const invoice = data.invoice;
      if (!invoice) {
        setStatusMessage("Saved invoice payload is empty.", "error");
        return;
      }
      setSavedInvoiceId(String(invoice.id || normalizedId));
      setMeta((prev) => ({
        ...prev,
        ...invoice.meta
      }));
      setBodyShop((prev) => ({
        ...prev,
        ...invoice.bodyShop
      }));
      setLines(
        (Array.isArray(invoice.lines) ? invoice.lines : []).map((line) => ({
          ...line,
          id: line.id || makeId()
        }))
      );
      setRawText(String(invoice.parseState?.rawText || ""));
      const loadedOperations = Array.isArray(invoice.parseState?.operations) ? invoice.parseState!.operations : [];
      const loadedSelectedOps = Array.isArray(invoice.parseState?.selectedOperations) ? invoice.parseState!.selectedOperations : [];
      setOperations(loadedOperations);
      setSelectedOps(new Set(loadedSelectedOps));
      setStatusMessage(`Loaded invoice ${invoice.id}. You can keep editing and save again.`, "ok");
    } catch (error) {
      setStatusMessage(`Failed to load saved invoice: ${getErrorMessage(error)}`, "error");
    } finally {
      setLoadingSavedInvoice(false);
    }
  }, [apiBaseUrl]);

  async function saveInvoiceToHistory(): Promise<void> {
    if (lines.length === 0) {
      setStatusMessage("Add or generate invoice lines before saving.", "error");
      return;
    }
    setSavingInvoice(true);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: savedInvoiceId || undefined,
          meta,
          bodyShop,
          lines,
          parseState: {
            rawText,
            operations,
            selectedOperations: Array.from(selectedOps)
          },
          status: "Completed"
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        setStatusMessage(`Failed to save invoice: ${errorText.slice(0, 220)}`, "error");
        return;
      }
      const data = (await response.json()) as { invoice?: { id?: string } };
      const nextId = String(data.invoice?.id || "").trim();
      if (nextId) {
        setSavedInvoiceId(nextId);
      }
      setStatusMessage(`Invoice saved to history${nextId ? ` (${nextId})` : ""}.`, "ok");
    } catch (error) {
      setStatusMessage(`Failed to save invoice: ${getErrorMessage(error)}`, "error");
    } finally {
      setSavingInvoice(false);
    }
  }

  async function saveAsRules(): Promise<void> {
    if (lines.length === 0) {
      setStatusMessage("No invoice lines to save as rules.", "error");
      return;
    }
    const vehicle = parseVehicleFromYMM(meta.yearMakeModel);
    if (!vehicle.make) {
      setStatusMessage("Vehicle make is required to save rules. Fill in the Vehicle Info field (e.g. '2022 Honda Civic').", "error");
      return;
    }
    setSavingRules(true);
    try {
      // Group lines by operation → location + operation
      const groupedByOp = new Map<string, typeof lines>();
      for (const line of lines) {
        const key = String(line.operation || "Manual");
        if (!groupedByOp.has(key)) groupedByOp.set(key, []);
        groupedByOp.get(key)!.push(line);
      }

      let totalSaved = 0;
      for (const [opText, opLines] of groupedByOp) {
        // Extract location from the operation text or group
        const group = opLines[0]?.group || "";
        const location = group.toLowerCase() || opText.replace(/\b(replace|repair|repl|rpl|r&r|section)\b/gi, "").trim().toLowerCase() || "unknown";
        const operation = /\b(replace|repl|rpl|section|r&r)\b/i.test(opText) ? "replace" : "repair";

        const payload = {
          location,
          operation,
          make: vehicle.make,
          model: vehicle.model,
          yearFrom: vehicle.year ? vehicle.year - 2 : undefined,
          yearTo: vehicle.year ? vehicle.year + 2 : undefined,
          invoiceId: savedInvoiceId || undefined,
          lines: opLines.map((line) => ({
            productPartNo: String(line.partNo || "").trim() || line.description.slice(0, 30),
            description: line.description,
            qty: line.qty,
            unit: line.unit,
            unitPrice: line.unitPrice,
          })),
        };

        const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/material-rules`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          const data = (await response.json()) as { saved?: number };
          totalSaved += data.saved || 0;
        }
      }

      setStatusMessage(
        `Saved ${totalSaved} material rule(s) for ${vehicle.make}${vehicle.model ? " " + vehicle.model : ""}. Future invoices for similar vehicles will auto-match these materials.`,
        "ok"
      );
    } catch (error) {
      setStatusMessage(`Failed to save rules: ${getErrorMessage(error)}`, "error");
    } finally {
      setSavingRules(false);
    }
  }

  useEffect(() => {
    const preferred = Array.from(selectedOps)[0] || operations[0] || "";
    if (!preferred) {
      return;
    }
    setTemplateTargetOperation((prev) => (prev ? prev : preferred));
  }, [operations, selectedOps]);

  useEffect(() => {
    if (!templateTargetOperation || String(templateOperationKeywordsInput || "").trim()) {
      return;
    }
    const hint = buildOperationKeywordHint(templateTargetOperation);
    if (hint) {
      setTemplateOperationKeywordsInput(hint);
    }
  }, [templateTargetOperation, templateOperationKeywordsInput]);

  useEffect(() => {
    const invoiceId = String(searchParams.get("invoiceId") || "").trim();
    if (!invoiceId || invoiceId === loadedInvoiceIdRef.current) {
      return;
    }
    loadedInvoiceIdRef.current = invoiceId;
    void loadSavedInvoice(invoiceId);
  }, [searchParams, loadSavedInvoice]);

  useEffect(() => {
    const mode = String(searchParams.get("autodownload") || "").trim();
    if (!mode || loadingSavedInvoice || lines.length === 0) {
      return;
    }
    const downloadTarget = mode === "invoice-pdf" ? "pdf" : mode === "invoice-jpg" ? "jpg" : "";
    if (!downloadTarget) {
      return;
    }
    const key = `${savedInvoiceId || "draft"}::${downloadTarget}`;
    if (autoDownloadKeyRef.current === key) {
      return;
    }
    autoDownloadKeyRef.current = key;
    const timer = window.setTimeout(() => {
      if (downloadTarget === "pdf") {
        void downloadDocumentPdf(invoiceExportRef.current, "consumable-invoice");
      } else {
        void downloadDocumentImages(invoiceExportRef.current, "consumable-invoice");
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [lines.length, loadingSavedInvoice, savedInvoiceId, searchParams]);

  async function saveCurrentOperationAsTemplate(): Promise<void> {
    const name = String(templateNameInput || "").trim();
    const estimateKeywords = splitKeywordsInput(templateEstimateKeywordsInput);
    const operationKeywords = splitKeywordsInput(templateOperationKeywordsInput);
    const targetOperation = String(templateTargetOperation || "").trim();

    if (!name) {
      setStatusMessage("Template name is required.", "error");
      return;
    }
    if (estimateKeywords.length === 0) {
      setStatusMessage("Please provide estimate keywords.", "error");
      return;
    }
    if (operationKeywords.length === 0) {
      setStatusMessage("Please provide operation keywords.", "error");
      return;
    }
    if (!targetOperation) {
      setStatusMessage("Please choose a target operation.", "error");
      return;
    }

    const targetKey = operationDedupeKey(targetOperation);
    const sourceLines = lines.filter((line) => operationDedupeKey(line.operation || "") === targetKey);
    if (sourceLines.length === 0) {
      setStatusMessage("No invoice lines found under selected operation. Edit and generate lines first.", "error");
      return;
    }

    setTemplateSaving(true);
    try {
      const payload = {
        name,
        estimateKeywords,
        operationKeywords,
        lines: sourceLines.map((line) => ({
          partNo: String(line.partNo || "").trim(),
          description: String(line.description || "").trim(),
          qty: parseNumber(line.qty, 0),
          unit: String(line.unit || "Each").trim() || "Each",
          unitPrice: parseNumber(line.unitPrice, 0)
        }))
      };
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/logic-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        setStatusMessage(`Failed to save template: ${errorText.slice(0, 220)}`, "error");
        return;
      }
      await refreshSavedTemplates();
      setTemplateNameInput("");
      setStatusMessage(`Template saved for "${targetOperation}".`, "ok");
    } catch (error) {
      setStatusMessage(`Failed to save template: ${getErrorMessage(error)}`, "error");
    } finally {
      setTemplateSaving(false);
    }
  }

  function markLineAutofilled(lineId: string, message: string): void {
    setRecentlyAutofilledLineId(lineId);
    setStatusMessage(message, "ok");
    if (autofillHighlightTimerRef.current !== null) {
      window.clearTimeout(autofillHighlightTimerRef.current);
    }
    autofillHighlightTimerRef.current = window.setTimeout(() => {
      setRecentlyAutofilledLineId("");
      autofillHighlightTimerRef.current = null;
    }, 1800);
  }

  function onChooseFile(selected: File | null): void {
    if (!selected) {
      return;
    }
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setStatusMessage("Only PDF is supported.", "error");
      return;
    }
    setFile(selected);
    setStatusMessage(`Loaded file: ${selected.name}`);
  }

  function toggleOperation(operation: string, checked: boolean): void {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(operation);
      } else {
        next.delete(operation);
      }
      return next;
    });
  }

  function resetAll(): void {
    setFile(null);
    setRawText("");
    setOperations([]);
    setOperationContextByKey({});
    setOperationDebugRows([]);
    setSelectedOps(new Set());
    setWeldBurnLineNos(new Set());
    setLines([]);
    setMeta(buildDefaultMeta());
    setBodyShop(defaultBodyShopInfo);
    setSavedInvoiceId("");
    loadedInvoiceIdRef.current = "";
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setStatusMessage("Cleared.");
  }

  async function parseEstimate(fileOverride?: File): Promise<void> {
    const targetFile = fileOverride ?? file;
    if (!targetFile) {
      setStatusMessage("Please select a PDF first.", "error");
      return;
    }

    try {
      setStatusMessage("Parsing PDF...");
      let extracted: ExtractedPdfText;
      let parsePath = "client";
      try {
        extracted = await extractPdfText(targetFile);
      } catch (clientError) {
        extracted = await extractPdfTextViaServer(targetFile, apiBaseUrl);
        parsePath = "server-fallback";
        console.warn("Client PDF parse failed, switched to server parser:", clientError);
      }
      // Keep both variants: plain text is useful for metadata;
      // table text preserves rows/columns for operation parsing.
      const parseText = `${extracted.tableText}\n\n${extracted.plainText}`.trim();
      const lineContextMap = buildLineContextMap(extracted.tableText);
      const weldBurnLines = buildWeldBurnLineNoSet(extracted.tableText);
      const localDetection = detectOperationsDetailed(parseText);
      const localOps = localDetection.operations;
      const detectedMeta = extractMetadata(`${extracted.firstPageTableText}\n${extracted.firstPagePlainText}\n${parseText}`);
      const detectedBodyShop = extractBodyShopInfo(extracted.firstPagePlainText, extracted.firstPageTableText);
      const currentVin = String(meta.vin || "").trim().toUpperCase();
      const parsedVin = String(detectedMeta.vin || "").trim().toUpperCase();
      if (savedInvoiceId && currentVin && parsedVin && currentVin !== parsedVin) {
        const createNewInvoice = window.confirm(
          `Detected different VIN.\nCurrent invoice VIN: ${currentVin}\nParsed estimate VIN: ${parsedVin}\n\nClick OK to create NEW invoice draft.\nClick Cancel to continue editing current invoice.`
        );
        if (createNewInvoice) {
          setSavedInvoiceId("");
          loadedInvoiceIdRef.current = "";
          // Prevent accidental overwrite of an existing saved invoice.
          setLines([]);
          setStatusMessage("Different VIN detected. Switched to new invoice draft.", "ok");
        } else {
          setStatusMessage("Different VIN detected. Continuing current invoice by your choice.", "ok");
        }
      }
      let detectedOps = localOps;
      let parseSource = "local";
      let operationToLineNos: Record<string, number[]> = {};

      try {
        const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/estimates/analyze?debug=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estimateText: parseText,
            localOperations: localOps
          })
        });
        if (response.ok) {
          const data = (await response.json()) as {
            operations?: string[];
            source?: string;
            note?: string | null;
            parse_debug?: {
              candidates?: Array<{
                lineNo?: number | null;
                canonical?: string;
                decision?: "keep" | "review" | "drop";
              }>;
            };
          };
          if (Array.isArray(data.operations) && data.operations.length > 0) {
            detectedOps = data.operations;
          }
          const candidates = Array.isArray(data.parse_debug?.candidates) ? data.parse_debug?.candidates : [];
          const byOperation = new Map<string, Set<number>>();
          for (const candidate of candidates) {
            const decision = candidate?.decision || "drop";
            const lineNo = candidate?.lineNo;
            const canonical = String(candidate?.canonical || "").trim();
            if (decision === "drop" || !canonical || typeof lineNo !== "number" || !Number.isFinite(lineNo)) {
              continue;
            }
            const key = operationDedupeKey(canonical);
            const existing = byOperation.get(key) || new Set<number>();
            existing.add(lineNo);
            byOperation.set(key, existing);
          }
          operationToLineNos = {};
          for (const [key, lineNos] of byOperation.entries()) {
            operationToLineNos[key] = Array.from(lineNos).sort((a, b) => a - b);
          }
          parseSource = data.source || "api";
          if (data.note) {
            // Keep the warning lightweight so it doesn't block flow.
            console.warn("Analyze note:", data.note);
          }
        }
      } catch {
        parseSource = "local";
      }

      const displayOps = dedupeOperationsForUi(detectedOps);
      setRawText(parseText);
      setOperations(displayOps);
      const contextByKey: Record<string, LineContextMeta | null> = {};
      for (const operation of displayOps) {
        const key = operationDedupeKey(operation);
        const lineNos = pickBestLineNosForOperation(operation, operationToLineNos);
        const primaryLineNo = lineNos.length > 0 ? lineNos[0] : null;
        contextByKey[key] = primaryLineNo ? lineContextMap[primaryLineNo] || null : null;
      }
      setOperationContextByKey(contextByKey);
      setOperationDebugRows(localDetection.candidates);
      setWeldBurnLineNos(weldBurnLines);
      const initiallySelected = displayOps.filter((operation) => {
        const context = contextByKey[operationDedupeKey(operation)];
        const groupLabel = resolveDetectedGroupLabel(context?.groupLabel || "", operation);
        const normalizedOp = operationDedupeKey(operation);
        const hideByGroupRule = shouldHideByDefaultInGroup(groupLabel, operation);
        const hideByConsumableRule = shouldSkipConsumableOperation(operation);
        const hideByWeldBurnText = /\bweld burn\b/.test(normalizedOp);
        const hideByWeldBurnNote =
          /\brepair\b/.test(normalizedOp) && typeof context?.lineNo === "number" && weldBurnLines.has(context.lineNo);
        return !(hideByGroupRule || hideByConsumableRule || hideByWeldBurnText || hideByWeldBurnNote);
      });
      setSelectedOps(new Set(initiallySelected));
      setMeta((prev) => ({ ...prev, ...detectedMeta, repairDate: prev.repairDate }));
      setBodyShop({
        name: detectedBodyShop.name || "",
        addressLine1: detectedBodyShop.addressLine1 || ""
      });
      const sourceLabel = parsePath === "client" ? parseSource : `${parseSource}, ${parsePath}`;
      setStatusMessage(`Parse complete (${sourceLabel}). Detected ${displayOps.length} operation(s).`, "ok");
    } catch (error) {
      setStatusMessage(`PDF parse failed: ${getErrorMessage(error)}.`, "error");
    }
  }

  async function generateLines(): Promise<void> {
    const opList = Array.from(selectedOps);
    if (opList.length === 0) {
      setStatusMessage("Select at least one operation.", "error");
      return;
    }

    setStatusMessage("Generating invoice lines...");
    const operationGroupHints = Object.fromEntries(
      opList
        .map((operation) => {
          const context = operationContextByKey[operationDedupeKey(operation)] || null;
          const groupLabel = resolveDetectedGroupLabel(context?.groupLabel || "", operation);
          return [operation, groupLabel] as const;
        })
        .filter(([, groupLabel]) => groupLabel && groupLabel !== "UNGROUPED")
    );
    const vehicle = parseVehicleFromYMM(meta.yearMakeModel);
    const apiResult = await generateInvoiceViaApi(apiBaseUrl, {
      estimateText: rawText,
      operations: opList,
      tier,
      operationGroupHints,
      vehicle: Object.keys(vehicle).length > 0 ? vehicle : undefined,
    });

    const generated = (apiResult?.lines ?? generateFallbackLines(opList)).map((line) => ({
      ...line,
      partNo: String(line.partNo || parsePartNumberFromSource(line.source || "")).trim(),
      id: line.id || makeId()
    }));
    setLines(generated);

    if (apiResult) {
      const unmatchedCount = apiResult.unmatched_operations?.length ?? 0;
      const warningsCount = apiResult.warnings?.length ?? 0;
      const templateNote = (apiResult.warnings || []).find((warning) => /custom template override/i.test(String(warning || "")));
      setStatusMessage(
        `Generated ${generated.length} line(s) from API. Unmatched ops: ${unmatchedCount}. Warnings: ${warningsCount}.${templateNote ? ` ${templateNote}` : ""}`,
        "ok"
      );
    } else {
      setStatusMessage(`Generated ${generated.length} line(s) from local fallback rules.`, "ok");
    }
  }

  function addLine(): void {
    setLines((prev) => [
      ...prev,
      {
        id: makeId(),
        operation: "Manual",
        group: undefined,
        partNo: "",
        description: "",
        qty: 1,
        unit: "Each",
        unitPrice: 0,
        source: "manual"
      }
    ]);
  }

  function addLineToGroup(groupLabel: string, operation: string): void {
    const normalizedGroup = normalizeGroupLabel(groupLabel);
    setLines((prev) => [
      ...prev,
      {
        id: makeId(),
        operation: operation || "Manual",
        group: normalizedGroup === "UNGROUPED" ? undefined : normalizedGroup,
        partNo: "",
        description: "",
        qty: 1,
        unit: "Each",
        unitPrice: 0,
        source: normalizedGroup === "UNGROUPED" ? "manual" : `manual:${normalizedGroup}`
      }
    ]);
  }

  function deleteSelectedLines(): void {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[data-line-select="1"]:checked');
    const ids = Array.from(checkboxes).map((cb) => cb.dataset.id).filter(Boolean) as string[];
    if (ids.length === 0) {
      setStatusMessage("Select line(s) to delete.", "error");
      return;
    }
    setLines((prev) => prev.filter((line) => !ids.includes(line.id)));
    setStatusMessage(`Deleted ${ids.length} line(s).`, "ok");
  }

  function updateLine(lineId: string, field: keyof InvoiceLine, value: string): void {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) {
          return line;
        }
        if (field === "qty" || field === "unitPrice") {
          return { ...line, [field]: parseNumber(value, 0) };
        }
        return { ...line, [field]: value };
      })
    );
  }

  async function autofillLineByPartNo(lineId: string, rawPartNo: string): Promise<void> {
    const normalizedPartNo = normalizePartNoInput(rawPartNo);
    if (!normalizedPartNo) {
      return;
    }
    const currentLine = lines.find((item) => item.id === lineId);
    if (!currentLine) {
      return;
    }

    const localKnownFromOtherLines = (() => {
      const targetKey = partNoLookupKey(normalizedPartNo);
      for (const line of lines) {
        if (line.id === lineId) {
          continue;
        }
        const candidateKey = partNoLookupKey(normalizePartNoInput(resolveLinePartNo(line)));
        if (!candidateKey || candidateKey !== targetKey) {
          continue;
        }
        const description = String(line.description || "").trim();
        const unitPrice = parseNumber(line.unitPrice, 0);
        if (!description && unitPrice <= 0) {
          continue;
        }
        return {
          partNo: normalizePartNoInput(resolveLinePartNo(line)),
          description,
          unit: String(line.unit || "").trim() || "Each",
          unitPrice
        };
      }
      return null;
    })();

    const applyFill = (payload: { partNo: string; description: string; unit: string; unitPrice: number }) => {
      const nextPartNo = payload.partNo;
      const nextDescription = payload.description || "";
      const nextUnit = payload.unit || "Each";
      const nextUnitPrice = parseNumber(payload.unitPrice, 0);
      const changed =
        String(currentLine.partNo || "").trim() !== String(nextPartNo || "").trim() ||
        String(currentLine.description || "").trim() !== String(nextDescription || "").trim() ||
        String(currentLine.unit || "").trim() !== String(nextUnit || "").trim() ||
        parseNumber(currentLine.unitPrice, 0) !== nextUnitPrice;

      setLines((prev) =>
        prev.map((line) => {
          if (line.id !== lineId) {
            return line;
          }
          return {
            ...line,
            partNo: nextPartNo,
            // Keep qty unchanged when user changes part number.
            qty: line.qty,
            description: nextDescription,
            unit: nextUnit,
            unitPrice: nextUnitPrice
          };
        })
      );
      return changed;
    };

    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, "")}/v1/materials/lookup?partNo=${encodeURIComponent(normalizedPartNo)}`
      );
      if (!response.ok) {
        throw new Error(`lookup failed with status ${response.status}`);
      }
      const data = (await response.json()) as {
        partNo?: string;
        description?: string;
        unit?: string;
        unitPrice?: number;
        found?: boolean;
      };
      if (!data.found) {
        if (localKnownFromOtherLines) {
          const changed = applyFill(localKnownFromOtherLines);
          if (changed) {
            markLineAutofilled(lineId, `Matched ${localKnownFromOtherLines.partNo} from existing invoice lines.`);
          }
        } else {
          setLines((prev) =>
            prev.map((line) => {
              if (line.id !== lineId) {
                return line;
              }
              return { ...line, partNo: normalizedPartNo, qty: line.qty };
            })
          );
          setStatusMessage(`Part # ${normalizedPartNo} not found in catalog.`, "error");
        }
        return;
      }
      const changed = applyFill({
        partNo: normalizePartNoInput(String(data.partNo || normalizedPartNo)),
        description: String(data.description || ""),
        unit: String(data.unit || "Each"),
        unitPrice: parseNumber(data.unitPrice, 0)
      });
      if (changed) {
        markLineAutofilled(lineId, `Matched ${normalizePartNoInput(String(data.partNo || normalizedPartNo))}. Line updated.`);
      } else {
        setStatusMessage(`Matched ${normalizePartNoInput(String(data.partNo || normalizedPartNo))}. No value changes needed.`, "ok");
      }
    } catch {
      if (localKnownFromOtherLines) {
        const changed = applyFill(localKnownFromOtherLines);
        if (changed) {
          markLineAutofilled(lineId, `Catalog unavailable. Matched ${localKnownFromOtherLines.partNo} from existing lines.`);
        }
      }
    }
  }

  function onMetaChange(field: keyof InvoiceMeta, value: string): void {
    setMeta((prev) => ({ ...prev, [field]: value }));
  }

  function onBodyShopChange(field: keyof BodyShopInfo, value: string): void {
    setBodyShop((prev) => ({ ...prev, [field]: value }));
  }

  function buildExportName(prefix: string, ext: string): string {
    const base = (meta.invoiceNo || "invoice-draft").replace(/[^\w\-]+/g, "_");
    const normalizedPrefix = prefix.replace(/[^\w\-]+/g, "_");
    return `${normalizedPrefix}-${base}.${ext}`;
  }

  async function renderPagesAsImages(container: HTMLDivElement | null, imageType: "png" | "jpeg" = "png"): Promise<string[]> {
    if (!container) {
      return [];
    }
    const pageNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-export-page="1"]'));
    if (pageNodes.length === 0) {
      return [];
    }
    const html2canvas = (await import("html2canvas")).default;
    const output: string[] = [];
    for (const node of pageNodes) {
      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: 2
      });
      const mime = imageType === "jpeg" ? "image/jpeg" : "image/png";
      const quality = imageType === "jpeg" ? 0.95 : 1;
      output.push(canvas.toDataURL(mime, quality));
    }
    return output;
  }

  async function downloadDocumentImages(container: HTMLDivElement | null, prefix: string): Promise<void> {
    const pageDataUrls = await renderPagesAsImages(container, "jpeg");
    if (pageDataUrls.length === 0) {
      setStatusMessage("No pages available for image export.", "error");
      return;
    }
    for (let index = 0; index < pageDataUrls.length; index += 1) {
      const anchor = document.createElement("a");
      anchor.href = pageDataUrls[index];
      anchor.download = buildExportName(`${prefix}-p${index + 1}`, "jpg");
      anchor.click();
    }
    setStatusMessage(`Exported ${pageDataUrls.length} image page(s).`, "ok");
  }

  async function downloadDocumentPdf(container: HTMLDivElement | null, prefix: string): Promise<void> {
    const pageDataUrls = await renderPagesAsImages(container);
    if (pageDataUrls.length === 0) {
      setStatusMessage("No pages available for PDF export.", "error");
      return;
    }
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    pageDataUrls.forEach((dataUrl, index) => {
      if (index > 0) {
        pdf.addPage();
      }
      const imageProps = pdf.getImageProperties(dataUrl);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const scale = Math.min(pageWidth / imageProps.width, pageHeight / imageProps.height);
      const renderWidth = imageProps.width * scale;
      const renderHeight = imageProps.height * scale;
      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;
      pdf.addImage(dataUrl, "PNG", x, y, renderWidth, renderHeight, undefined, "FAST");
    });
    pdf.save(buildExportName(prefix, "pdf"));
    setStatusMessage(`Exported ${prefix} PDF (${pageDataUrls.length} page(s)).`, "ok");
  }

  function renderSummaryPages(includeExportAttr: boolean) {
    return (
      <SummaryExportPages
        meta={meta}
        bodyShop={bodyShop}
        summaryPages={summaryPages}
        includeExportAttr={includeExportAttr}
        grandTotal={totals.total}
      />
    );
  }

  function renderInvoicePages(includeExportAttr: boolean) {
    return <InvoiceExportPages meta={meta} bodyShop={bodyShop} lines={lines} includeExportAttr={includeExportAttr} />;
  }

  return (
    <main className="page">
      <nav className="page-nav-bar">
        <Link href="/dashboard" className="page-nav-brand">UNAO</Link>
        <div className="page-nav-links">
          <Link href="/dashboard" className="page-nav-link">Home</Link>
          <Link href="/estimates/new" className="page-nav-link active">New Invoice</Link>
          <Link href="/history" className="page-nav-link">History</Link>
          <Link href="/rules" className="page-nav-link">Rules</Link>
          <Link href="/knowledge" className="page-nav-link">Knowledge</Link>
        </div>
      </nav>
      <div className="header">
        <h1>Estimate → Consumable Invoice</h1>
        <p>Upload a PDF estimate, review detected operations, then generate and edit the consumable invoice.</p>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Step 1 — Estimate Intake</h2>
          <div
            className={`drop-zone${dragging ? " dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              onChooseFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <p>
              <strong>Drag PDF here</strong> or click to choose
            </p>
            <p style={{ marginTop: 6, color: "#4b5563" }}>Supported: .pdf</p>
          </div>

          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => onChooseFile(event.target.files?.[0] ?? null)}
          />

          <div className="actions">
            <button className="btn-primary" onClick={() => void parseEstimate()} disabled={!file}>
              Parse Estimate
            </button>
            <button className="btn-soft" onClick={resetAll}>
              Clear
            </button>
          </div>
          <div className={`status${statusTone ? ` ${statusTone}` : ""}`}>{status}</div>
          {(loadingSavedInvoice || savedInvoiceId) && (
            <div className="small-note" style={{ marginTop: 6 }}>
              {loadingSavedInvoice ? "Loading saved invoice..." : `Editing saved invoice: ${savedInvoiceId}`}
            </div>
          )}
          <div className="small-note">API base URL: {apiBaseUrl || "(not set, fallback mode)"}</div>

          <div className="meta-grid">
            <div>
              <label htmlFor="invoiceNo">Invoice #</label>
              <input
                id="invoiceNo"
                type="text"
                value={meta.invoiceNo}
                onChange={(event) => onMetaChange("invoiceNo", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="roNo">RO #</label>
              <input id="roNo" type="text" value={meta.roNo} onChange={(event) => onMetaChange("roNo", event.target.value)} />
            </div>
            <div>
              <label htmlFor="vin">VIN</label>
              <input id="vin" type="text" value={meta.vin} onChange={(event) => onMetaChange("vin", event.target.value)} />
            </div>
            <div>
              <label htmlFor="yearMakeModel">Vehicle Info</label>
              <input
                id="yearMakeModel"
                type="text"
                value={meta.yearMakeModel}
                onChange={(event) => onMetaChange("yearMakeModel", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="insuranceCompany">Insurance Company</label>
              <input
                id="insuranceCompany"
                type="text"
                value={meta.insuranceCompany || ""}
                onChange={(event) => onMetaChange("insuranceCompany", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="repairDate">Invoice Date</label>
              <input
                id="repairDate"
                type="text"
                value={meta.repairDate}
                onChange={(event) => onMetaChange("repairDate", event.target.value)}
              />
            </div>
          </div>
          <div className="small-note" style={{ marginTop: 6 }}>
            Currency is fixed to USD.
          </div>

          <h2 style={{ marginTop: 14 }}>Bodyshop Info</h2>
          <div className="meta-grid">
            <div>
              <label htmlFor="shopName">Shop Name</label>
              <input
                id="shopName"
                type="text"
                value={bodyShop.name}
                onChange={(event) => onBodyShopChange("name", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="shopAddress1">Address Line 1</label>
              <input
                id="shopAddress1"
                type="text"
                value={bodyShop.addressLine1}
                onChange={(event) => onBodyShopChange("addressLine1", event.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" value={meta.notes} onChange={(event) => onMetaChange("notes", event.target.value)} />
          </div>

          <h2 style={{ marginTop: 14 }}>Step 2 — Detected Repair Operations</h2>
          <label className="detected-toggle-label">
            <input
              type="checkbox"
              checked={showOperationDebug}
              onChange={(event) => setShowOperationDebug(event.target.checked)}
            />
            Show CCC operation debug (raw -&gt; normalized)
          </label>
          <div style={{ marginBottom: 12 }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Detected Operations by Main Group</h3>
            {groupedDetectedOperations.length === 0 ? (
              <div className="small-note">No detected operation groups yet. Parse estimate first.</div>
            ) : (
              groupedDetectedOperations.map((bucket) => (
                <div key={`detected-${bucket.groupLabel}`} className="detected-group-card">
                  <div className="detected-group-header">{bucket.groupLabel}</div>
                  <div className="detected-group-body">
                    {bucket.items.map((item) => (
                      <label key={`detected-op-${bucket.groupLabel}-${item.key}`} className="op-item">
                        <input
                          type="checkbox"
                          checked={selectedOps.has(item.operation)}
                          onChange={(event) => toggleOperation(item.operation, event.target.checked)}
                        />
                        <span>
                          {formatOperationWithTriggerLabel(toDirectionAbbreviation(item.operation), item.context)}
                          {item.isNormalizedDuplicate ? (
                            <em className="detected-duplicate-note">
                              [Normalized duplicate x{item.duplicateCount}]
                            </em>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          {showOperationDebug && (
            <div className="raw-preview" style={{ marginTop: 10, maxHeight: 220 }}>
              {operationDebugRows.length === 0 ? (
                "No debug rows yet."
              ) : (
                operationDebugRows.map((row, index) => (
                  <div key={`${row.source}-${index}`} style={{ marginBottom: 6 }}>
                    [{row.source}] {row.kept ? "KEEP" : "DROP"} | {row.reason}
                    <br />
                    raw: {row.raw}
                    <br />
                    normalized: {row.normalized}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="actions">
            <button className="btn-primary" onClick={generateLines} disabled={operations.length === 0}>
              Generate Consumable Lines
            </button>
            <label className="tier-label">
              Tier
              <select
                style={{ marginLeft: 6 }}
                value={tier}
                onChange={(event) => setTier(event.target.value as "T1" | "T2" | "T3")}
              >
                <option value="T1">T1</option>
                <option value="T2">T2</option>
                <option value="T3">T3</option>
              </select>
            </label>
          </div>

          <details className="template-save-details" style={{ marginTop: 14 }}>
            <summary className="template-save-summary">
              Save Custom Auto Logic Template
              {savedTemplates.length > 0 ? <span className="template-count-badge">{savedTemplates.length}</span> : null}
            </summary>
            <div className="template-save-body">
              <div className="small-note" style={{ marginBottom: 8 }}>
                Save your manual edits as a reusable template. Next time, when estimate and operation keywords match, this template is auto-applied.
              </div>
              <div className="meta-grid">
                <div>
                  <label htmlFor="templateName">Template Name</label>
                  <input
                    id="templateName"
                    type="text"
                    value={templateNameInput}
                    onChange={(event) => setTemplateNameInput(event.target.value)}
                    placeholder="e.g. StateFarm Tesla Quarter Panel"
                  />
                </div>
                <div>
                  <label htmlFor="templateTargetOperation">Target Operation</label>
                  <select
                    id="templateTargetOperation"
                    value={templateTargetOperation}
                    onChange={(event) => setTemplateTargetOperation(event.target.value)}
                  >
                    <option value="">Select operation</option>
                    {operations.map((op) => (
                      <option key={`template-op-${op}`} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="templateEstimateKeywords">Estimate Keywords (comma separated)</label>
                  <input
                    id="templateEstimateKeywords"
                    type="text"
                    value={templateEstimateKeywordsInput}
                    onChange={(event) => setTemplateEstimateKeywordsInput(event.target.value)}
                    placeholder="e.g. statefarm, tesl 3"
                  />
                </div>
                <div>
                  <label htmlFor="templateOperationKeywords">Operation Keywords (comma separated)</label>
                  <input
                    id="templateOperationKeywords"
                    type="text"
                    value={templateOperationKeywordsInput}
                    onChange={(event) => setTemplateOperationKeywordsInput(event.target.value)}
                    placeholder="e.g. repl quarter"
                  />
                </div>
              </div>
              <div className="actions">
                <button className="btn-primary" onClick={() => void saveCurrentOperationAsTemplate()} disabled={templateSaving}>
                  {templateSaving ? "Saving..." : "Save Current Operation as Template"}
                </button>
                <button className="btn-soft" onClick={() => void refreshSavedTemplates()}>
                  Refresh Templates
                </button>
              </div>
              <div className="small-note">
                Saved templates: {savedTemplates.length}
                {savedTemplates.length > 0 ? ` | Latest: ${savedTemplates.slice(0, 3).map((item) => item.name).join(", ")}` : ""}
              </div>
            </div>
          </details>
        </section>

        <section className="card">
          <div className="invoice-title">
            <h2>Step 3 — Editable Consumable Invoice</h2>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn-primary" onClick={() => void saveInvoiceToHistory()} disabled={savingInvoice || loadingSavedInvoice}>
                {savingInvoice ? "Saving..." : savedInvoiceId ? "Update Saved Invoice" : "Save Invoice"}
              </button>
              <button
                className="btn-soft"
                onClick={() => void saveAsRules()}
                disabled={savingRules || lines.length === 0}
                title="Save current materials as rules for this vehicle type. Future invoices will auto-match."
              >
                {savingRules ? "Saving Rules..." : "Save as Rule"}
              </button>
              <button className="btn-soft" onClick={addLine}>
                Add Line
              </button>
              <button className="btn-danger" onClick={deleteSelectedLines}>
                Delete Selected
              </button>
              <button className="btn-soft" onClick={() => setShowSourceColumn((prev) => !prev)}>
                {showSourceColumn ? "Hide Source" : "Show Source"}
              </button>
              <details className="download-menu">
                <summary className="btn-primary">Download Summary</summary>
                <div className="download-menu-items">
                  <button className="download-item" onClick={() => downloadDocumentPdf(usageSummaryExportRef.current, "usage-summary")}>
                    Download as PDF
                  </button>
                  <button
                    className="download-item"
                    onClick={() => downloadDocumentImages(usageSummaryExportRef.current, "usage-summary")}
                  >
                    Download as JPG
                  </button>
                </div>
              </details>
              <details className="download-menu">
                <summary className="btn-primary">Download Invoice</summary>
                <div className="download-menu-items">
                  <button className="download-item" onClick={() => downloadDocumentPdf(invoiceExportRef.current, "consumable-invoice")}>
                    Download as PDF
                  </button>
                  <button
                    className="download-item"
                    onClick={() => downloadDocumentImages(invoiceExportRef.current, "consumable-invoice")}
                  >
                    Download as JPG
                  </button>
                </div>
              </details>
            </div>
          </div>

          <div className="table-wrap">
            {(() => {
              const invoiceTableColSpan = showSourceColumn ? 9 : 8;
              return (
            <table className="invoice-edit-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 28 }}>Sel</th>
                  <th className="invoice-partno-col">Part #</th>
                  <th className="invoice-description-col">Description</th>
                  <th style={{ width: 70 }}>Qty</th>
                  <th style={{ width: 68 }}>Unit</th>
                  <th style={{ width: 92 }}>Unit Price</th>
                  <th style={{ width: 90 }}>Line Total</th>
                  {showSourceColumn ? <th className="invoice-source-col">Source</th> : null}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={invoiceTableColSpan} className="invoice-empty-cell">
                      No invoice lines. Generate from operations or add manually.
                    </td>
                  </tr>
                ) : (
                  groupedLines.flatMap(([groupKey, grouped]) => [
                    <tr key={`group-${groupKey}`}>
                      <td colSpan={invoiceTableColSpan} className="invoice-group-row">
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10
                          }}
                        >
                          <span>{formatOperationForInvoiceGroup(grouped.operation, grouped.groupLabel)}</span>
                          <button
                            type="button"
                            className="btn-soft"
                            style={{ padding: "4px 10px", fontSize: 12 }}
                            onClick={() => addLineToGroup(grouped.groupLabel, grouped.operation)}
                          >
                            + Add line to this group
                          </button>
                        </div>
                      </td>
                    </tr>,
                    ...grouped.lines.map((line, index) => (
                      <tr
                        key={line.id}
                        style={
                          line.id === recentlyAutofilledLineId
                            ? { background: "rgba(34, 197, 94, 0.12)", transition: "background 160ms ease" }
                            : undefined
                        }
                      >
                        <td>{index + 1}</td>
                        <td>
                          <input type="checkbox" data-line-select="1" data-id={line.id} />
                        </td>
                        <td className="invoice-partno-col">
                          <input
                            className="invoice-partno-input"
                            type="text"
                            value={line.partNo || ""}
                            onChange={(event) => updateLine(line.id, "partNo", event.target.value)}
                            onBlur={(event) => void autofillLineByPartNo(line.id, event.target.value)}
                            placeholder="e.g. 3M 08115"
                          />
                        </td>
                        <td className="invoice-description-col">
                          <input
                            className="invoice-description-input"
                            type="text"
                            value={line.description}
                            onChange={(event) => updateLine(line.id, "description", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={line.qty}
                            onChange={(event) => updateLine(line.id, "qty", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={line.unit}
                            onChange={(event) => updateLine(line.id, "unit", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(event) => updateLine(line.id, "unitPrice", event.target.value)}
                          />
                        </td>
                        <td className="amount-cell">
                          <strong>{formatMoney(calcLineAmount(line))}</strong>
                        </td>
                        {showSourceColumn ? <td className="invoice-source-col">{line.source}</td> : null}
                      </tr>
                    ))
                  ])
                )}
              </tbody>
            </table>
              );
            })()}
          </div>

          <div className="totals">
            <div className="totals-row">
              <span>Subtotal</span>
              <strong>{formatMoney(totals.subtotal)}</strong>
            </div>
            <div className="totals-row">
              <span>Tax</span>
              <strong>{formatMoney(totals.tax)}</strong>
            </div>
            <div className="totals-row final">
              <span>Total</span>
              <strong>{formatMoney(totals.total)}</strong>
            </div>
          </div>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>Step 4 — Live Preview</h2>
        <div className="small-note" style={{ marginBottom: 8 }}>
          These are the exact current styles for summary and invoice. We can tweak them step by step.
        </div>
        <div className="export-preview-grid">
          <div className="export-preview-panel">
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Consumable Usage Summary</h3>
            <div className="export-preview-document">{renderSummaryPages(false)}</div>
          </div>
          <div className="export-preview-panel">
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Consumable Invoice</h3>
            <div className="export-preview-document">{renderInvoicePages(false)}</div>
          </div>
        </div>
      </section>

      <div className="export-staging" aria-hidden="true">
        <div ref={usageSummaryExportRef} className="export-document">{renderSummaryPages(true)}</div>

        <div ref={invoiceExportRef} className="export-document">{renderInvoicePages(true)}</div>
      </div>
    </main>
  );
}

export default function EstimateToInvoicePage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <section className="card">Loading estimate workspace...</section>
        </main>
      }
    >
      <EstimateToInvoiceContent />
    </Suspense>
  );
}
