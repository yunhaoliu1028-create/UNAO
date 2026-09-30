import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/server/db";
import type { BrandMaterialNote } from "@/generated/prisma/client";

// ── Types ────────────────────────────────────────────────────────────

export type ExtractedNote = {
  location: string;
  operation: string;
  materialType: string;
  productPartNo: string | null;
  specification: string;
  qty: number | null;
  unit: string | null;
  sourcePageNo: number | null;
  sourceExcerpt: string;
};

export type ExtractionResult = {
  notes: ExtractedNote[];
  summary: string;
  tokenUsage: { input: number; output: number };
};

// ── Claude client ────────────────────────────────────────────────────

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set. Please add it to .env.local");
  }
  return new Anthropic({ apiKey });
}

// ── Extraction prompt ────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a collision repair materials expert. Your job is to extract structured material knowledge from repair manuals, usage guides, and approved materials lists.

You will receive the extracted text from a PDF document related to automotive collision repair consumable materials. Extract every piece of actionable material knowledge you can find.

For each material recommendation found, extract:
- location: the vehicle body part (e.g., "hood", "quarter panel", "door shell", "body side aperture", "rocker panel", "roof", "trunk", "fender", "A pillar", "B pillar", "C pillar")
- operation: the repair operation (e.g., "replace", "repair", "section", "blend")
- materialType: one of these categories:
  - "structural_adhesive" (panel bonding adhesive, impact resistant adhesive)
  - "cavity_wax" (cavity wax plus, corrosion inhibiting materials)
  - "seam_sealer" (urethane seam sealer, self-leveling seam sealer)
  - "weld_thru_primer" (weld-thru coating, zinc-rich primer)
  - "undercoating" (rubberized undercoating, rocker panel coating)
  - "nvh_dampening" (NVH dampening material, sound deadener)
  - "repair_material" (EZ Sand, body filler, repair compound)
  - "foam" (flexible foam, structural foam)
  - "primer" (epoxy primer, anti-corrosion primer)
  - "other"
- productPartNo: specific 3M or other product part number if mentioned (e.g., "3M 7333", "3M 8852", "3M 5917"). null if only the material type is mentioned.
- specification: the specific usage instruction or quantity guidance (e.g., "10-13mm bead", "1/2 can", "apply to all bare metal surfaces", "use one third of a can per pillar")
- qty: numeric quantity if extractable (e.g., 0.5 for "half a can", 0.33 for "one third of a can", 1.0 for "one can"). null if not a clear quantity.
- unit: unit of measure if qty is provided (e.g., "can", "cartridge", "sachet"). null if qty is null.
- sourcePageNo: the page number where this information was found (from "--- Page N ---" markers). null if unclear.
- sourceExcerpt: a brief relevant quote from the document (max 120 chars) showing the original text.

Important guidelines:
- Extract ALL material mentions, even partial ones.
- If a document shows a usage diagram (like cavity wax usage per body area), extract each area as a separate note.
- If quantities are described in fractions ("one third", "half", "one eighth"), convert to decimal.
- For repair manuals that describe procedures step-by-step, extract the material-relevant steps.
- If the document is an approved materials list, extract each approved product with its intended use.
- Be thorough — missing a material recommendation is worse than including a borderline one.

Respond with valid JSON only. No markdown, no explanation outside the JSON.`;

function buildUserPrompt(input: {
  make: string;
  model: string | null;
  title: string;
  docType: string;
  extractedText: string;
}): string {
  return `Document: "${input.title}"
Vehicle: ${input.make.toUpperCase()}${input.model ? ` ${input.model}` : ""}
Document type: ${input.docType}

Extracted text from PDF:
---
${input.extractedText.slice(0, 80000)}
---

Extract all material knowledge from this document. Return JSON in this exact format:
{
  "notes": [
    {
      "location": "string",
      "operation": "string",
      "materialType": "string",
      "productPartNo": "string or null",
      "specification": "string",
      "qty": "number or null",
      "unit": "string or null",
      "sourcePageNo": "number or null",
      "sourceExcerpt": "string (max 120 chars)"
    }
  ],
  "summary": "A 1-2 sentence summary of what this document covers regarding consumable materials."
}`;
}

// ── Extraction function ──────────────────────────────────────────────

export async function extractKnowledgeFromDoc(docId: string): Promise<ExtractionResult> {
  // Load document
  const doc = await prisma.brandKnowledgeDoc.findUnique({ where: { id: docId } });
  if (!doc) {
    throw new Error(`Document not found: ${docId}`);
  }
  if (!doc.extractedText) {
    throw new Error("Document has no extracted text. PDF text extraction may have failed.");
  }

  // Mark as pending
  await prisma.brandKnowledgeDoc.update({
    where: { id: docId },
    data: { aiExtractionStatus: "pending" },
  });

  try {
    const client = getClient();

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserPrompt({
            make: doc.make,
            model: doc.model,
            title: doc.title,
            docType: doc.docType,
            extractedText: doc.extractedText,
          }),
        },
      ],
    });

    // Parse response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude.");
    }

    // Clean up JSON (remove markdown fences if present)
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonText) as { notes: ExtractedNote[]; summary: string };
    const notes = Array.isArray(parsed.notes) ? parsed.notes : [];
    const summary = String(parsed.summary || "");

    // Delete existing notes for this doc (re-extraction)
    await prisma.brandMaterialNote.deleteMany({ where: { docId } });

    // Save extracted notes
    for (const note of notes) {
      await prisma.brandMaterialNote.create({
        data: {
          make: doc.make,
          model: doc.model,
          yearFrom: doc.yearFrom,
          yearTo: doc.yearTo,
          location: String(note.location || "").trim().toLowerCase(),
          operation: String(note.operation || "").trim().toLowerCase(),
          materialType: String(note.materialType || "other").trim().toLowerCase(),
          productPartNo: note.productPartNo ? String(note.productPartNo).trim() : null,
          specification: String(note.specification || "").trim(),
          qty: typeof note.qty === "number" && Number.isFinite(note.qty) ? note.qty : null,
          unit: note.unit ? String(note.unit).trim() : null,
          sourcePageNo: typeof note.sourcePageNo === "number" ? note.sourcePageNo : null,
          sourceExcerpt: String(note.sourceExcerpt || "").trim().slice(0, 200),
          reviewStatus: "pending_review",
          docId,
          orgId: doc.orgId,
        },
      });
    }

    // Update doc status
    await prisma.brandKnowledgeDoc.update({
      where: { id: docId },
      data: {
        aiExtractionStatus: "completed",
        noteCount: notes.length,
      },
    });

    const tokenUsage = {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
    };

    return { notes, summary, tokenUsage };
  } catch (error) {
    // Mark as failed
    await prisma.brandKnowledgeDoc.update({
      where: { id: docId },
      data: { aiExtractionStatus: "failed" },
    });
    throw error;
  }
}

// ── Coverage analysis ────────────────────────────────────────────────

export type CoverageCell = {
  location: string;
  operation: string;
  noteCount: number;
  confirmedCount: number;
  materialTypes: string[];
};

export async function getDocCoverage(docId: string): Promise<{
  cells: CoverageCell[];
  locations: string[];
  operations: string[];
}> {
  const notes = await prisma.brandMaterialNote.findMany({
    where: { docId },
    select: { location: true, operation: true, materialType: true, reviewStatus: true },
  });

  const cellMap = new Map<string, { noteCount: number; confirmedCount: number; materialTypes: Set<string> }>();
  const locationSet = new Set<string>();
  const operationSet = new Set<string>();

  for (const note of notes) {
    const key = `${note.location}||${note.operation}`;
    locationSet.add(note.location);
    operationSet.add(note.operation);

    const existing = cellMap.get(key);
    if (existing) {
      existing.noteCount++;
      if (note.reviewStatus === "confirmed") existing.confirmedCount++;
      existing.materialTypes.add(note.materialType);
    } else {
      cellMap.set(key, {
        noteCount: 1,
        confirmedCount: note.reviewStatus === "confirmed" ? 1 : 0,
        materialTypes: new Set([note.materialType]),
      });
    }
  }

  const cells: CoverageCell[] = [];
  for (const [key, value] of cellMap) {
    const [location, operation] = key.split("||");
    cells.push({
      location,
      operation,
      noteCount: value.noteCount,
      confirmedCount: value.confirmedCount,
      materialTypes: Array.from(value.materialTypes),
    });
  }

  return {
    cells,
    locations: Array.from(locationSet).sort(),
    operations: Array.from(operationSet).sort(),
  };
}
