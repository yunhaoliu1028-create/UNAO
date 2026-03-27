import { NextResponse } from "next/server";
import { detectOperations } from "@/lib/invoice";
import { generateInvoiceLinesFromLogic, type Tier } from "@/lib/server/material-engine";

export const runtime = "nodejs";

type GenerateRequest = {
  estimateText?: string;
  operations?: string[];
  tier?: Tier;
};

function sanitizeOperations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0)
    .slice(0, 40);
}

function normalizeTier(value: unknown): Tier {
  const tier = String(value || "T1").toUpperCase();
  if (tier === "T2" || tier === "T3") {
    return tier;
  }
  return "T1";
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as GenerateRequest;
    const estimateText = String(payload.estimateText || "");
    const operations = sanitizeOperations(payload.operations);
    const tier = normalizeTier(payload.tier);

    const effectiveOperations = operations.length > 0 ? operations : detectOperations(estimateText);
    if (effectiveOperations.length === 0) {
      return NextResponse.json({ code: "NO_OPERATIONS", message: "No operations found from payload." }, { status: 400 });
    }

    const { lines, unmatchedOperations, warnings } = await generateInvoiceLinesFromLogic({
      operations: effectiveOperations,
      tier,
      estimateText
    });

    return NextResponse.json({
      lines,
      tier,
      operation_count: effectiveOperations.length,
      generated_line_count: lines.length,
      unmatched_operations: unmatchedOperations,
      warnings
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: "INVOICE_GENERATE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
