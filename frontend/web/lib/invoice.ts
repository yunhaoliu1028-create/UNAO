export type InvoiceMeta = {
  invoiceNo: string;
  roNo: string;
  vin: string;
  yearMakeModel: string;
  insuranceCompany?: string;
  repairDate: string;
  currency: string;
  notes: string;
};

export type InvoiceLine = {
  id: string;
  operation: string;
  group?: string;
  partNo?: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  source: string;
};

/**
 * Parse a "Year Make Model" string (e.g. "2022 HONDA CIVIC") into
 * structured vehicle context for three-layer rule matching.
 * Handles CCC ONE abbreviated makes (HOND→HONDA, TOYO→TOYOTA, etc.).
 */
export function parseVehicleFromYMM(yearMakeModel: string): {
  make?: string;
  model?: string;
  year?: number;
} {
  const text = String(yearMakeModel || "").trim();
  if (!text) return {};

  // Resolve CCC abbreviated make into canonical form for consistent DB matching.
  function resolveMake(raw: string): string {
    const upper = raw.toUpperCase();
    return KNOWN_MAKES[upper] || upper;
  }

  // Try "YEAR MAKE MODEL" pattern
  const match = text.match(/^(\d{4})\s+(\S+)\s+(.+)$/i);
  if (match) {
    const year = parseInt(match[1], 10);
    return {
      year: year >= 1980 && year <= 2040 ? year : undefined,
      make: resolveMake(match[2].trim()) || undefined,
      model: match[3].trim() || undefined,
    };
  }
  // Try "MAKE MODEL" without year
  const noYear = text.match(/^([A-Za-z]+)\s+(.+)$/);
  if (noYear) {
    return {
      make: resolveMake(noYear[1].trim()) || undefined,
      model: noYear[2].trim() || undefined,
    };
  }
  return {};
}

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
    [/\bsect\b/gi, "section"],
    [/\bsection\b/gi, "replace"],
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
      .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi, " ")
      .replace(/\ba\/m\b/gi, " ")
      .replace(/\b(?:frm|from)\b/gi, " ")
      .replace(/\b(capa|keysiq|nsf|oem|opt\s+oem|alt\s+oem)\b/gi, " ")
      .replace(/\blift[\s\-]*gate\b/gi, "liftgate")
      .replace(/\bbumper[\s\-]*cover\b/gi, "bumper cover");
  }

  function hasActionToken(value: string): boolean {
    return /\b(replace|repair|remove|install|section|refinish|blend|patch)\b/i.test(value);
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
    `\\b(?:replace|repair|section|refinish|blend)\\b(?:[\\s:/\\-]+[a-z0-9]+){0,6}[\\s:/\\-]+(?:${keywordPattern})\\b`,
    "gi"
  );
  const trailingActionPattern = new RegExp(
    `\\b(?:${keywordPattern})\\b(?:[\\s:/\\-]+[a-z0-9]+){0,4}[\\s:/\\-]+(?:replace|repair|section|refinish|blend)\\b`,
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

function extractInsuranceCompany(rawText: string): string {
  const source = String(rawText || "");
  const upperSource = source.toUpperCase();
  const compactSource = upperSource.replace(/[^A-Z]/g, "");
  const knownCarriers: Array<{ pattern: RegExp; compactKey: string; label: string }> = [
    { pattern: /\bSTATE\s*FARM\b/i, compactKey: "STATEFARM", label: "STATE FARM" },
    { pattern: /\bAMERICAN\s+FAMILY(?:\s+INSURANCE)?\b/i, compactKey: "AMERICANFAMILY", label: "AMERICAN FAMILY" },
    { pattern: /\bAUTO\s+CLUB\s+ENTERPRISES\b/i, compactKey: "AUTOCLUBENTERPRISES", label: "AUTO CLUB ENTERPRISES" },
    { pattern: /\bAAA\b/i, compactKey: "AAA", label: "AAA" },
    { pattern: /\bALLSTATE\b/i, compactKey: "ALLSTATE", label: "ALLSTATE" },
    { pattern: /\bGEICO\b/i, compactKey: "GEICO", label: "GEICO" },
    { pattern: /\bPROGRESSIVE\b/i, compactKey: "PROGRESSIVE", label: "PROGRESSIVE" },
    { pattern: /\bLIBERTY\s+MUTUAL\b/i, compactKey: "LIBERTYMUTUAL", label: "LIBERTY MUTUAL" },
    { pattern: /\bNATIONWIDE\b/i, compactKey: "NATIONWIDE", label: "NATIONWIDE" },
    { pattern: /\bFARMERS\s+INSURANCE\b/i, compactKey: "FARMERSINSURANCE", label: "FARMERS INSURANCE" },
    { pattern: /\bTRAVELERS\b/i, compactKey: "TRAVELERS", label: "TRAVELERS" }
  ];

  // Prefer known carrier names first so person names in nearby fields
  // (e.g. Insured/Owner) do not override carrier detection.
  for (const carrier of knownCarriers) {
    if (carrier.pattern.test(upperSource) || compactSource.includes(carrier.compactKey)) {
      return carrier.label;
    }
  }

  function sanitizeInsuranceCandidate(value: string): string {
    const cleaned = String(value || "")
      .replace(/\b(insured|owner|policy|claim|type of loss|date of loss)\b.*$/i, "")
      .replace(/\s+-\s+[A-Z0-9]{2,8}\b.*$/i, "")
      .replace(/\s+\d{4,}.*$/i, "")
      .replace(/\s{2,}.*/g, "")
      .replace(/[|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) {
      return "";
    }
    for (const carrier of knownCarriers) {
      if (carrier.pattern.test(cleaned) || cleaned.toUpperCase().replace(/[^A-Z]/g, "").includes(carrier.compactKey)) {
        return carrier.label;
      }
    }
    const likelyPersonName = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(cleaned);
    if (likelyPersonName && !/\binsurance|ins\b/i.test(cleaned)) {
      return "";
    }
    if (/,/.test(cleaned) && !/\binsurance|ins\b/i.test(cleaned)) {
      return "";
    }
    return cleaned;
  }

  const lines = source
    .split(/\r?\n/)
    .flatMap((line) => line.split("|"))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/\b(insurance\s*company|insurance\s*co\.?|insurer|carrier)\b/i.test(line)) {
      continue;
    }
    const afterLabel = line.replace(/^.*?\b(insurance\s*company|insurance\s*co\.?|insurer|carrier)\b\s*[:\-]?\s*/i, "").trim();
    if (afterLabel) {
      const candidate = afterLabel
        .split(/\s{2,}|,\s*(?=[A-Z][a-z])|\s+\d{4,}|\s+-\s+[A-Z0-9]{2,8}\b/)
        .map((part) => part.trim())
        .map((part) => sanitizeInsuranceCandidate(part))
        .find((part) => part.length >= 3);
      if (candidate) {
        return candidate;
      }
    } else {
      // Some PDFs render "Insurance Company:" in one token and the actual
      // company name in the next token/line. Probe a short lookahead window.
      for (let lookahead = 1; lookahead <= 3; lookahead += 1) {
        const nextLine = lines[index + lookahead];
        if (!nextLine) {
          break;
        }
        if (/\b(owner|insured|inspection location|repair facility|vehicle|claim|policy|date of loss)\b/i.test(nextLine)) {
          break;
        }
        const candidate = sanitizeInsuranceCandidate(nextLine);
        if (candidate.length >= 3) {
          return candidate;
        }
      }
    }
  }

  const fallbackMatch = source.match(/\b(?:insurance\s*company|insurance\s*co\.?|insurer|carrier)\s*[:\-]?\s*([A-Za-z0-9 .&'-]{3,80})/i);
  return sanitizeInsuranceCandidate(fallbackMatch?.[1] || "");
}

// ── CCC ONE make abbreviation map ────────────────────────────────────
// CCC ONE uses 4-letter abbreviated makes. Map both abbreviations and
// full names so we can recognise either format from any estimate source.
const KNOWN_MAKES: Record<string, string> = {
  // CCC abbreviation → canonical display name
  ACUR: "ACURA", ALFA: "ALFA ROMEO", AUDI: "AUDI", BMW: "BMW",
  BUIC: "BUICK", CADI: "CADILLAC", CHEV: "CHEVROLET", CHRY: "CHRYSLER",
  DODG: "DODGE", FIAT: "FIAT", FORD: "FORD", GENE: "GENESIS",
  GMC: "GMC", HOND: "HONDA", HYUN: "HYUNDAI", INFI: "INFINITI",
  JAGU: "JAGUAR", JEEP: "JEEP", KIA: "KIA", LAND: "LAND ROVER",
  LEXU: "LEXUS", LINC: "LINCOLN", MAZD: "MAZDA", MERZ: "MERCEDES-BENZ",
  MERC: "MERCURY", MINI: "MINI", MITS: "MITSUBISHI", NISS: "NISSAN",
  PONT: "PONTIAC", PORS: "PORSCHE", RAM: "RAM", RIVN: "RIVIAN",
  SATU: "SATURN", SUBA: "SUBARU", SUZU: "SUZUKI", TESL: "TESLA",
  TOYO: "TOYOTA", VOLK: "VOLKSWAGEN", VOLV: "VOLVO",
  // Full names → themselves (for non-CCC estimates)
  ACURA: "ACURA", TOYOTA: "TOYOTA", HONDA: "HONDA", CHEVROLET: "CHEVROLET",
  CHRYSLER: "CHRYSLER", DODGE: "DODGE", NISSAN: "NISSAN", HYUNDAI: "HYUNDAI",
  LEXUS: "LEXUS", INFINITI: "INFINITI", LINCOLN: "LINCOLN", CADILLAC: "CADILLAC",
  BUICK: "BUICK", MAZDA: "MAZDA", SUBARU: "SUBARU", MITSUBISHI: "MITSUBISHI",
  VOLKSWAGEN: "VOLKSWAGEN", PORSCHE: "PORSCHE", JAGUAR: "JAGUAR",
  SATURN: "SATURN", PONTIAC: "PONTIAC", MERCURY: "MERCURY", SUZUKI: "SUZUKI",
  GENESIS: "GENESIS", TESLA: "TESLA", RIVIAN: "RIVIAN",
  "MERCEDES-BENZ": "MERCEDES-BENZ", "LAND ROVER": "LAND ROVER",
  "ALFA ROMEO": "ALFA ROMEO",
};

// Build a regex alternation of all known make tokens (longest first to prevent partial matches).
const MAKE_TOKENS = Object.keys(KNOWN_MAKES)
  .filter((k) => !k.includes(" ") && !k.includes("-"))
  .sort((a, b) => b.length - a.length);
const MAKE_PATTERN = new RegExp(`\\b(${MAKE_TOKENS.join("|")})\\b`, "i");

/** Normalise a raw make string into its canonical form. */
function normalizeMake(raw: string): string {
  const upper = raw.trim().toUpperCase();
  return KNOWN_MAKES[upper] || upper;
}

export function extractMetadata(rawText: string): Partial<InvoiceMeta> {
  const roMatch = rawText.match(/\b(?:RO\s*(?:Number)?|Repair\s*Order)\s*#?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
  const vinMatch = rawText.match(/\bVIN\s*[:\-]?\s*([A-HJ-NPR-Z0-9]{11,17})/i);
  const dateMatch = rawText.match(/\b([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\b/);

  let year = "";
  let make = "";
  let model = "";

  // ── Strategy 1: CCC ONE structured fields ─────────────────────────
  // "Year:  2008", "Make:  HOND", "Model:  ACCORD EX"
  const yearField = rawText.match(/\bYear\s*[:\-]\s*((?:19|20)\d{2})\b/i);
  const makeField = rawText.match(/\bMake\s*[:\-]\s*([A-Z]{2,20})\b/i);
  const modelField = rawText.match(/\bModel\s*[:\-]\s*([A-Z0-9][A-Z0-9 \-\/]{0,40}?)(?:\s{2,}|$|\n)/i);

  if (makeField) {
    year = yearField?.[1] || "";
    make = normalizeMake(makeField[1]);
    model = (modelField?.[1] || "").trim().toUpperCase();
  }

  // ── Strategy 2: CCC ONE inline header ─────────────────────────────
  // "Vehicle: 2008 HOND ACCORD EX 4D SED 6-3.5L-FI GOLD"
  if (!make) {
    const vehicleHeaderMatch = rawText.match(
      /\bVehicle\s*[:\-]\s*((?:19|20)\d{2})\s+([A-Z]{2,20})\s+([A-Z0-9][A-Z0-9 \-\/]*?)(?:\s+(?:\d+D\s+\w+|\d+-[\d.]+L|[A-Z]{2,5}\s+\w+)\b)/i
    );
    if (vehicleHeaderMatch) {
      year = vehicleHeaderMatch[1];
      make = normalizeMake(vehicleHeaderMatch[2]);
      model = vehicleHeaderMatch[3].trim().toUpperCase();
    }
  }

  // ── Strategy 3: Generic "YEAR MAKE MODEL" anywhere in text ────────
  // Works for any estimate format: "2022 HONDA CIVIC", "2019 TOYO RAV4"
  if (!make) {
    const genericMatch = rawText.match(
      new RegExp(`\\b((?:19|20)\\d{2})\\s+(${MAKE_TOKENS.join("|")})\\s+([A-Z0-9][A-Z0-9 \\-\\/]{1,30}?)(?:\\s{2,}|\\s+\\d|\\s+[a-z]|$|\\n)`, "i")
    );
    if (genericMatch) {
      year = genericMatch[1];
      make = normalizeMake(genericMatch[2]);
      // Clean model: remove trailing body-style/engine tokens like "4D SED", "6-3.5L"
      model = genericMatch[3]
        .replace(/\s+\d+D\s+.*$/i, "")
        .replace(/\s+\d+-[\d.]+L.*$/i, "")
        .trim()
        .toUpperCase();
    }
  }

  // ── Strategy 4: Individual field extraction (fallback) ────────────
  if (!make) {
    const makeMatch = rawText.match(MAKE_PATTERN);
    if (makeMatch) {
      make = normalizeMake(makeMatch[1]);
      // Try to find model near the make match
      const afterMake = rawText.slice((makeMatch.index ?? 0) + makeMatch[0].length);
      const modelAfter = afterMake.match(/^\s+([A-Z0-9][A-Z0-9 \-\/]{1,25}?)(?:\s{2,}|\s+\d|$|\n)/i);
      if (modelAfter) {
        model = modelAfter[1].trim().toUpperCase();
      }
    }
  }

  // ── Year fallback: find closest year to make/model anchor ─────────
  if (!year && make) {
    const makeIdx = rawText.toUpperCase().indexOf(make.length <= 4 ? make.slice(0, 4).toUpperCase() : make.toUpperCase());
    year = pickClosestYearToAnchor(rawText, makeIdx >= 0 ? makeIdx : null);
  }
  if (!year) {
    year = pickClosestYearToAnchor(rawText, null);
  }

  const yearMakeModel = [year, make, model].filter(Boolean).join(" ").trim();

  return {
    roNo: roMatch?.[1] ?? "",
    vin: vinMatch?.[1] ?? "",
    yearMakeModel,
    insuranceCompany: extractInsuranceCompany(rawText),
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
        partNo: "",
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
  operationGroupHints?: Record<string, string>;
  vehicle?: { make?: string; model?: string; year?: number; bodyMaterial?: string };
  orgId?: string;
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
      lines: data.lines.map((line, index) => {
        const lineWithLegacyPart = line as InvoiceLine & { part_no?: unknown };
        const rawPartNo = lineWithLegacyPart.partNo ?? lineWithLegacyPart.part_no ?? "";
        return {
          id: line.id || `api-${index}-${Math.random().toString(16).slice(2)}`,
          operation: sanitizeTextForDisplay(line.operation || "Unknown"),
          group: line.group ? sanitizeTextForDisplay(String(line.group)) : undefined,
          partNo: sanitizeTextForDisplay(String(rawPartNo || "")),
          description: sanitizeTextForDisplay(line.description || ""),
          qty: parseNumber(line.qty, 0),
          unit: sanitizeTextForDisplay(line.unit || "Each"),
          unitPrice: parseNumber(line.unitPrice, 0),
          source: sanitizeTextForDisplay(line.source || "api")
        };
      }),
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
