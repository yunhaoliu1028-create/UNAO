import { NextResponse } from "next/server";
import {
  createDoc,
  replaceDoc,
  listDocs,
  deleteDoc,
  getDoc,
  getDocWithNotes,
  getDocStats,
  checkDuplicate,
  computeContentHash,
  updateNoteStatus,
  deleteNote,
  listNotesByDoc,
} from "@/lib/server/brand-knowledge";
import { extractKnowledgeFromDoc, getDocCoverage } from "@/lib/server/ai-extract-knowledge";

export const runtime = "nodejs";

// ── GET /v1/knowledge-docs ──────────────────────────────────────────
// Query params: ?make=ram&docType=repair_manual
// Special: ?id=xxx  → get single doc with notes
//          ?stats=1 → get aggregate stats
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);

    // Stats mode
    if (url.searchParams.get("stats") === "1") {
      const stats = await getDocStats();
      return NextResponse.json(stats);
    }

    // Coverage analysis for a specific doc
    const coverageDocId = url.searchParams.get("coverage");
    if (coverageDocId) {
      const coverage = await getDocCoverage(coverageDocId);
      return NextResponse.json(coverage);
    }

    // Notes for a specific doc
    const notesDocId = url.searchParams.get("notes");
    if (notesDocId) {
      const notes = await listNotesByDoc(notesDocId);
      return NextResponse.json({ notes });
    }

    // Single doc with notes
    const docId = url.searchParams.get("id");
    if (docId) {
      const doc = await getDocWithNotes(docId);
      if (!doc) {
        return NextResponse.json({ code: "NOT_FOUND", message: "Document not found." }, { status: 404 });
      }
      return NextResponse.json({ doc });
    }

    // List docs
    const make = url.searchParams.get("make") || undefined;
    const docType = url.searchParams.get("docType") || undefined;
    const docs = await listDocs({ make, docType });
    return NextResponse.json({ docs });
  } catch (error) {
    return NextResponse.json(
      { code: "QUERY_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ── POST /v1/knowledge-docs ─────────────────────────────────────────
// Multipart form: file (PDF), make, model, title, docType, yearFrom, yearTo
// Also handles: action=update_note_status (JSON body)
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type") || "";

    // JSON body actions (note status updates)
    if (contentType.includes("application/json")) {
      const body = await request.json();

      if (body.action === "update_note_status") {
        if (!body.noteId || !body.status) {
          return NextResponse.json({ code: "INVALID_INPUT", message: "noteId and status are required." }, { status: 400 });
        }
        const note = await updateNoteStatus(body.noteId, body.status);
        return NextResponse.json({ note });
      }

      if (body.action === "delete_note") {
        if (!body.noteId) {
          return NextResponse.json({ code: "INVALID_INPUT", message: "noteId is required." }, { status: 400 });
        }
        await deleteNote(body.noteId);
        return NextResponse.json({ action: "deleted", noteId: body.noteId });
      }

      if (body.action === "ai_extract") {
        if (!body.docId) {
          return NextResponse.json({ code: "INVALID_INPUT", message: "docId is required." }, { status: 400 });
        }
        try {
          const result = await extractKnowledgeFromDoc(body.docId);
          return NextResponse.json({
            action: "ai_extract",
            docId: body.docId,
            notesExtracted: result.notes.length,
            summary: result.summary,
            tokenUsage: result.tokenUsage,
          });
        } catch (error) {
          return NextResponse.json(
            { code: "AI_EXTRACTION_FAILED", message: error instanceof Error ? error.message : "AI extraction failed." },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({ code: "UNKNOWN_ACTION", message: `Unknown action: ${body.action}` }, { status: 400 });
    }

    // Multipart form upload
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const make = String(formData.get("make") || "").trim();
    const model = String(formData.get("model") || "").trim() || null;
    const title = String(formData.get("title") || "").trim();
    const docType = String(formData.get("docType") || "repair_manual").trim();
    const yearFromStr = String(formData.get("yearFrom") || "").trim();
    const yearToStr = String(formData.get("yearTo") || "").trim();
    const replaceId = String(formData.get("replaceId") || "").trim();

    if (!file) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "PDF file is required." }, { status: 400 });
    }
    if (!make) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "make is required." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "title is required." }, { status: 400 });
    }

    const yearFrom = yearFromStr ? Number.parseInt(yearFromStr, 10) : null;
    const yearTo = yearToStr ? Number.parseInt(yearToStr, 10) : null;

    // Read file content
    const arrayBuffer = await file.arrayBuffer();
    const contentHash = computeContentHash(arrayBuffer);

    // Extract text from PDF (basic — just store raw for now, LLM extraction in Phase 2)
    let extractedText = "";
    let pageCount = 0;
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdfDoc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      pageCount = pdfDoc.numPages;
      const textParts: string[] = [];
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .filter((item) => "str" in item)
          .map((item) => (item as { str: string }).str)
          .join(" ");
        textParts.push(`--- Page ${i} ---\n${pageText}`);
      }
      extractedText = textParts.join("\n\n");
    } catch {
      // PDF text extraction failed — store empty, mark as failed
      extractedText = "";
    }

    // Check for duplicates (only if not explicitly replacing)
    if (!replaceId) {
      const dupCheck = await checkDuplicate({ contentHash, make, title });
      if (dupCheck.isDuplicate && dupCheck.existingDoc) {
        return NextResponse.json({
          code: "DUPLICATE_DETECTED",
          matchType: dupCheck.matchType,
          existingDoc: {
            id: dupCheck.existingDoc.id,
            title: dupCheck.existingDoc.title,
            make: dupCheck.existingDoc.make,
            createdAt: dupCheck.existingDoc.createdAt,
          },
          message:
            dupCheck.matchType === "exact_hash"
              ? "This exact file has already been uploaded."
              : `A document with a similar title already exists: "${dupCheck.existingDoc.title}"`,
        }, { status: 409 });
      }
    }

    const docInput = {
      make,
      model,
      yearFrom,
      yearTo,
      title,
      docType,
      originalFileName: file.name,
      fileSize: file.size,
      pageCount,
      extractedText,
      contentHash,
    };

    // Replace existing or create new
    const doc = replaceId
      ? await replaceDoc(replaceId, docInput)
      : await createDoc(docInput);

    return NextResponse.json({
      doc,
      extractedTextLength: extractedText.length,
      pageCount,
    });
  } catch (error) {
    return NextResponse.json(
      { code: "UPLOAD_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ── DELETE /v1/knowledge-docs ───────────────────────────────────────
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const id = String(body.id || "").trim();

    if (!id) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "id is required." }, { status: 400 });
    }

    const existing = await getDoc(id);
    if (!existing) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Document not found." }, { status: 404 });
    }

    await deleteDoc(id);
    return NextResponse.json({ action: "deleted", id });
  } catch (error) {
    return NextResponse.json(
      { code: "DELETE_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
