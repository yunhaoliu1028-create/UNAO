import OpenAI from "openai";

type AnalyzeEstimateResult = {
  operations: string[];
  source: "openai" | "fallback";
  note?: string;
};

function normalizeOperationText(value: string): string {
  return value
    .replace(/\b(repl|rpl)\b/gi, "Replace")
    .replace(/\b(r&r|remove\s*&\s*replace)\b/gi, "Replace")
    .replace(/\b(r&i|r\/i|remove\s*&\s*install)\b/gi, "Remove Install")
    .replace(/\b(rep|rpr)\b/gi, "Repair")
    .replace(/\brefin\b/gi, "Refinish")
    .replace(/\bblnd\b/gi, "Blend")
    .replace(/\bsublt\b/gi, "Sublet")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOperationList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  for (const item of value) {
    const normalized = normalizeOperationText(String(item || ""));
    if (normalized) {
      unique.add(normalized);
    }
    if (unique.size >= 40) {
      break;
    }
  }
  return Array.from(unique);
}

export async function analyzeEstimateWithOpenAI(input: {
  estimateText: string;
  fallbackOperations: string[];
}): Promise<AnalyzeEstimateResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { operations: input.fallbackOperations, source: "fallback", note: "OPENAI_API_KEY is missing." };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const client = new OpenAI({ apiKey });

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract collision repair operations from estimate text. Return strict JSON only with shape: {\"operations\": string[]}. " +
            "Each operation should be concise and normalized, e.g. 'Rear Body Panel Replace', 'Quarter Panel Repair'. " +
            "Normalize abbreviations: REPL/RPL/R&R => Replace; R&I => Remove Install; REP/RPR => Repair; REFIN => Refinish; BLND => Blend; SUBLT => Sublet. " +
            "Drop cosmetic-only operations (Blend/Refinish without Repair/Replace) and drop Sublet operations."
        },
        {
          role: "user",
          content:
            `Extract operation names from this estimate text. Keep only repair operations relevant to material usage.\n\n` +
            `Estimate text:\n${input.estimateText.slice(0, 16000)}\n\n` +
            `Fallback operations (for reference): ${JSON.stringify(input.fallbackOperations)}`
        }
      ]
    });

    const content = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { operations?: unknown };
    const operations = normalizeOperationList(parsed.operations);
    if (operations.length === 0) {
      return { operations: input.fallbackOperations, source: "fallback", note: "OpenAI returned no operations." };
    }
    return { operations, source: "openai" };
  } catch (error) {
    return {
      operations: input.fallbackOperations,
      source: "fallback",
      note: `OpenAI error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
