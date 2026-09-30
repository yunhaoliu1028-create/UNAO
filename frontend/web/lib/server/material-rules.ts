import { prisma } from "@/lib/server/db";
import type { MaterialRule } from "@/generated/prisma/client";

// ── Types ────────────────────────────────────────────────────────────

export type MaterialRuleMatch = {
  rule: MaterialRule;
  /** Higher = more specific match (shop+make+model+year > make+model > make > universal). */
  specificity: number;
};

export type SaveRuleInput = {
  location: string;
  operation: string;
  make?: string | null;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  bodyMaterial?: string | null;
  productPartNo: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  source?: string;
  orgId?: string | null;
  learnedFromInvoiceId?: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeForMatch(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Compute a specificity score for a rule relative to the query.
 * Higher score = more specific and therefore higher priority.
 */
function computeSpecificity(rule: MaterialRule, query: { make?: string; model?: string; year?: number; orgId?: string }): number {
  let score = 0;
  if (rule.orgId && rule.orgId === query.orgId) score += 100; // shop-level rule
  if (rule.make) score += 10; // brand-specific
  if (rule.model) score += 5; // model-specific
  if (rule.yearFrom !== null || rule.yearTo !== null) score += 2; // year-range
  if (rule.bodyMaterial) score += 1; // material-specific
  // Penalise negative feedback
  score -= rule.negativeCount * 3;
  return score;
}

/**
 * Check whether a rule's year range includes the given year.
 */
function yearInRange(rule: MaterialRule, year: number | undefined): boolean {
  if (year === undefined || year === null) return true; // no year constraint in query
  if (rule.yearFrom !== null && year < rule.yearFrom) return false;
  if (rule.yearTo !== null && year > rule.yearTo) return false;
  return true;
}

// ── Query ────────────────────────────────────────────────────────────

/**
 * Find all matching MaterialRules for a given operation context.
 *
 * Returns rules sorted by specificity (most specific first).
 * The caller should de-duplicate by productPartNo, keeping the most
 * specific rule for each part.
 */
export async function findMatchingRules(query: {
  location: string;
  operation: string;
  make?: string;
  model?: string;
  year?: number;
  bodyMaterial?: string;
  orgId?: string;
}): Promise<MaterialRuleMatch[]> {
  const loc = normalizeForMatch(query.location);
  const op = normalizeForMatch(query.operation);

  if (!loc || !op) return [];

  // Fetch all rules that could match this location + operation.
  // SQLite doesn't have ILIKE, so we do case-insensitive matching in JS.
  const candidates = await prisma.materialRule.findMany({
    where: {
      // Prisma SQLite: `contains` is case-insensitive by default for SQLite.
      location: { contains: loc },
      operation: { contains: op },
    },
    orderBy: { usageCount: "desc" },
    take: 200,
  });

  const qMake = normalizeForMatch(query.make);
  const qModel = normalizeForMatch(query.model);

  const matches: MaterialRuleMatch[] = [];

  for (const rule of candidates) {
    const ruleMake = normalizeForMatch(rule.make);
    const ruleModel = normalizeForMatch(rule.model);

    // Make filter: universal rules always pass; brand rules only if make matches.
    if (ruleMake && ruleMake !== qMake) continue;

    // Model filter: same logic.
    if (ruleModel && ruleModel !== qModel) continue;

    // Year filter.
    if (!yearInRange(rule, query.year)) continue;

    // Body material filter.
    if (rule.bodyMaterial && query.bodyMaterial) {
      if (normalizeForMatch(rule.bodyMaterial) !== normalizeForMatch(query.bodyMaterial)) continue;
    }

    // Org filter: include platform rules (orgId=null) and matching shop rules.
    if (rule.orgId && rule.orgId !== query.orgId) continue;

    matches.push({
      rule,
      specificity: computeSpecificity(rule, query),
    });
  }

  // Sort by specificity descending.
  matches.sort((a, b) => b.specificity - a.specificity);

  return matches;
}

/**
 * De-duplicate matched rules: for each productPartNo, keep only the
 * most specific rule.  Returns the winning rules in description order.
 */
export function deduplicateRules(matches: MaterialRuleMatch[]): MaterialRule[] {
  const byPartNo = new Map<string, MaterialRuleMatch>();
  for (const m of matches) {
    const key = m.rule.productPartNo.toLowerCase();
    const existing = byPartNo.get(key);
    if (!existing || m.specificity > existing.specificity) {
      byPartNo.set(key, m);
    }
  }
  return Array.from(byPartNo.values())
    .map((m) => m.rule)
    .sort((a, b) => a.description.localeCompare(b.description));
}

// ── Write ────────────────────────────────────────────────────────────

/**
 * Save one material rule (upsert by location+operation+make+model+partNo+orgId).
 */
export async function saveRule(input: SaveRuleInput): Promise<MaterialRule> {
  const loc = normalizeForMatch(input.location);
  const op = normalizeForMatch(input.operation);
  const make = input.make ? normalizeForMatch(input.make) : null;
  const model = input.model ? normalizeForMatch(input.model) : null;
  const partNo = input.productPartNo.trim();
  const orgId = input.orgId || null;

  // Check for existing rule with same key dimensions.
  const existing = await prisma.materialRule.findFirst({
    where: {
      location: loc,
      operation: op,
      make: make ?? undefined,
      model: model ?? undefined,
      productPartNo: partNo,
      orgId: orgId ?? undefined,
    },
  });

  if (existing) {
    return prisma.materialRule.update({
      where: { id: existing.id },
      data: {
        description: input.description,
        qty: input.qty,
        unit: input.unit,
        unitPrice: input.unitPrice,
        yearFrom: input.yearFrom ?? existing.yearFrom,
        yearTo: input.yearTo ?? existing.yearTo,
        bodyMaterial: input.bodyMaterial ?? existing.bodyMaterial,
        source: input.source ?? existing.source,
        learnedFromInvoiceId: input.learnedFromInvoiceId ?? existing.learnedFromInvoiceId,
      },
    });
  }

  return prisma.materialRule.create({
    data: {
      location: loc,
      operation: op,
      make,
      model,
      yearFrom: input.yearFrom ?? null,
      yearTo: input.yearTo ?? null,
      bodyMaterial: input.bodyMaterial ?? null,
      productPartNo: partNo,
      description: input.description,
      qty: input.qty,
      unit: input.unit,
      unitPrice: input.unitPrice,
      source: input.source ?? "user_learned",
      orgId,
      learnedFromInvoiceId: input.learnedFromInvoiceId ?? null,
    },
  });
}

/**
 * Save multiple rules at once (batch from "Save as Rule" UI).
 */
export async function saveRulesFromInvoice(input: {
  location: string;
  operation: string;
  make?: string | null;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  bodyMaterial?: string | null;
  orgId?: string | null;
  invoiceId?: string | null;
  lines: Array<{
    productPartNo: string;
    description: string;
    qty: number;
    unit: string;
    unitPrice: number;
  }>;
}): Promise<MaterialRule[]> {
  const results: MaterialRule[] = [];
  for (const line of input.lines) {
    const rule = await saveRule({
      location: input.location,
      operation: input.operation,
      make: input.make,
      model: input.model,
      yearFrom: input.yearFrom,
      yearTo: input.yearTo,
      bodyMaterial: input.bodyMaterial,
      orgId: input.orgId,
      learnedFromInvoiceId: input.invoiceId,
      productPartNo: line.productPartNo,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      source: "user_learned",
    });
    results.push(rule);
  }
  return results;
}

/**
 * Increment usage count when a rule is used in an invoice.
 */
export async function recordRuleUsage(ruleId: string): Promise<void> {
  await prisma.materialRule.update({
    where: { id: ruleId },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

/**
 * Record negative feedback ("this doesn't apply").
 */
export async function recordRuleNegative(ruleId: string): Promise<void> {
  await prisma.materialRule.update({
    where: { id: ruleId },
    data: {
      negativeCount: { increment: 1 },
    },
  });
}

/**
 * List all rules, optionally filtered by source.
 */
export async function listRules(filter?: { source?: string; orgId?: string; take?: number }): Promise<MaterialRule[]> {
  return prisma.materialRule.findMany({
    where: {
      source: filter?.source,
      orgId: filter?.orgId,
    },
    orderBy: [{ usageCount: "desc" }, { createdAt: "desc" }],
    take: filter?.take ?? 2000,
  });
}

/**
 * Delete a rule by id.
 */
export async function deleteRule(id: string): Promise<void> {
  await prisma.materialRule.delete({ where: { id } });
}
