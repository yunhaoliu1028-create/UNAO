import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/db";
import type { InvoiceLine, InvoiceMeta } from "@/lib/invoice";

export type SavedInvoiceStatus = "Completed" | "Processing" | "Needs Review";

export type SavedBodyShopInfo = {
  name: string;
  addressLine1: string;
};

export type SavedInvoiceParseState = {
  rawText: string;
  operations: string[];
  selectedOperations: string[];
};

export type SavedInvoiceRecord = {
  id: string;
  meta: InvoiceMeta;
  bodyShop: SavedBodyShopInfo;
  lines: InvoiceLine[];
  parseState: SavedInvoiceParseState;
  total: number;
  status: SavedInvoiceStatus;
  createdAt: string;
  updatedAt: string;
};

type UpsertInvoiceInput = {
  id?: string;
  meta?: Partial<InvoiceMeta>;
  bodyShop?: Partial<SavedBodyShopInfo>;
  lines?: Array<Partial<InvoiceLine>>;
  parseState?: Partial<SavedInvoiceParseState>;
  status?: SavedInvoiceStatus;
};

// ── Helpers ─────────────────────────────────────────────────────────

function parseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function makeInvoiceId(): string {
  return `inv-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function sanitizeText(value: unknown): string {
  return String(value || "").trim();
}

function sanitizeLine(line: Partial<InvoiceLine>): InvoiceLine | null {
  const description = sanitizeText(line.description);
  if (!description) {
    return null;
  }
  return {
    id: sanitizeText(line.id) || randomUUID(),
    operation: sanitizeText(line.operation) || "Manual",
    group: sanitizeText(line.group) || undefined,
    partNo: sanitizeText(line.partNo) || undefined,
    description,
    qty: parseNumber(line.qty, 0),
    unit: sanitizeText(line.unit) || "Each",
    unitPrice: parseNumber(line.unitPrice, 0),
    source: sanitizeText(line.source) || "manual",
  };
}

function calcTotal(lines: InvoiceLine[]): number {
  return Number(
    lines
      .reduce((sum, line) => sum + parseNumber(line.qty, 0) * parseNumber(line.unitPrice, 0), 0)
      .toFixed(2)
  );
}

function normalizeMeta(meta: Partial<InvoiceMeta>): InvoiceMeta {
  return {
    invoiceNo: sanitizeText(meta.invoiceNo) || "INV-DRAFT-001",
    roNo: sanitizeText(meta.roNo),
    vin: sanitizeText(meta.vin),
    yearMakeModel: sanitizeText(meta.yearMakeModel),
    insuranceCompany: sanitizeText(meta.insuranceCompany),
    repairDate: sanitizeText(meta.repairDate) || new Date().toLocaleDateString(),
    currency: sanitizeText(meta.currency) || "USD",
    notes: sanitizeText(meta.notes),
  };
}

function normalizeBodyShop(info: Partial<SavedBodyShopInfo>): SavedBodyShopInfo {
  return {
    name: sanitizeText(info.name),
    addressLine1: sanitizeText(info.addressLine1),
  };
}

function normalizeParseState(value: Partial<SavedInvoiceParseState> | undefined): SavedInvoiceParseState {
  const operations = Array.isArray(value?.operations)
    ? value.operations.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 120)
    : [];
  const selectedOperations = Array.isArray(value?.selectedOperations)
    ? value.selectedOperations.map((item) => sanitizeText(item)).filter(Boolean).slice(0, 120)
    : [];
  return {
    rawText: sanitizeText(value?.rawText),
    operations,
    selectedOperations,
  };
}

function asStatus(value: unknown): SavedInvoiceStatus {
  const status = String(value || "").trim();
  if (status === "Processing" || status === "Needs Review" || status === "Completed") {
    return status;
  }
  return "Completed";
}

// Map Prisma status enum → our string type
function mapPrismaStatus(s: string): SavedInvoiceStatus {
  if (s === "Processing") return "Processing";
  if (s === "NeedsReview") return "Needs Review";
  return "Completed";
}

function toPrismaStatus(s: SavedInvoiceStatus): "Completed" | "Processing" | "NeedsReview" {
  if (s === "Processing") return "Processing";
  if (s === "Needs Review") return "NeedsReview";
  return "Completed";
}

// ── DB row → SavedInvoiceRecord ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToRecord(row: any): SavedInvoiceRecord {
  let lines: InvoiceLine[] = [];
  try {
    lines = JSON.parse(row.linesJson || "[]");
  } catch {
    lines = [];
  }

  let operations: string[] = [];
  let selectedOperations: string[] = [];
  try {
    operations = JSON.parse(row.operations || "[]");
  } catch { /* empty */ }
  try {
    selectedOperations = JSON.parse(row.selectedOperations || "[]");
  } catch { /* empty */ }

  return {
    id: row.id,
    meta: {
      invoiceNo: row.invoiceNo || "INV-DRAFT-001",
      roNo: row.roNo || "",
      vin: row.vin || "",
      yearMakeModel: row.yearMakeModel || "",
      insuranceCompany: row.insuranceCompany || "",
      repairDate: row.repairDate || "",
      currency: row.currency || "USD",
      notes: row.notes || "",
    },
    bodyShop: {
      name: row.shopName || "",
      addressLine1: row.shopAddress || "",
    },
    lines,
    parseState: {
      rawText: row.rawText || "",
      operations,
      selectedOperations,
    },
    total: row.total ?? calcTotal(lines),
    status: mapPrismaStatus(row.status),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || ""),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || ""),
  };
}

// ── Public API (same interface as before) ───────────────────────────

export async function listSavedInvoices(): Promise<SavedInvoiceRecord[]> {
  const rows = await prisma.savedInvoice.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return rows.map(dbRowToRecord);
}

export async function getSavedInvoiceById(id: string): Promise<SavedInvoiceRecord | null> {
  const wantedId = sanitizeText(id);
  if (!wantedId) return null;

  const row = await prisma.savedInvoice.findUnique({ where: { id: wantedId } });
  if (!row) return null;
  return dbRowToRecord(row);
}

export async function deleteSavedInvoiceById(id: string): Promise<boolean> {
  const wantedId = sanitizeText(id);
  if (!wantedId) return false;

  try {
    await prisma.savedInvoice.delete({ where: { id: wantedId } });
    return true;
  } catch {
    return false;
  }
}

export async function updateSavedInvoiceStatus(
  id: string,
  status: SavedInvoiceStatus
): Promise<SavedInvoiceRecord | null> {
  const wantedId = sanitizeText(id);
  if (!wantedId) return null;

  try {
    const row = await prisma.savedInvoice.update({
      where: { id: wantedId },
      data: { status: toPrismaStatus(status) },
    });
    return dbRowToRecord(row);
  } catch {
    return null;
  }
}

export async function upsertSavedInvoice(input: UpsertInvoiceInput): Promise<SavedInvoiceRecord> {
  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .map((line) => sanitizeLine(line))
    .filter((line): line is InvoiceLine => Boolean(line))
    .slice(0, 500);
  const meta = normalizeMeta(input.meta || {});
  const bodyShop = normalizeBodyShop(input.bodyShop || {});
  const parseState = normalizeParseState(input.parseState);
  const total = calcTotal(lines);
  const status = asStatus(input.status);
  const wantedId = sanitizeText(input.id);

  const data = {
    invoiceNo: meta.invoiceNo,
    roNo: meta.roNo,
    vin: meta.vin,
    yearMakeModel: meta.yearMakeModel,
    insuranceCompany: meta.insuranceCompany || "",
    repairDate: meta.repairDate,
    currency: meta.currency,
    notes: meta.notes,
    shopName: bodyShop.name,
    shopAddress: bodyShop.addressLine1,
    rawText: parseState.rawText,
    operations: JSON.stringify(parseState.operations),
    selectedOperations: JSON.stringify(parseState.selectedOperations),
    linesJson: JSON.stringify(lines),
    total,
    status: toPrismaStatus(status),
  };

  // Try update if id provided
  if (wantedId) {
    try {
      const existing = await prisma.savedInvoice.findUnique({ where: { id: wantedId } });
      if (existing) {
        const row = await prisma.savedInvoice.update({
          where: { id: wantedId },
          data,
        });
        return dbRowToRecord(row);
      }
    } catch {
      // Fall through to create
    }
  }

  // Create new
  const newId = wantedId || makeInvoiceId();
  const row = await prisma.savedInvoice.create({
    data: {
      id: newId,
      ...data,
    },
  });
  return dbRowToRecord(row);
}
