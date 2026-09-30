import { NextResponse } from "next/server";
import { deleteSavedInvoiceById, getSavedInvoiceById, type SavedInvoiceStatus, updateSavedInvoiceStatus } from "@/lib/server/saved-invoices";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const invoice = await getSavedInvoiceById(id);
    if (!invoice) {
      return NextResponse.json({ code: "INVOICE_NOT_FOUND", message: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json({ invoice });
  } catch (error) {
    return NextResponse.json(
      {
        code: "GET_INVOICE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const deleted = await deleteSavedInvoiceById(id);
    if (!deleted) {
      return NextResponse.json({ code: "INVOICE_NOT_FOUND", message: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        code: "DELETE_INVOICE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

function asStatus(value: unknown): SavedInvoiceStatus {
  const status = String(value || "").trim();
  if (status === "Processing" || status === "Needs Review" || status === "Completed") {
    return status;
  }
  return "Completed";
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as { status?: unknown };
    const status = asStatus(payload.status);
    const updated = await updateSavedInvoiceStatus(id, status);
    if (!updated) {
      return NextResponse.json({ code: "INVOICE_NOT_FOUND", message: "Invoice not found." }, { status: 404 });
    }
    return NextResponse.json({ invoice: updated });
  } catch (error) {
    return NextResponse.json(
      {
        code: "UPDATE_INVOICE_STATUS_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
