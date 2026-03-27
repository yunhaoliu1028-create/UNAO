import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

export type Tier = "T1" | "T2" | "T3";

type LogicRow = {
  LOCATION: string;
  OPERATION: string;
  T1: string;
  T2: string;
  T3: string;
};

type MaterialInfoRow = {
  manufacturer: string | null;
  partNumberRaw: string;
  partNumberKey: string;
  description: string;
  containerCost: number | null;
  removeBy: string | null;
  piecesPerContainer: number | null;
  invoiceUnit: string | null;
  packageType: string | null;
};

export type GeneratedLine = {
  id: string;
  operation: string;
  group?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  source: string;
};

type ParsedLogicItem = {
  partNumber: string | null;
  description: string;
  qty: number;
  unit: string;
  explicitEachPrice: number | null;
};

const logicRowsCache: { value: LogicRow[] | null } = { value: null };
const materialInfoCache: { value: Map<string, MaterialInfoRow> | null } = { value: null };
const locationStopWords = new Set([
  "left",
  "right",
  "rear",
  "front",
  "upper",
  "lower",
  "inner",
  "outer",
  "side"
]);
const irrelevantPartKeywords = [
  "weatherstrip",
  "hinge",
  "reflector",
  "emblem",
  "molding",
  "clip",
  "bracket",
  "lamp",
  "light",
  "bezel",
  "trim",
  "garnish"
];
const operationNoiseWords = new Set([
  "line",
  "replace",
  "repair",
  "remove",
  "install",
  "refinish",
  "blend",
  "patch",
  "rt",
  "lt",
  "rh",
  "lh",
  "outer",
  "inner",
  "panel"
]);
const majorGroupPatterns: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bfront\s+door\b/i, label: "Front Door" },
  { pattern: /\brear\s+door\b/i, label: "Rear Door" },
  { pattern: /\bfront\s+fender\b/i, label: "Front Fender" },
  { pattern: /\brear\s+fender\b/i, label: "Rear Fender" },
  { pattern: /\bfender\b/i, label: "Fender" },
  { pattern: /\bhood\b/i, label: "Hood" },
  { pattern: /\blift[\s-]*gate\b/i, label: "Liftgate" },
  { pattern: /\bquarter\s+panel\b/i, label: "Quarter Panel" },
  { pattern: /\bfront\s+bumper\b/i, label: "Front Bumper" },
  { pattern: /\brear\s+bumper\b/i, label: "Rear Bumper" },
  { pattern: /\bbumper\s+cover\b/i, label: "Bumper Cover" },
  { pattern: /\brear\s+body\b/i, label: "Rear Body" },
  { pattern: /\brocker\s+panel\b/i, label: "Rocker Panel" },
  { pattern: /\broof\b/i, label: "Roof" }
];

type OperationContextHint = {
  lineNo?: number;
  group: string;
  normalizedChunk: string;
};

type EstimateSection = {
  group: string;
  startLine: number;
  endLine: number;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasActionToken(value: string): boolean {
  return /\b(replace|repair|remove|install|refinish|blend|patch)\b/.test(value);
}

function parseLeadingLineNo(value: string): number | null {
  const lineTagMatch = value.match(/\bline#?\s*(\d{1,4})\b/i);
  if (lineTagMatch) {
    return Number.parseInt(lineTagMatch[1], 10);
  }
  const leadingMatch = value.match(/^\s*(\d{1,4})\b/);
  if (leadingMatch) {
    return Number.parseInt(leadingMatch[1], 10);
  }
  return null;
}

function detectMajorGroup(value: string): string | null {
  for (const item of majorGroupPatterns) {
    if (item.pattern.test(value)) {
      return item.label;
    }
  }
  return null;
}

function normalizeHeader(value: string): string {
  return normalizeWhitespace(value.replace(/\ufeff/g, ""));
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function normalizePartNumber(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

async function readAssetCsv(fileName: string): Promise<string> {
  const candidates = [
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "..", "..", "assets", fileName),
    path.resolve(/* turbopackIgnore: true */ process.cwd(), "assets", fileName)
  ];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf-8");
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Cannot read assets file ${fileName}: ${String(lastError)}`);
}

async function loadLogicRows(): Promise<LogicRow[]> {
  if (logicRowsCache.value) {
    return logicRowsCache.value;
  }

  const csvText = await readAssetCsv("material_logic.csv");
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true
  }) as Array<Record<string, string>>;

  const rows = records.map((row) => ({
    LOCATION: normalizeWhitespace(row.LOCATION || ""),
    OPERATION: normalizeWhitespace(row.OPERATION || ""),
    T1: String(row.T1 || ""),
    T2: String(row.T2 || ""),
    T3: String(row.T3 || "")
  }));

  logicRowsCache.value = rows;
  return rows;
}

async function loadMaterialInfoMap(): Promise<Map<string, MaterialInfoRow>> {
  if (materialInfoCache.value) {
    return materialInfoCache.value;
  }

  const csvText = await readAssetCsv("material_info.csv");
  const records = parse(csvText, {
    columns: (headers: string[]) => headers.map((h) => normalizeHeader(h)),
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true
  }) as Array<Record<string, string>>;

  const map = new Map<string, MaterialInfoRow>();

  for (const row of records) {
    const partNumberRaw = normalizeWhitespace(row["Part Number"] || "");
    const partNumberKey = normalizePartNumber(partNumberRaw);
    if (!partNumberKey) {
      continue;
    }

    if (!map.has(partNumberKey)) {
      map.set(partNumberKey, {
        manufacturer: normalizeWhitespace(row.Manufacturer || "") || null,
        partNumberRaw,
        partNumberKey,
        description: normalizeWhitespace(row.Description || ""),
        containerCost: parseNumber(row["Container Cost"]),
        removeBy: normalizeWhitespace(row["Remove By"] || "") || null,
        piecesPerContainer: parseNumber(row["Pieces Per Container"]),
        invoiceUnit: normalizeWhitespace(row["Invoice Unit"] || "") || null,
        packageType: normalizeWhitespace(row.Size || "") || null
      });
    }
  }

  materialInfoCache.value = map;
  return map;
}

function resolveTierCell(row: LogicRow, tier: Tier): string {
  const t1 = row.T1 || "";
  const t2 = normalizeWhitespace(row.T2 || "").toUpperCase() === "SAME" ? t1 : row.T2 || "";
  const t3 = normalizeWhitespace(row.T3 || "").toUpperCase() === "SAME" ? t2 : row.T3 || "";

  if (tier === "T1") {
    return t1;
  }
  if (tier === "T2") {
    return t2;
  }
  return t3;
}

function parseLogicLine(line: string): ParsedLogicItem | null {
  const raw = normalizeWhitespace(line);
  if (!raw) {
    return null;
  }

  const priceMatch = raw.match(/\(\s*\$(\d+(?:\.\d+)?)\s*\/\s*each\s*\)/i);
  const explicitEachPrice = priceMatch ? Number.parseFloat(priceMatch[1]) : null;
  const withoutPriceNote = normalizeWhitespace(raw.replace(/\(\s*\$[^)]*\)/g, ""));

  const partMatch = withoutPriceNote.match(/\b3m\s*([0-9]{3,6})\b/i);
  const partNumber = partMatch ? normalizePartNumber(partMatch[1]) : null;

  // Remove part token first to avoid misreading "3m8115" as qty/unit.
  const withoutPartToken = normalizeWhitespace(withoutPriceNote.replace(/\b3m\s*[0-9]{3,6}\b/gi, ""));
  // Quantity/unit is usually the last "number + unit" token, e.g. "0.5 Cartridge(s)".
  const qtyMatches = Array.from(withoutPartToken.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s+([A-Za-z]+(?:\([^)]+\))?)(?=\s|$)/g));
  const qtyUnitMatch = qtyMatches.length > 0 ? qtyMatches[qtyMatches.length - 1] : null;
  const qty = qtyUnitMatch ? Number.parseFloat(qtyUnitMatch[1]) : 1;
  const unit = qtyUnitMatch ? qtyUnitMatch[2] : "Each";

  return {
    partNumber,
    description: withoutPriceNote,
    qty: Number.isFinite(qty) ? qty : 1,
    unit: normalizeWhitespace(unit || "Each"),
    explicitEachPrice
  };
}

function calcUnitPrice(item: ParsedLogicItem, materialInfo: MaterialInfoRow | undefined): number {
  if (item.explicitEachPrice !== null) {
    return item.explicitEachPrice;
  }

  if (!materialInfo || materialInfo.containerCost === null) {
    return 0;
  }

  const removeBy = (materialInfo.removeBy || "").toLowerCase();
  if (removeBy === "percent") {
    // Qty in logic is a fraction of container for these SKUs.
    return materialInfo.containerCost;
  }

  if (removeBy === "each piece") {
    const pieces = materialInfo.piecesPerContainer && materialInfo.piecesPerContainer > 0 ? materialInfo.piecesPerContainer : 1;
    return materialInfo.containerCost / pieces;
  }

  const pieces = materialInfo.piecesPerContainer && materialInfo.piecesPerContainer > 0 ? materialInfo.piecesPerContainer : 1;
  return materialInfo.containerCost / pieces;
}

function normalizeOperationText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bline#?\s*\d{1,4}\b/g, " ")
    .replace(/^\s*\d{1,4}\s+/, "")
    .replace(/\b(repl|rpl)\b/g, "replace")
    .replace(/\b(r&r|r\/r|remove\s*&\s*replace)\b/g, "replace")
    .replace(/\b(r&i|r\/i|remove\s*&\s*install)\b/g, "remove install")
    .replace(/\b(rep|rpr)\b/g, "repair")
    .replace(/\brefin\b/g, "refinish")
    .replace(/\bblnd\b/g, "blend")
    .replace(/\bsublt\b/g, "sublet")
    .replace(/\ba\/m\b/g, " ")
    .replace(/\b(capa|keysiq|nsf|oem|opt\s+oem|alt\s+oem)\b/g, " ")
    .replace(/\blift[\s-]*gate\b/g, "liftgate")
    .replace(/\bbumper[\s-]*cover\b/g, "bumper cover")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisplayText(value: string): string {
  return value
    .replace(/ï¿½|�/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function normalizeLocationForCanonical(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/\b(without|w\/o|w o)\b.*$/g, "")
    .replace(/\b(assy|assembly|complete|us built)\b/g, " ")
    .replace(/\ba\/m\b/g, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\blift[\s-]*gate\b/g, "liftgate")
    .replace(/\s+/g, " ")
    .trim();
}

function toTitleCasePreserveSlash(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) =>
      token
        .split("/")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join("/")
    )
    .join(" ");
}

function canonicalizeOperationLabel(normalizedOp: string): string {
  const action =
    normalizedOp.includes("replace") || /\b(remove|install)\b/.test(normalizedOp)
      ? "Replace"
      : normalizedOp.includes("repair")
        ? "Repair"
        : "Repair";
  let location = normalizeWhitespace(normalizedOp.replace(/\b(replace|repair|refinish|blend|patch|remove|install)\b/g, " "));
  location = normalizeLocationForCanonical(location);
  if (location.includes("liftgate")) {
    location = "liftgate";
  }
  return `${action} ${toTitleCase(location)}`.trim();
}

function isCosmeticOnlyOperation(normalizedOp: string): boolean {
  const hasBlendOrRefinish = /\b(blend|refinish)\b/.test(normalizedOp);
  const hasStructuralAction = /\b(replace|repair|remove|install|patch)\b/.test(normalizedOp);
  return hasBlendOrRefinish && !hasStructuralAction;
}

function hasRelevantLocationToken(op: string, location: string): boolean {
  const locationTokens = location
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2 && !locationStopWords.has(token));
  if (locationTokens.length === 0) {
    return false;
  }
  const compactOp = op.replace(/[^a-z0-9]/g, "");
  return locationTokens.some((token) => {
    if (op.includes(token)) {
      return true;
    }
    const compactToken = token.replace(/[^a-z0-9]/g, "");
    return compactToken.length > 0 && compactOp.includes(compactToken);
  });
}

function hasActionMatch(op: string, action: string): boolean {
  if (op.includes(action)) {
    return true;
  }
  if (action === "replace") {
    return /\b(replace|remove|install)\b/.test(op);
  }
  if (action === "repair") {
    return /\b(repair|refinish|blend|patch)\b/.test(op);
  }
  return false;
}

function scoreOperationMatch(operationText: string, row: LogicRow): number {
  const op = normalizeOperationText(operationText);
  const location = row.LOCATION.toLowerCase();
  const action = row.OPERATION.toLowerCase();

  if (/\blicense\s+frame\b/.test(op) && /\b(frame|rail)\b/.test(location)) {
    return 0;
  }

  if (!hasActionMatch(op, action) || !hasRelevantLocationToken(op, location)) {
    return 0;
  }

  let score = 0;
  if (op.includes(location)) {
    score += 3;
  } else {
    const locationTokens = location.split(/\s+/).filter((t) => t.length > 3);
    if (locationTokens.some((token) => op.includes(token))) {
      score += 1;
    }
  }

  if (op.includes(action)) {
    score += 3;
  }
  if (action === "replace" && /\b(replace|remove|install)\b/.test(op)) {
    score += 1;
  }
  if (action === "repair" && /\b(repair|refinish|blend|patch)\b/.test(op)) {
    score += 1;
  }

  return score;
}

function tokenizeForContextScore(value: string): string[] {
  return normalizeOperationText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 2 && !operationNoiseWords.has(token));
}

function extractOperationContextHints(estimateText: string): OperationContextHint[] {
  const raw = String(estimateText || "");
  if (!raw.trim()) {
    return [];
  }
  const lines = raw.split(/\r?\n/);
  const sections: Array<{ group: string; startLine: number }> = [];
  const lineHints: OperationContextHint[] = [];
  let activeGroup: string | null = null;

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) {
      continue;
    }
    const lineNo = parseLeadingLineNo(line);
    if (lineNo !== null) {
      const payload = normalizeWhitespace(line.replace(/^\s*\d{1,4}\s*/, ""));
      const payloadNormalized = normalizeOperationText(payload);
      const explicitGroup = detectMajorGroup(payload);
      const hasAction = hasActionToken(payloadNormalized);

      if (explicitGroup && !hasAction) {
        activeGroup = explicitGroup;
        sections.push({ group: explicitGroup, startLine: lineNo });
        continue;
      }
      if (hasAction) {
        if (explicitGroup) {
          activeGroup = explicitGroup;
        }
        if (activeGroup) {
          lineHints.push({ lineNo, group: activeGroup, normalizedChunk: payloadNormalized });
        }
      }
      continue;
    }

    // Fallback for OCR blocks without line numbers.
    const groupFromText = detectMajorGroup(line);
    const normalizedLine = normalizeOperationText(line);
    const hasAction = hasActionToken(normalizedLine);
    if (groupFromText && !hasAction) {
      activeGroup = groupFromText;
      continue;
    }
    if (activeGroup && hasAction) {
      lineHints.push({ group: activeGroup, normalizedChunk: normalizedLine });
    }
  }

  if (sections.length > 0) {
    sections.sort((a, b) => a.startLine - b.startLine);
  }
  const sectionRanges: EstimateSection[] = sections.map((section, index) => ({
    group: section.group,
    startLine: section.startLine,
    endLine: index < sections.length - 1 ? sections[index + 1].startLine - 1 : 99999
  }));

  const hints: OperationContextHint[] = [];

  for (const hint of lineHints) {
    if (typeof hint.lineNo === "number" && sectionRanges.length > 0) {
      const section = sectionRanges.find((item) => hint.lineNo! >= item.startLine && hint.lineNo! <= item.endLine);
      hints.push({
        lineNo: hint.lineNo,
        group: section?.group || hint.group,
        normalizedChunk: hint.normalizedChunk
      });
      continue;
    }
    hints.push(hint);
  }

  return hints.slice(0, 600);
}

function inferOperationGroup(operationText: string, hints: OperationContextHint[]): string | null {
  if (hints.length === 0) {
    return null;
  }

  const normalizedOp = normalizeOperationText(operationText);
  const opLineNo = parseLeadingLineNo(operationText);
  if (typeof opLineNo === "number") {
    const exactByLine = hints.find((hint) => hint.lineNo === opLineNo && hint.group);
    if (exactByLine?.group) {
      return exactByLine.group;
    }
  }
  const majorFromText = detectMajorGroup(operationText);
  if (majorFromText) {
    return majorFromText;
  }
  const opTokens = tokenizeForContextScore(normalizedOp);
  let bestGroup: string | null = null;
  let bestScore = 0;

  for (const hint of hints) {
    let score = 0;
    if (hint.normalizedChunk.includes(normalizedOp)) {
      score += 4;
    }
    const overlap = opTokens.filter((token) => hint.normalizedChunk.includes(token)).length;
    score += overlap;
    if (score > bestScore) {
      bestScore = score;
      bestGroup = hint.group;
    }
  }

  return bestScore >= 2 ? bestGroup : null;
}

function pickBestLogicRow(operationText: string, rows: LogicRow[]): LogicRow | null {
  let best: LogicRow | null = null;
  let bestScore = 0;

  for (const row of rows) {
    const score = scoreOperationMatch(operationText, row);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  return bestScore >= 4 ? best : null;
}

function makeLineId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function generateInvoiceLinesFromLogic(input: {
  operations: string[];
  tier: Tier;
  estimateText?: string;
}): Promise<{ lines: GeneratedLine[]; unmatchedOperations: string[]; warnings: string[] }> {
  const [logicRows, materialInfoMap] = await Promise.all([loadLogicRows(), loadMaterialInfoMap()]);
  const contextHints = extractOperationContextHints(String(input.estimateText || ""));
  const warnings: string[] = [];
  const lines: GeneratedLine[] = [];
  const unmatchedOperations: string[] = [];
  const seenOperations = new Set<string>();

  for (const operationText of input.operations) {
    const normalizedOp = normalizeOperationText(operationText);
    if (!normalizedOp) {
      continue;
    }
    if (seenOperations.has(normalizedOp)) {
      continue;
    }
    seenOperations.add(normalizedOp);
    if (normalizedOp.includes("sublet")) {
      continue;
    }
    if (isCosmeticOnlyOperation(normalizedOp)) {
      warnings.push(`Skipped cosmetic-only operation (no consumables): ${operationText}`);
      continue;
    }
    const inferredGroup = inferOperationGroup(operationText, contextHints);
    const groupedOperation =
      inferredGroup && !normalizedOp.includes(normalizeOperationText(inferredGroup)) ? `${inferredGroup} ${operationText}` : operationText;
    const logicRow = pickBestLogicRow(groupedOperation, logicRows) || pickBestLogicRow(operationText, logicRows);
    if (!logicRow) {
      unmatchedOperations.push(operationText);
      continue;
    }
    if (inferredGroup && !hasRelevantLocationToken(normalizeOperationText(inferredGroup), logicRow.LOCATION.toLowerCase())) {
      warnings.push(`Skipped low-confidence mapping: ${operationText} (group=${inferredGroup}, matched=${logicRow.LOCATION})`);
      unmatchedOperations.push(operationText);
      continue;
    }

    const tierCell = resolveTierCell(logicRow, input.tier);
    const materialLines = tierCell
      .split(/\r?\n/)
      .map((line) => parseLogicLine(line))
      .filter((line): line is ParsedLogicItem => Boolean(line));

    for (const materialLine of materialLines) {
      const info = materialLine.partNumber ? materialInfoMap.get(materialLine.partNumber) : undefined;
      const unitPrice = calcUnitPrice(materialLine, info);
      if (materialLine.partNumber && !info) {
        warnings.push(`Part ${materialLine.partNumber} not found in material_info`);
      }

      lines.push({
        id: makeLineId(),
        operation: operationText,
        group: inferredGroup || toTitleCasePreserveSlash(logicRow.LOCATION) || undefined,
        description: normalizeDisplayText(info?.description || materialLine.description),
        qty: Number(materialLine.qty.toFixed(3)),
        unit: materialLine.unit || info?.invoiceUnit || "Each",
        unitPrice: Number(unitPrice.toFixed(2)),
        source: `logic:${logicRow.LOCATION}:${logicRow.OPERATION}:${input.tier}${materialLine.partNumber ? `:3m${materialLine.partNumber}` : ""}${inferredGroup ? `:group=${inferredGroup}` : ""}`
      });
    }
  }

  return { lines, unmatchedOperations, warnings: Array.from(new Set(warnings)) };
}

export async function filterMaterialRelevantOperations(operations: string[]): Promise<string[]> {
  const logicRows = await loadLogicRows();
  const unique = new Map<string, string>();

  for (const operationText of operations) {
    const normalizedOp = normalizeOperationText(operationText);
    if (!normalizedOp) {
      continue;
    }
    if (normalizedOp.includes("sublet")) {
      continue;
    }
    if (isCosmeticOnlyOperation(normalizedOp)) {
      continue;
    }
    if (irrelevantPartKeywords.some((keyword) => normalizedOp.includes(keyword))) {
      continue;
    }

    const canonical = canonicalizeOperationLabel(normalizedOp);
    const dedupeKey = canonical.toLowerCase();
    const matchedRow = pickBestLogicRow(normalizedOp, logicRows);
    if (matchedRow) {
      unique.set(dedupeKey, canonical);
      continue;
    }

    // Keep key operations for downstream visibility even when catalog logic is not yet configured.
    if (/\b(liftgate|bumper\s+cover)\b/.test(normalizedOp) && /\b(replace|repair)\b/.test(normalizedOp)) {
      unique.set(dedupeKey, canonical);
    }
  }

  return Array.from(unique.values()).slice(0, 20);
}
