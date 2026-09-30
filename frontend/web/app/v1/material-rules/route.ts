import { NextResponse } from "next/server";
import {
  findMatchingRules,
  deduplicateRules,
  saveRulesFromInvoice,
  listRules,
  deleteRule,
  recordRuleNegative,
} from "@/lib/server/material-rules";

export const runtime = "nodejs";

// ── GET /v1/material-rules?location=trunk&operation=replace&make=honda ──
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const location = url.searchParams.get("location");
    const operation = url.searchParams.get("operation");

    // If no location/operation, list all rules.
    if (!location && !operation) {
      const source = url.searchParams.get("source") || undefined;
      const rules = await listRules({ source });
      return NextResponse.json({ rules });
    }

    if (!location || !operation) {
      return NextResponse.json(
        { code: "INVALID_INPUT", message: "Both location and operation are required for matching." },
        { status: 400 }
      );
    }

    const make = url.searchParams.get("make") || undefined;
    const model = url.searchParams.get("model") || undefined;
    const yearStr = url.searchParams.get("year");
    const year = yearStr ? Number.parseInt(yearStr, 10) : undefined;
    const bodyMaterial = url.searchParams.get("bodyMaterial") || undefined;

    const matches = await findMatchingRules({ location, operation, make, model, year, bodyMaterial });
    const rules = deduplicateRules(matches);

    return NextResponse.json({
      rules,
      matchCount: matches.length,
      deduplicatedCount: rules.length,
    });
  } catch (error) {
    return NextResponse.json(
      { code: "QUERY_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ── POST /v1/material-rules — save rules from invoice editing ────────
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      location: string;
      operation: string;
      make?: string;
      model?: string;
      yearFrom?: number;
      yearTo?: number;
      bodyMaterial?: string;
      invoiceId?: string;
      lines: Array<{
        productPartNo: string;
        description: string;
        qty: number;
        unit: string;
        unitPrice: number;
      }>;
    };

    if (!body.location || !body.operation) {
      return NextResponse.json(
        { code: "INVALID_INPUT", message: "location and operation are required." },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { code: "INVALID_INPUT", message: "At least one material line is required." },
        { status: 400 }
      );
    }

    const rules = await saveRulesFromInvoice({
      location: body.location,
      operation: body.operation,
      make: body.make,
      model: body.model,
      yearFrom: body.yearFrom,
      yearTo: body.yearTo,
      bodyMaterial: body.bodyMaterial,
      invoiceId: body.invoiceId,
      lines: body.lines,
    });

    return NextResponse.json({ saved: rules.length, rules });
  } catch (error) {
    return NextResponse.json(
      { code: "SAVE_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ── DELETE /v1/material-rules ────────────────────────────────────────
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { id?: string; negative?: boolean };

    if (!body.id) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "id is required." }, { status: 400 });
    }

    if (body.negative) {
      await recordRuleNegative(body.id);
      return NextResponse.json({ action: "negative_recorded", id: body.id });
    }

    await deleteRule(body.id);
    return NextResponse.json({ action: "deleted", id: body.id });
  } catch (error) {
    return NextResponse.json(
      { code: "DELETE_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
