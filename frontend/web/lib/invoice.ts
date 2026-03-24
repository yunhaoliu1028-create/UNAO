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
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  source: string;
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

export function detectOperations(rawText: string): string[] {
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

  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 120);

  const found = new Set<string>();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("description") && lower.includes("qty")) {
      continue;
    }
    if (opKeywords.some((k) => lower.includes(k))) {
      found.add(line.replace(/\s+/g, " "));
    }
  }

  const cleaned = Array.from(found).slice(0, 20);
  if (cleaned.length > 0) {
    return cleaned;
  }
  return ["General Repair Operation (manual review needed)"];
}

export function extractMetadata(rawText: string): Partial<InvoiceMeta> {
  const roMatch = rawText.match(/\bRO\s*#?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
  const vinMatch = rawText.match(/\bVIN\s*[:\-]?\s*([A-HJ-NPR-Z0-9]{11,17})/i);
  const yearMatch = rawText.match(/\b(19\d{2}|20\d{2})\b/);
  const makeMatch = rawText.match(/\b(TOYOTA|HONDA|FORD|CHEVROLET|NISSAN|BMW|AUDI|LEXUS|KIA|HYUNDAI)\b/i);
  const modelMatch = rawText.match(
    /\b(RAV4|CAMRY|COROLLA|CIVIC|ACCORD|F150|SILVERADO|CR-V|MODEL\s?[A-Z0-9\-]+)\b/i
  );
  const dateMatch = rawText.match(/\b([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})\b/);

  const year = yearMatch ? yearMatch[1] : "";
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

export function generateFallbackLines(operations: string[]): InvoiceLine[] {
  const lines: InvoiceLine[] = [];

  operations.forEach((operation) => {
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
};

type GenerateInvoiceResponse = {
  lines: InvoiceLine[];
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
        operation: line.operation || "Unknown",
        description: line.description || "",
        qty: parseNumber(line.qty, 0),
        unit: line.unit || "Each",
        unitPrice: parseNumber(line.unitPrice, 0),
        source: line.source || "api"
      }))
    };
  } catch {
    return null;
  }
}
