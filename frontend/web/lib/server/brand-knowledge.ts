import { prisma } from "@/lib/server/db";
import type { BrandKnowledgeDoc, BrandMaterialNote } from "@/generated/prisma/client";
import crypto from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────

export type CreateDocInput = {
  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  title: string;
  docType?: string;
  originalFileName: string;
  fileSize: number;
  pageCount?: number;
  extractedText: string;
  contentHash: string;
  orgId?: string | null;
};

export type DocWithNoteCount = BrandKnowledgeDoc & {
  _noteCount?: number;
};

export type DuplicateCheckResult = {
  isDuplicate: boolean;
  existingDoc: BrandKnowledgeDoc | null;
  matchType: "exact_hash" | "similar_title" | null;
};

// ── Helpers ──────────────────────────────────────────────────────────

function normalizeMake(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeModel(value: string | null | undefined): string | null {
  const trimmed = String(value || "").trim().toLowerCase();
  return trimmed || null;
}

export function computeContentHash(buffer: ArrayBuffer | Buffer): string {
  const hash = crypto.createHash("sha256");
  hash.update(new Uint8Array(buffer));
  return hash.digest("hex");
}

// ── Duplicate detection ──────────────────────────────────────────────

export async function checkDuplicate(input: {
  contentHash: string;
  make: string;
  title: string;
  orgId?: string | null;
}): Promise<DuplicateCheckResult> {
  const make = normalizeMake(input.make);

  // 1. Exact content hash match
  if (input.contentHash) {
    const exactMatch = await prisma.brandKnowledgeDoc.findFirst({
      where: { contentHash: input.contentHash },
    });
    if (exactMatch) {
      return { isDuplicate: true, existingDoc: exactMatch, matchType: "exact_hash" };
    }
  }

  // 2. Similar title + same make
  const titleNormalized = String(input.title || "").trim().toLowerCase();
  if (titleNormalized && make) {
    const candidates = await prisma.brandKnowledgeDoc.findMany({
      where: { make },
      take: 50,
    });
    for (const candidate of candidates) {
      const candidateTitle = candidate.title.trim().toLowerCase();
      if (candidateTitle === titleNormalized) {
        return { isDuplicate: true, existingDoc: candidate, matchType: "similar_title" };
      }
      // Loose match: one title contains the other
      if (
        candidateTitle.includes(titleNormalized) ||
        titleNormalized.includes(candidateTitle)
      ) {
        return { isDuplicate: true, existingDoc: candidate, matchType: "similar_title" };
      }
    }
  }

  return { isDuplicate: false, existingDoc: null, matchType: null };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function createDoc(input: CreateDocInput): Promise<BrandKnowledgeDoc> {
  return prisma.brandKnowledgeDoc.create({
    data: {
      make: normalizeMake(input.make),
      model: normalizeModel(input.model),
      yearFrom: input.yearFrom ?? null,
      yearTo: input.yearTo ?? null,
      title: input.title.trim(),
      docType: input.docType || "repair_manual",
      originalFileName: input.originalFileName,
      fileSize: input.fileSize,
      pageCount: input.pageCount ?? 0,
      extractedText: input.extractedText,
      extractionStatus: input.extractedText ? "extracted" : "pending",
      contentHash: input.contentHash,
      orgId: input.orgId ?? null,
    },
  });
}

export async function replaceDoc(existingId: string, input: CreateDocInput): Promise<BrandKnowledgeDoc> {
  // Delete existing doc (cascade deletes its notes)
  await prisma.brandKnowledgeDoc.delete({ where: { id: existingId } });
  return createDoc(input);
}

export async function listDocs(filter?: {
  make?: string;
  docType?: string;
  orgId?: string;
  take?: number;
}): Promise<BrandKnowledgeDoc[]> {
  return prisma.brandKnowledgeDoc.findMany({
    where: {
      make: filter?.make ? normalizeMake(filter.make) : undefined,
      docType: filter?.docType || undefined,
      orgId: filter?.orgId || undefined,
    },
    orderBy: [{ make: "asc" }, { createdAt: "desc" }],
    take: filter?.take ?? 500,
  });
}

export async function getDoc(id: string): Promise<BrandKnowledgeDoc | null> {
  return prisma.brandKnowledgeDoc.findUnique({ where: { id } });
}

export async function getDocWithNotes(id: string): Promise<(BrandKnowledgeDoc & { notes: BrandMaterialNote[] }) | null> {
  return prisma.brandKnowledgeDoc.findUnique({
    where: { id },
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
}

export async function deleteDoc(id: string): Promise<void> {
  await prisma.brandKnowledgeDoc.delete({ where: { id } });
}

// ── Stats ────────────────────────────────────────────────────────────

export async function getDocStats(): Promise<{
  totalDocs: number;
  byMake: Array<{ make: string; count: number }>;
  byType: Array<{ docType: string; count: number }>;
  totalNotes: number;
  confirmedNotes: number;
}> {
  const [totalDocs, totalNotes, confirmedNotes] = await Promise.all([
    prisma.brandKnowledgeDoc.count(),
    prisma.brandMaterialNote.count(),
    prisma.brandMaterialNote.count({ where: { reviewStatus: "confirmed" } }),
  ]);

  // Build brand/type breakdowns from all docs (groupBy can be finicky with adapters)
  const allDocs = await prisma.brandKnowledgeDoc.findMany({
    select: { make: true, docType: true },
  });

  const makeMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  for (const doc of allDocs) {
    makeMap.set(doc.make, (makeMap.get(doc.make) || 0) + 1);
    typeMap.set(doc.docType, (typeMap.get(doc.docType) || 0) + 1);
  }

  return {
    totalDocs,
    byMake: Array.from(makeMap.entries()).map(([make, count]) => ({ make, count })).sort((a, b) => b.count - a.count),
    byType: Array.from(typeMap.entries()).map(([docType, count]) => ({ docType, count })).sort((a, b) => b.count - a.count),
    totalNotes,
    confirmedNotes,
  };
}

// ── Notes CRUD ───────────────────────────────────────────────────────

export async function updateNoteStatus(noteId: string, status: "confirmed" | "rejected"): Promise<BrandMaterialNote> {
  const note = await prisma.brandMaterialNote.update({
    where: { id: noteId },
    data: { reviewStatus: status },
  });

  // Update cached count on parent doc
  const confirmedCount = await prisma.brandMaterialNote.count({
    where: { docId: note.docId, reviewStatus: "confirmed" },
  });
  await prisma.brandKnowledgeDoc.update({
    where: { id: note.docId },
    data: { noteCount: confirmedCount },
  });

  return note;
}

export async function deleteNote(noteId: string): Promise<void> {
  const note = await prisma.brandMaterialNote.findUnique({ where: { id: noteId } });
  if (!note) return;

  await prisma.brandMaterialNote.delete({ where: { id: noteId } });

  // Update cached count
  const confirmedCount = await prisma.brandMaterialNote.count({
    where: { docId: note.docId, reviewStatus: "confirmed" },
  });
  await prisma.brandKnowledgeDoc.update({
    where: { id: note.docId },
    data: { noteCount: confirmedCount },
  });
}

export async function listNotesByDoc(docId: string): Promise<BrandMaterialNote[]> {
  return prisma.brandMaterialNote.findMany({
    where: { docId },
    orderBy: [{ location: "asc" }, { operation: "asc" }],
  });
}
