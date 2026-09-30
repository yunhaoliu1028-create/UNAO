import { NextResponse } from "next/server";
import { listCustomLogicTemplates, upsertCustomLogicTemplate } from "@/lib/server/custom-logic-templates";

export const runtime = "nodejs";

type UpsertTemplatePayload = {
  id?: string;
  name?: string;
  estimateKeywords?: string[] | string;
  operationKeywords?: string[] | string;
  lines?: Array<{
    partNo?: string;
    description?: string;
    qty?: number;
    unit?: string;
    unitPrice?: number;
  }>;
};

function toKeywordArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  return text
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(): Promise<NextResponse> {
  try {
    const templates = await listCustomLogicTemplates();
    return NextResponse.json({ templates });
  } catch (error) {
    return NextResponse.json(
      {
        code: "LIST_TEMPLATES_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as UpsertTemplatePayload;
    const template = await upsertCustomLogicTemplate({
      id: String(payload.id || "").trim() || undefined,
      name: String(payload.name || "").trim(),
      estimateKeywords: toKeywordArray(payload.estimateKeywords),
      operationKeywords: toKeywordArray(payload.operationKeywords),
      lines: Array.isArray(payload.lines) ? payload.lines : []
    });
    return NextResponse.json({ template });
  } catch (error) {
    return NextResponse.json(
      {
        code: "UPSERT_TEMPLATE_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 400 }
    );
  }
}
