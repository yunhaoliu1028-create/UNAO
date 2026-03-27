export type InvoiceMeta = {
  invoiceNo: string;
  roNo: string;
  vin: string;
  yearMakeModel: string;
  repairDate: string;
  currency: string;
  notes: string;
};

export type InvoiceLine = {
  id: string;
  operation: string;
  group?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  source: string;
};

export type OperationDetectionCandidate = {
  source: "direct" | "line";
  raw: string;
  normalized: string;
  kept: boolean;
  reason: string;
};

type CatalogRule = {
  id: string;
  triggers: string[];
  lines: Array<{
    description: string;
    qty: number;
    unit: string;
    unitPrice: number;
  }>;
};

const catalogRules: CatalogRule[] = [
  {
    id: "rule-body-panel",
    triggers: ["body panel", "quarter", "door", "fender", "panel", "roof"],
    lines: [
      { description: "3M Panel Bonding Adhesive", qty: 1.0, unit: "Cartridge", unitPrice: 122.01 },
      { description: "3M Urethane Seam Sealer - White", qty: 1.0, unit: "Sachet", unitPrice: 53.46 }
    ]
  },
  {
    id: "rule-floor-rail",
    triggers: ["floor", "rail", "frame", "extension", "rocker"],
    lines: [
      { description: "3M Weld-Thru Coating II", qty: 0.4, unit: "Can", unitPrice: 78.17 },
      { description: "3M Cavity Wax Plus", qty: 0.8, unit: "Can", unitPrice: 58.21 },
      { description: "3M Rubberized Undercoating", qty: 1.0, unit: "Can", unitPrice: 40.17 }
    ]
  },
  {
    id: "rule-surface-refinish",
    triggers: ["blend", "refinish", "paint", "bumper", "hood", "liftgate"],
    lines: [
      { description: "3M Cubitron II Cut-Off Wheel", qty: 1.0, unit: "Wheel", unitPrice: 16.82 },
      { description: "3M Cubitron II File Belt 786F, 80+", qty: 2.0, unit: "Belt", unitPrice: 6.43 },
      { description: "3M NVH Dampening Material", qty: 0.3, unit: "Cartridge", unitPrice: 118.76 }
    ]
  }
];

export function parseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function calcLineAmount(line: InvoiceLine): number {
  return parseNumber(line.qty) * parseNumber(line.unitPrice);
}

export function detectOperationsDetailed(rawText: string): {
  operations: string[];
  candidates: OperationDetectionCandidate[];
} {
  const opKeywords = [
    "panel",
    "bumper",
    "fender",
    "hood",
    "door",
    "quarter",
    "rail",
    "frame",
    "roof",
    "floor",
    "liftgate",
    "blend",
    "refinish",
    "repair",
    "replace"
  ];
  const operationSynonyms: Array<[RegExp, string]> = [
    [/\b(repl|rpl)\b/gi, "replace"],
    [/\b(r&r|r\/r|remove\s*&\s*replace)\b/gi, "replace"],
    [/\b(r&i|r\/i|remove\s*&\s*install)\b/gi, "remove install"],
    [/\b(rep|rpr)\b/gi, "repair"],
    [/\brefin\b/gi, "refinish"],
    [/\bblnd\b/gi, "blend"],
    [/\bsublt\b/gi, "sublet"]
  ];

  function normalizeOperationText(value: string): string {
    const normalized = operationSynonyms.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), value);
    return normalized
      .replace(/\bline#?\s*\d{1,4}\b/gi, " ")
      .replace(/^\s*\d{1,4}\s+/g, "")
      .replace(/\ba\/m\b/gi, " ")
      .replace(/\b(capa|keysiq|nsf|oem|opt\s+oem|alt\s+oem)\b/gi, " ")
      .replace(/\blift[\s\-]*gate\b/gi, "liftgate")
      .replace(/\bbumper[\s\-]*cover\b/gi, "bumper cover");
  }

  function hasActionToken(value: string): boolean {
    return /\b(replace|repair|remove|install|refinish|blend|patch)\b/i.test(value);
  }

  function looksLikeSectionHeading(value: string): boolean {
    const cleaned = value.replace(/[^\w\s/&-]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned) {
      return false;
    }
    const tokens = cleaned.split(" ").filter(Boolean);
    const isMostlyUpper = cleaned === cleaned.toUpperCase();
    return tokens.length <= 6 && isMostlyUpper && !hasActionToken(cleaned);
  }

  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 240);

  const found = new Set<string>();
  const candidates: OperationDetectionCandidate[] = [];
  const normalizedRaw = normalizeOperationText(rawText);
  const keywordPattern = opKeywords.join("|");
  const leadingActionPattern = new RegExp(
    `\\b(?:replace|repair|refinish|blend)\\b(?:[\\s:/\\-]+[a-z0-9]+){0,6}[\\s:/\\-]+(?:${keywordPattern})\\b`,
    "gi"
  );
  const trailingActionPattern = new RegExp(
    `\\b(?:${keywordPattern})\\b(?:[\\s:/\\-]+[a-z0-9]+){0,4}[\\s:/\\-]+(?:replace|repair|refinish|blend)\\b`,
    "gi"
  );

  const directMatches = [...normalizedRaw.matchAll(leadingActionPattern), ...normalizedRaw.matchAll(trailingActionPattern)];
  for (const match of directMatches) {
    const rawSnippet = String(match[0] || "");
    const snippet = normalizeOperationText(rawSnippet).replace(/\s+/g, " ").trim();
    if (!snippet) {
      continue;
    }
    const lower = snippet.toLowerCase();
    const ignored = /\b(sublet|sublt)\b/.test(lower);
    candidates.push({
      source: "direct",
      raw: rawSnippet,
      normalized: snippet,
      kept: !ignored,
      reason: ignored ? "sublet ignored" : "pattern match"
    });
    if (!ignored) {
      found.add(snippet);
    }
  }

  for (const line of lines) {
    const normalizedLine = normalizeOperationText(line);
    const lower = normalizedLine.toLowerCase();
    if (lower.includes("description") && lower.includes("qty")) {
      candidates.push({
        source: "line",
        raw: line,
        normalized: normalizedLine.replace(/\s+/g, " "),
        kept: false,
        reason: "header row ignored"
      });
      continue;
    }
    if (looksLikeSectionHeading(line)) {
      candidates.push({
        source: "line",
        raw: line,
        normalized: normalizedLine.replace(/\s+/g, " "),
        kept: false,
        reason: "section heading ignored"
      });
      continue;
    }
    if (/\b(sublet|sublt)\b/.test(lower)) {
      candidates.push({
        source: "line",
        raw: line,
        normalized: normalizedLine.replace(/\s+/g, " "),
        kept: false,
        reason: "sublet ignored"
      });
      continue;
    }
    if (opKeywords.some((k) => lower.includes(k))) {
      const normalized = normalizedLine.replace(/\s+/g, " ");
      found.add(normalized);
      candidates.push({
        source: "line",
        raw: line,
        normalized,
        kept: true,
        reason: "keyword match"
      });
      continue;
    }
    candidates.push({
      source: "line",
      raw: line,
      normalized: normalizedLine.replace(/\s+/g, " "),
      kept: false,
      reason: "no operation keyword"
    });
  }

  const cleaned = Array.from(found).slice(0, 20);
  if (cleaned.length > 0) {
    return { operations: cleaned, candidates: candidates.slice(0, 160) };
  }
  return {
    operations: ["General Repair Operation (manual review needed)"],
    candidates: candidates.slice(0, 160)
  };
}

export function detectOperations(rawText: string): string[] {
  return detectOperationsDetailed(rawText).operations;
}

function pickClosestYearToAnchor(rawText: string, anchorIndex: number | null): string {
  const yearMatches = Array.from(rawText.matchAll(/\b(19\d{2}|20\d{2})\b/g));
  if (yearMatches.length === 0) {
    return "";
  }
  if (anchorIndex === null) {
    return yearMatches[0][1];
  }
  let picked = yearMatches[0];
  let bestDistance = Math.abs((picked.index ?? 0) - anchorIndex);
  for (const match of yearMatches) {
    const distance = Math.abs((match.index ?? 0) - anchorIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      picked = match;
    }
  }
  return picked[1];
}

function sanitizeTextForDisplay(value: string): string {
  return value
    .replace(/ï¿½|�/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractMetadata(rawText: string): Partial<InvoiceMeta> {
  const roMatch = rawText.match(/\b(?:RO\s*(?:Number)?|Repair\s*Order)\s*#?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
  const vinMatch = rawText.match(/\bVIN\s*[:\-]?\s*([A-HJ-NPR-Z0-9]{11,17})/i);
  const makeMatch = rawText.match(/\b(TOYOTA|HONDA|FORD|CHEVROLET|NISSAN|BMW|AUDI|LEXUS|KIA|HYUNDAI)\b/i);
  const modelMatch = rawText.match(
    /\b(RAV4|CAMRY|COROLLA|CIVIC|ACCORD|F150|SILVERADO|CR-V|MODEL\s?[A-Z0-9\-]+)\b/i
  );
  const dateMatch = rawText.match(/\b([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\b/);

  const anchorCandidates = [makeMatch?.index, modelMatch?.index].filter((value): value is number => typeof value === "number");
  const anchorIndex = anchorCandidates.length > 0 ? Math.min(...anchorCandidates) : null;
  const year = pickClosestYearToAnchor(rawText, anchorIndex);
  const make = makeMatch ? makeMatch[1].toUpperCase() : "";
  const model = modelMatch ? modelMatch[1].toUpperCase() : "";
  const yearMakeModel = [year, make, model].filter(Boolean).join(" ").trim();

  return {
    roNo: roMatch?.[1] ?? "",
    vin: vinMatch?.[1] ?? "",
    yearMakeModel,
    repairDate: dateMatch?.[1] ?? ""
  };
}

function chooseRule(operation: string): CatalogRule | null {
  const lower = operation.toLowerCase();
  for (const rule of catalogRules) {
    if (rule.triggers.some((keyword) => lower.includes(keyword))) {
      return rule;
    }
  }
  return null;
}

function isCosmeticOnlyOperation(operation: string): boolean {
  const lower = operation.toLowerCase();
  const hasBlendOrRefinish = /\b(blend|refinish)\b/.test(lower);
  const hasStructuralAction = /\b(replace|repair|remove|install|patch)\b/.test(lower);
  return hasBlendOrRefinish && !hasStructuralAction;
}

export function generateFallbackLines(operations: string[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];

  operations.forEach((operation) => {
    if (isCosmeticOnlyOperation(operation)) {
      return;
    }
    const rule = chooseRule(operation);
    const source = rule ? `auto:${rule.id}` : "auto:fallback";
    const seed = rule
      ? rule.lines
      : [
          { description: "Shop Consumable Material", qty: 1.0, unit: "Each", unitPrice: 24.99 },
          { description: "Surface Prep / Masking Supplies", qty: 1.0, unit: "Set", unitPrice: 16.5 }
        ];

    seed.forEach((item, index) => {
      lines.push({
        id: `${operation}-${index}-${Math.random().toString(16).slice(2)}`,
        operation,
        description: item.description,
        qty: item.qty,
        unit: item.unit,
        unitPrice: item.unitPrice,
        source
      });
    });
  });

  return lines;
}

type GenerateInvoiceRequest = {
  estimateText: string;
  operations: string[];
  tier?: "T1" | "T2" | "T3";
};

type GenerateInvoiceResponse = {
  lines: InvoiceLine[];
  unmatched_operations?: string[];
  warnings?: string[];
};

export async function generateInvoiceViaApi(
  apiBaseUrl: string,
  payload: GenerateInvoiceRequest
): Promise<GenerateInvoiceResponse | null> {
  if (!apiBaseUrl) {
    return null;
  }

  const url = `${apiBaseUrl.replace(/\/$/, "")}/v1/invoices/generate`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as Partial<GenerateInvoiceResponse>;
    if (!Array.isArray(data.lines)) {
      return null;
    }

    return {
      lines: data.lines.map((line, index) => ({
        id: line.id || `api-${index}-${Math.random().toString(16).slice(2)}`,
        operation: sanitizeTextForDisplay(line.operation || "Unknown"),
        group: line.group ? sanitizeTextForDisplay(String(line.group)) : undefined,
        description: sanitizeTextForDisplay(line.description || ""),
        qty: parseNumber(line.qty, 0),
        unit: sanitizeTextForDisplay(line.unit || "Each"),
        unitPrice: parseNumber(line.unitPrice, 0),
        source: sanitizeTextForDisplay(line.source || "api")
      })),
      unmatched_operations: Array.isArray(data.unmatched_operations)
        ? data.unmatched_operations.map((item) => sanitizeTextForDisplay(String(item || ""))).filter(Boolean)
        : [],
      warnings: Array.isArray(data.warnings)
        ? data.warnings.map((item) => sanitizeTextForDisplay(String(item || ""))).filter(Boolean)
        : []
    };
  } catch {
    return null;
  }
}
