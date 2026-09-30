import { NextResponse } from "next/server";
import { listSavedInvoices, upsertSavedInvoice, type SavedInvoiceStatus } from "@/lib/server/saved-invoices";

export const runtime = "nodejs";

type UpsertInvoicePayload = {
  id?: string;
  meta?: {
    invoiceNo?: string;
    roNo?: string;
    vin?: string;
    yearMakeModel?: string;
    insuranceCompany?: string;
    repairDate?: string;
    currency?: string;
    notes?: string;
  };
  bodyShop?: {
    name?: string;
    addressLine1?: string;
  };
  lines?: Array<{
    id?: string;
    operation?: string;
    group?: string;
    partNo?: string;
    description?: string;
    qty?: number;
    unit?: string;
    unitPrice?: number;
    source?: string;
  }>;
  parseState?: {
    rawText?: string;
    operations?: string[];
    selectedOperations?: string[];
  };
  status?: SavedInvoiceStatus;
};

function asStatus(value: unknown): SavedInvoiceStatus {
  const status = String(value || "").trim();
  if (status === "Processing" || status === "Needs Review" || status === "Completed") {
    return status;
  }
  return "Completed";
}

export async function GET(): Promise<NextResponse> {
  try {
    const invoices = await listSavedInvoices();
    const rows = invoices.map((item) => ({
      id: item.id,
      date: new Date(item.updatedAt).toISOString().slice(0, 10),
      roNo: item.meta.roNo || "N/A",
      vin: item.meta.vin || "N/A",
      roVin: [item.meta.roNo ? `RO ${item.meta.roNo}` : "", item.meta.vin || ""].filter(Boolean).join(" / ") || "N/A",
      vehicleInfo: item.meta.yearMakeModel || "N/A",
      insuranceCompany: item.meta.insuranceCompany || "N/A",
      invoiceNo: item.meta.invoiceNo || "N/A",
      total: item.total,
      status: item.status
    }));
    return NextResponse.json({ invoices: rows });
  } catch (error) {
    return NextResponse.json(
      {
        code: "LIST_INVOICES_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as UpsertInvoicePayload;
    const invoice = await upsertSavedInvoice({
      id: String(payload.id || "").trim() || undefined,
      meta: payload.meta || {},
      bodyShop: payload.bodyShop || {},
      lines: Array.isArray(payload.lines) ? payload.lines : [],
      parseState: payload.parseState || {},
      status: asStatus(payload.status)
    });
    return NextResponse.json({ invoice });
  } catch (error) {
    return NextResponse.json(
      {
        code: "UPSERT_INVOICE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
