import { NextResponse } from "next/server";
import { detectOperations } from "@/lib/invoice";
import { analyzeEstimateWithOpenAI } from "@/lib/server/estimate-ai";
import { filterMaterialRelevantOperations } from "@/lib/server/material-engine";
import { parseEstimateOperationsWithRules } from "@/lib/server/estimate-parser";

export const runtime = "nodejs";

type AnalyzeRequest = {
  estimateText?: string;
  localOperations?: string[];
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

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const requestUrl = new URL(request.url);
    const debugEnabled = requestUrl.searchParams.get("debug") === "true";
    const decisionFilter = requestUrl.searchParams.get("decision");
    const payload = (await request.json()) as AnalyzeRequest;
    const estimateText = String(payload.estimateText || "");
    if (!estimateText.trim()) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "estimateText is required." }, { status: 400 });
    }

    const localOperations = sanitizeOperations(payload.localOperations);
    const fallbackOperations = localOperations.length > 0 ? localOperations : detectOperations(estimateText);
    const rulesResult = parseEstimateOperationsWithRules({
      estimateText,
      localOperations: fallbackOperations
    });
    const shouldUseLlmReview = rulesResult.lowConfidenceOperations.length > 0;
    const llmInputText = rulesResult.llmContextText ? `Low-confidence estimate snippets:\n${rulesResult.llmContextText}` : estimateText;
    const result = shouldUseLlmReview
      ? await analyzeEstimateWithOpenAI({
          estimateText: llmInputText,
          fallbackOperations: rulesResult.lowConfidenceOperations
        })
      : {
          operations: [] as string[],
          source: "fallback" as const,
          note: "No low-confidence operations required LLM review."
        };

    const parserDrivenOperations = [...rulesResult.operations, ...result.operations].filter(Boolean);
    const operationsBeforeMaterialFilter = parserDrivenOperations.length > 0 ? parserDrivenOperations : fallbackOperations;
    const filteredOperations = await filterMaterialRelevantOperations(operationsBeforeMaterialFilter);
    const operationsForUi =
      filteredOperations.length > 0
        ? filteredOperations
        : rulesResult.operations.length > 0
          ? rulesResult.operations
          : operationsBeforeMaterialFilter;

    const notes = [result.note, ...rulesResult.warnings].filter(Boolean).slice(0, 8);

    const filteredCandidates =
      debugEnabled && (decisionFilter === "keep" || decisionFilter === "review" || decisionFilter === "drop")
        ? rulesResult.debugCandidates.filter((item) => item.decision === decisionFilter)
        : rulesResult.debugCandidates;

    return NextResponse.json({
      operations: operationsForUi,
      source: shouldUseLlmReview ? `rules+${result.source}` : "rules",
      note: notes.length > 0 ? notes.join(" | ") : null,
      ruleset_version: rulesResult.rulesetVersion,
      format: rulesResult.format,
      has_summary: rulesResult.hasSummary,
      parse_debug: debugEnabled
        ? {
            candidate_count: filteredCandidates.length,
            llm_review_count: rulesResult.lowConfidenceOperations.length,
            candidates: filteredCandidates
          }
        : undefined
    });
  } catch (error) {
    return NextResponse.json(
      { code: "ANALYZE_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
