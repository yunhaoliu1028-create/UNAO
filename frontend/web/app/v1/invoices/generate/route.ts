import { NextResponse } from "next/server";
import { detectOperations } from "@/lib/invoice";
import { generateInvoiceLinesFromLogic, type Tier } from "@/lib/server/material-engine";
import { listCustomLogicTemplates, pickMatchingTemplate } from "@/lib/server/custom-logic-templates";

export const runtime = "nodejs";

type GenerateRequest = {
  estimateText?: string;
  operations?: string[];
  tier?: Tier;
  operationGroupHints?: Record<string, string>;
  /** Vehicle context for three-layer rule matching. */
  vehicle?: { make?: string; model?: string; year?: number; bodyMaterial?: string };
  orgId?: string;
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

function sanitizeOperationGroupHints(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([operation, group]) => [String(operation || "").trim(), String(group || "").trim()] as const)
    .filter(([operation, group]) => operation.length > 0 && group.length > 0)
    .slice(0, 80);
  return Object.fromEntries(entries);
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as GenerateRequest;
    const estimateText = String(payload.estimateText || "");
    const operations = sanitizeOperations(payload.operations);
    const tier = normalizeTier(payload.tier);
    const operationGroupHints = sanitizeOperationGroupHints(payload.operationGroupHints);

    const effectiveOperations = operations.length > 0 ? operations : detectOperations(estimateText);
    if (effectiveOperations.length === 0) {
      return NextResponse.json({ code: "NO_OPERATIONS", message: "No operations found from payload." }, { status: 400 });
    }

    const templates = await listCustomLogicTemplates();
    const templateMatchedOperations = new Set<string>();
    const templateLines: Awaited<ReturnType<typeof generateInvoiceLinesFromLogic>>["lines"] = [];
    const operationsForEngine: string[] = [];

    for (const operation of effectiveOperations) {
      const matchedTemplate = pickMatchingTemplate({
        estimateText,
        operationText: operation,
        templates
      });
      if (!matchedTemplate) {
        operationsForEngine.push(operation);
        continue;
      }
      templateMatchedOperations.add(operation);
      for (const [index, item] of matchedTemplate.lines.entries()) {
        const qty = Number(item.qty);
        const unitPrice = Number(item.unitPrice);
        templateLines.push({
          id: `tpl-${matchedTemplate.id}-${Date.now()}-${index}`,
          operation,
          partNo: String(item.partNo || "").trim(),
          description: String(item.description || "").trim(),
          qty: Number.isFinite(qty) ? qty : 1,
          unit: String(item.unit || "Each").trim() || "Each",
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
          source: `template:${matchedTemplate.name}`
        });
      }
    }

    const { lines: engineLines, unmatchedOperations, warnings } = await generateInvoiceLinesFromLogic({
      operations: operationsForEngine,
      tier,
      estimateText,
      operationGroupHints,
      vehicle: payload.vehicle,
      orgId: payload.orgId,
    });

    const lines = [...templateLines, ...engineLines];
    const templateWarnings =
      templateMatchedOperations.size > 0
        ? [`Applied ${templateMatchedOperations.size} custom template override(s).`]
        : [];

    return NextResponse.json({
      lines,
      tier,
      operation_count: effectiveOperations.length,
      generated_line_count: lines.length,
      unmatched_operations: unmatchedOperations,
      warnings: [...templateWarnings, ...warnings]
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
