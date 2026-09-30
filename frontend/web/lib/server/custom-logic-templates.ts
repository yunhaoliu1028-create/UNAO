import { prisma } from "@/lib/server/db";

export type CustomTemplateLine = {
  partNo?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
};

export type CustomLogicTemplate = {
  id: string;
  name: string;
  estimateKeywords: string[];
  operationKeywords: string[];
  lines: CustomTemplateLine[];
  createdAt: string;
  updatedAt: string;
};

function normalizeKeyword(value: string): string {
  return String(value || "").toLowerCase().replace(/[^\w\s-]+/g, " ").replace(/\s+/g, " ").trim();
}

function compactKeyword(value: string): string {
  return normalizeKeyword(value).replace(/\s+/g, "");
}

function keywordTokenMatch(corpus: string, keyword: string): boolean {
  const corpusTokens = normalizeKeyword(corpus).split(" ").filter(Boolean);
  const keywordTokens = normalizeKeyword(keyword).split(" ").filter(Boolean);
  if (keywordTokens.length === 0 || corpusTokens.length === 0) return false;
  let searchStart = 0;
  for (const token of keywordTokens) {
    const index = corpusTokens.indexOf(token, searchStart);
    if (index < 0) return false;
    searchStart = index + 1;
  }
  return true;
}

function keywordMatchesCorpus(corpus: string, keyword: string): boolean {
  const normalizedCorpus = normalizeKeyword(corpus);
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword || !normalizedCorpus) return false;
  return normalizedCorpus.includes(normalizedKeyword) ||
    compactKeyword(normalizedCorpus).includes(compactKeyword(normalizedKeyword)) ||
    keywordTokenMatch(normalizedCorpus, normalizedKeyword);
}

function normalizeKeywordList(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeKeyword(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output.slice(0, 20);
}

function sanitizeLine(line: Partial<CustomTemplateLine>): CustomTemplateLine | null {
  const description = String(line.description || "").trim();
  const qty = Number(line.qty);
  const unitPrice = Number(line.unitPrice);
  if (!description) return null;
  return {
    partNo: String(line.partNo || "").trim() || undefined,
    description,
    qty: Number.isFinite(qty) ? qty : 1,
    unit: String(line.unit || "").trim() || "Each",
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseLines(value: string): CustomTemplateLine[] {
  try {
    const parsed = JSON.parse(value) as Array<Partial<CustomTemplateLine>>;
    return Array.isArray(parsed)
      ? parsed.map((line) => sanitizeLine(line)).filter((line): line is CustomTemplateLine => Boolean(line))
      : [];
  } catch {
    return [];
  }
}

function toTemplate(row: {
  id: string;
  name: string;
  estimateKeywords: string;
  operationKeywords: string;
  linesJson: string;
  createdAt: Date;
  updatedAt: Date;
}): CustomLogicTemplate {
  return {
    id: row.id,
    name: row.name,
    estimateKeywords: parseStringArray(row.estimateKeywords),
    operationKeywords: parseStringArray(row.operationKeywords),
    lines: parseLines(row.linesJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function listCustomLogicTemplates(): Promise<CustomLogicTemplate[]> {
  const rows = await prisma.customLogicTemplate.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  return rows.map(toTemplate).filter((template) => template.lines.length > 0);
}

export async function upsertCustomLogicTemplate(input: {
  id?: string;
  name: string;
  estimateKeywords: string[];
  operationKeywords: string[];
  lines: Array<Partial<CustomTemplateLine>>;
}): Promise<CustomLogicTemplate> {
  const name = String(input.name || "").trim() || "Untitled Template";
  const estimateKeywords = normalizeKeywordList(input.estimateKeywords || []);
  const operationKeywords = normalizeKeywordList(input.operationKeywords || []);
  const lines = (input.lines || []).map(sanitizeLine)
    .filter((line): line is CustomTemplateLine => Boolean(line)).slice(0, 40);

  if (estimateKeywords.length === 0) throw new Error("estimateKeywords is required.");
  if (operationKeywords.length === 0) throw new Error("operationKeywords is required.");
  if (lines.length === 0) throw new Error("lines is required.");

  const data = {
    name,
    estimateKeywords: JSON.stringify(estimateKeywords),
    operationKeywords: JSON.stringify(operationKeywords),
    linesJson: JSON.stringify(lines)
  };
  const wantedId = String(input.id || "").trim();
  const row = wantedId
    ? await prisma.customLogicTemplate.upsert({
        where: { id: wantedId },
        update: data,
        create: { id: wantedId, ...data }
      })
    : await prisma.customLogicTemplate.create({ data });
  return toTemplate(row);
}

export function pickMatchingTemplate(input: {
  estimateText: string;
  operationText: string;
  templates: CustomLogicTemplate[];
}): CustomLogicTemplate | null {
  const estimateCorpus = normalizeKeyword(input.estimateText || "");
  const operationCorpus = normalizeKeyword(input.operationText || "");
  let bestTemplate: CustomLogicTemplate | null = null;
  let bestScore = -1;
  for (const template of input.templates) {
    const estimateMatchesCount = template.estimateKeywords.filter((keyword) => keywordMatchesCorpus(estimateCorpus, keyword)).length;
    if (estimateMatchesCount <= 0) continue;
    const operationMatchesCount = template.operationKeywords.filter((keyword) => keywordMatchesCorpus(operationCorpus, keyword)).length;
    if (operationMatchesCount <= 0) continue;
    const score = estimateMatchesCount * 100 + operationMatchesCount;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }
  return bestTemplate;
}
