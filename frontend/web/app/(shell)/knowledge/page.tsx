"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTableShell } from "@/components/ui/data-table-shell";

// ── Types ────────────────────────────────────────────────────────────

type KnowledgeDoc = {
  id: string;
  make: string;
  model: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  title: string;
  docType: string;
  originalFileName: string;
  fileSize: number;
  pageCount: number;
  extractedText: string;
  extractionStatus: string;
  aiExtractionStatus: string;
  noteCount: number;
  contentHash: string;
  orgId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MaterialNote = {
  id: string;
  make: string;
  model: string | null;
  location: string;
  operation: string;
  materialType: string;
  productPartNo: string | null;
  specification: string;
  qty: number | null;
  unit: string | null;
  sourcePageNo: number | null;
  sourceExcerpt: string;
  reviewStatus: string;
  docId: string;
  createdAt: string;
};

type CoverageCell = {
  location: string;
  operation: string;
  noteCount: number;
  confirmedCount: number;
  materialTypes: string[];
};

type DocStats = {
  totalDocs: number;
  byMake: Array<{ make: string; count: number }>;
  byType: Array<{ docType: string; count: number }>;
  totalNotes: number;
  confirmedNotes: number;
};

type DuplicateInfo = {
  matchType: "exact_hash" | "similar_title";
  existingDoc: { id: string; title: string; make: string; createdAt: string };
  message: string;
};

const DOC_TYPE_OPTIONS = [
  { value: "repair_manual", label: "Repair Manual" },
  { value: "usage_guide", label: "Usage Guide" },
  { value: "approved_list", label: "Approved Materials List" },
  { value: "other", label: "Other" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  repair_manual: "Repair Manual",
  usage_guide: "Usage Guide",
  approved_list: "Approved List",
  other: "Other",
};

const MATERIAL_TYPE_LABELS: Record<string, string> = {
  structural_adhesive: "Structural Adhesive",
  cavity_wax: "Cavity Wax",
  seam_sealer: "Seam Sealer",
  weld_thru_primer: "Weld-Thru Primer",
  undercoating: "Undercoating",
  nvh_dampening: "NVH Dampening",
  repair_material: "Repair Material",
  foam: "Foam",
  primer: "Primer",
  other: "Other",
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function yearRangeLabel(from: number | null, to: number | null): string {
  if (!from && !to) return "All Years";
  if (from && to && from === to) return String(from);
  if (from && to) return `${from}–${to}`;
  if (from) return `${from}+`;
  return `≤${to}`;
}

function docTypeBadge(docType: string) {
  const colors: Record<string, string> = {
    repair_manual: "border-blue-200 bg-blue-50 text-blue-700",
    usage_guide: "border-emerald-200 bg-emerald-50 text-emerald-700",
    approved_list: "border-violet-200 bg-violet-50 text-violet-700",
    other: "border-slate-200 bg-slate-50 text-slate-600",
  };
  const cls = colors[docType] || colors.other;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {DOC_TYPE_LABELS[docType] || docType}
    </span>
  );
}

function extractionBadge(status: string) {
  if (status === "extracted") return <span className="text-xs text-emerald-600">✓ Text</span>;
  if (status === "failed") return <span className="text-xs text-red-500">✗ Failed</span>;
  return <span className="text-xs text-amber-500">⏳</span>;
}

function aiBadge(status: string) {
  if (status === "completed") return <span className="text-xs text-emerald-600">✓ AI Done</span>;
  if (status === "pending") return <span className="text-xs text-blue-500">⏳ Running</span>;
  if (status === "failed") return <span className="text-xs text-red-500">✗ Failed</span>;
  return <span className="text-xs text-slate-400">—</span>;
}

function reviewBadge(status: string) {
  if (status === "confirmed") {
    return <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Confirmed</span>;
  }
  if (status === "rejected") {
    return <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">Rejected</span>;
  }
  return <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600">Pending</span>;
}

function materialTypeBadge(type: string) {
  const colors: Record<string, string> = {
    structural_adhesive: "bg-blue-100 text-blue-700",
    cavity_wax: "bg-amber-100 text-amber-700",
    seam_sealer: "bg-purple-100 text-purple-700",
    weld_thru_primer: "bg-orange-100 text-orange-700",
    undercoating: "bg-slate-100 text-slate-700",
    nvh_dampening: "bg-teal-100 text-teal-700",
    repair_material: "bg-cyan-100 text-cyan-700",
    foam: "bg-pink-100 text-pink-700",
    primer: "bg-lime-100 text-lime-700",
  };
  const cls = colors[type] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
      {MATERIAL_TYPE_LABELS[type] || type}
    </span>
  );
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ────────────────────────────────────────────────────────

export default function KnowledgePage() {
  // Data
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<DocStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [makeFilter, setMakeFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [query, setQuery] = useState("");

  // Upload state
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadMake, setUploadMake] = useState("");
  const [uploadModel, setUploadModel] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDocType, setUploadDocType] = useState("repair_manual");
  const [uploadYearFrom, setUploadYearFrom] = useState("");
  const [uploadYearTo, setUploadYearTo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Duplicate resolution
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);

  // Delete & AI extraction
  const [deletingId, setDeletingId] = useState("");
  const [extractingId, setExtractingId] = useState("");
  const [extractResult, setExtractResult] = useState<{ docId: string; notesExtracted: number; summary: string } | null>(null);

  // Detail view — notes review & coverage
  const [detailDocId, setDetailDocId] = useState<string | null>(null);
  const [detailNotes, setDetailNotes] = useState<MaterialNote[]>([]);
  const [detailCoverage, setDetailCoverage] = useState<{ cells: CoverageCell[]; locations: string[]; operations: string[] } | null>(null);
  const [detailTab, setDetailTab] = useState<"notes" | "coverage" | "text">("notes");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [updatingNoteId, setUpdatingNoteId] = useState("");

  // ── Data fetching ──────────────────────────────────────────────────

  const fetchDocs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (makeFilter) params.set("make", makeFilter);
      if (typeFilter) params.set("docType", typeFilter);
      const res = await fetch(`/v1/knowledge-docs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDocs(data.docs || []);
      }
    } catch { /* silent */ }
  }, [makeFilter, typeFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/v1/knowledge-docs?stats=1");
      if (res.ok) setStats(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchDocs(), fetchStats()]).finally(() => setLoading(false));
  }, [fetchDocs, fetchStats]);

  // ── Detail fetching ────────────────────────────────────────────────

  const fetchDetail = useCallback(async (docId: string) => {
    setLoadingDetail(true);
    try {
      const [notesRes, coverageRes] = await Promise.all([
        fetch(`/v1/knowledge-docs?notes=${docId}`),
        fetch(`/v1/knowledge-docs?coverage=${docId}`),
      ]);
      if (notesRes.ok) {
        const data = await notesRes.json();
        setDetailNotes(data.notes || []);
      }
      if (coverageRes.ok) {
        setDetailCoverage(await coverageRes.json());
      }
    } catch { /* silent */ }
    setLoadingDetail(false);
  }, []);

  function openDetail(docId: string) {
    setDetailDocId(docId);
    setDetailTab("notes");
    void fetchDetail(docId);
  }

  function closeDetail() {
    setDetailDocId(null);
    setDetailNotes([]);
    setDetailCoverage(null);
  }

  // ── Filtered list ──────────────────────────────────────────────────

  const filteredDocs = useMemo(() => {
    if (!query.trim()) return docs;
    const q = query.toLowerCase();
    return docs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(q) ||
        doc.make.toLowerCase().includes(q) ||
        (doc.model || "").toLowerCase().includes(q) ||
        doc.originalFileName.toLowerCase().includes(q)
    );
  }, [docs, query]);

  const allMakes = useMemo(() => {
    const makes = new Set(docs.map((d) => d.make));
    return Array.from(makes).sort();
  }, [docs]);

  const detailDoc = useMemo(() => docs.find((d) => d.id === detailDocId) || null, [docs, detailDocId]);

  // ── Upload ─────────────────────────────────────────────────────────

  function onFileSelect(file: File | null) {
    setUploadFile(file);
    setUploadError("");
    setUploadSuccess("");
    setDuplicateInfo(null);
    if (file && !uploadTitle) {
      setUploadTitle(file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim());
    }
  }

  async function handleUpload(replaceId?: string) {
    if (!uploadFile || !uploadMake.trim() || !uploadTitle.trim()) {
      setUploadError("File, make, and title are required.");
      return;
    }
    setUploading(true);
    setUploadError("");
    setUploadSuccess("");
    setDuplicateInfo(null);

    try {
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("make", uploadMake.trim());
      form.append("title", uploadTitle.trim());
      form.append("docType", uploadDocType);
      if (uploadModel.trim()) form.append("model", uploadModel.trim());
      if (uploadYearFrom.trim()) form.append("yearFrom", uploadYearFrom.trim());
      if (uploadYearTo.trim()) form.append("yearTo", uploadYearTo.trim());
      if (replaceId) form.append("replaceId", replaceId);

      const res = await fetch("/v1/knowledge-docs", { method: "POST", body: form });
      const data = await res.json();

      if (res.status === 409 && data.code === "DUPLICATE_DETECTED") {
        setDuplicateInfo({ matchType: data.matchType, existingDoc: data.existingDoc, message: data.message });
        return;
      }
      if (!res.ok) { setUploadError(data.message || "Upload failed."); return; }

      setUploadSuccess(`Uploaded "${data.doc.title}" — ${data.pageCount} pages, ${data.extractedTextLength.toLocaleString()} chars extracted.`);
      setUploadFile(null);
      setUploadMake("");
      setUploadModel("");
      setUploadTitle("");
      setUploadDocType("repair_manual");
      setUploadYearFrom("");
      setUploadYearTo("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await Promise.all([fetchDocs(), fetchStats()]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // ── AI Extraction ──────────────────────────────────────────────────

  async function handleAiExtract(docId: string) {
    setExtractingId(docId);
    setExtractResult(null);
    try {
      const res = await fetch("/v1/knowledge-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai_extract", docId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`AI extraction failed: ${data.message || "Unknown error"}`);
        return;
      }
      setExtractResult({ docId, notesExtracted: data.notesExtracted, summary: data.summary });
      await Promise.all([fetchDocs(), fetchStats()]);
      // Auto-open detail view
      openDetail(docId);
    } catch (err) {
      alert(`AI extraction error: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setExtractingId("");
    }
  }

  // ── Note review actions ────────────────────────────────────────────

  async function updateNoteStatus(noteId: string, status: "confirmed" | "rejected") {
    setUpdatingNoteId(noteId);
    try {
      await fetch("/v1/knowledge-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_note_status", noteId, status }),
      });
      if (detailDocId) await fetchDetail(detailDocId);
      await fetchStats();
    } catch { /* silent */ }
    setUpdatingNoteId("");
  }

  async function confirmAllPending() {
    const pending = detailNotes.filter((n) => n.reviewStatus === "pending_review");
    for (const note of pending) {
      await fetch("/v1/knowledge-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_note_status", noteId: note.id, status: "confirmed" }),
      });
    }
    if (detailDocId) await fetchDetail(detailDocId);
    await fetchStats();
  }

  // ── Delete ─────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch("/v1/knowledge-docs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (detailDocId === id) closeDetail();
      await Promise.all([fetchDocs(), fetchStats()]);
    } catch { /* silent */ }
    setDeletingId("");
  }

  // ── Note stats for detail ──────────────────────────────────────────

  const noteStats = useMemo(() => {
    const total = detailNotes.length;
    const confirmed = detailNotes.filter((n) => n.reviewStatus === "confirmed").length;
    const rejected = detailNotes.filter((n) => n.reviewStatus === "rejected").length;
    const pending = total - confirmed - rejected;
    return { total, confirmed, rejected, pending };
  }, [detailNotes]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-apptext">Brand Knowledge Base</h1>
        <p className="mt-1 text-sm text-appmuted">
          Upload repair manuals and usage guides. AI extracts structured material knowledge to improve invoice accuracy.
        </p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-appline bg-white p-4 shadow-soft">
            <div className="text-2xl font-bold text-apptext">{stats.totalDocs}</div>
            <div className="text-xs text-appmuted">Documents</div>
          </div>
          <div className="rounded-xl border border-appline bg-white p-4 shadow-soft">
            <div className="text-2xl font-bold text-apptext">{stats.byMake.length}</div>
            <div className="text-xs text-appmuted">Brands Covered</div>
          </div>
          <div className="rounded-xl border border-appline bg-white p-4 shadow-soft">
            <div className="text-2xl font-bold text-apptext">{stats.totalNotes}</div>
            <div className="text-xs text-appmuted">Extracted Notes</div>
          </div>
          <div className="rounded-xl border border-appline bg-white p-4 shadow-soft">
            <div className="text-2xl font-bold text-emerald-600">{stats.confirmedNotes}</div>
            <div className="text-xs text-appmuted">Confirmed Notes</div>
          </div>
        </div>
      )}

      {/* Upload section */}
      <div className="rounded-xl border border-appline bg-white p-4 shadow-soft">
        <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowUploadForm((p) => !p)}>
          <span className="text-sm font-semibold text-apptext">{showUploadForm ? "▾" : "▸"} Upload New Document</span>
          <span className="text-xs text-appmuted">PDF files only</span>
        </button>
        {showUploadForm && (
          <div className="mt-4 space-y-3">
            <div
              className="cursor-pointer rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50 p-6 text-center transition hover:border-blue-400 hover:bg-blue-50"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFileSelect(f); }}
            >
              {uploadFile ? (
                <div><p className="font-medium text-blue-700">{uploadFile.name}</p><p className="mt-1 text-xs text-blue-500">{formatFileSize(uploadFile.size)}</p></div>
              ) : (
                <div><p className="font-medium text-blue-600">Drag PDF here or click to choose</p><p className="mt-1 text-xs text-blue-400">Supported: .pdf</p></div>
              )}
            </div>
            <input ref={fileInputRef} hidden type="file" accept=".pdf,application/pdf" onChange={(e) => onFileSelect(e.target.files?.[0] || null)} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-appmuted">Make *</label>
                <input type="text" className="w-full rounded-lg border border-appline px-3 py-2 text-sm" value={uploadMake} onChange={(e) => setUploadMake(e.target.value)} placeholder="e.g. RAM, Ford, Tesla" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-appmuted">Model</label>
                <input type="text" className="w-full rounded-lg border border-appline px-3 py-2 text-sm" value={uploadModel} onChange={(e) => setUploadModel(e.target.value)} placeholder="e.g. 1500 (optional)" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-appmuted">Document Type</label>
                <select className="w-full rounded-lg border border-appline px-3 py-2 text-sm" value={uploadDocType} onChange={(e) => setUploadDocType(e.target.value)}>
                  {DOC_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-appmuted">Title *</label>
                <input type="text" className="w-full rounded-lg border border-appline px-3 py-2 text-sm" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="e.g. RAM Approved Consumables" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-appmuted">Year From</label>
                  <input type="number" className="w-full rounded-lg border border-appline px-3 py-2 text-sm" value={uploadYearFrom} onChange={(e) => setUploadYearFrom(e.target.value)} placeholder="2019" />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-appmuted">Year To</label>
                  <input type="number" className="w-full rounded-lg border border-appline px-3 py-2 text-sm" value={uploadYearTo} onChange={(e) => setUploadYearTo(e.target.value)} placeholder="2025" />
                </div>
              </div>
            </div>
            {duplicateInfo && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-medium text-amber-800">Duplicate Detected</p>
                <p className="mt-1 text-xs text-amber-700">{duplicateInfo.message}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700" onClick={() => void handleUpload(duplicateInfo.existingDoc.id)} disabled={uploading}>Replace Existing</button>
                  <button type="button" className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100" onClick={() => setDuplicateInfo(null)}>Cancel</button>
                </div>
              </div>
            )}
            {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
            {uploadSuccess && <p className="text-sm text-emerald-600">{uploadSuccess}</p>}
            <div className="flex gap-2">
              <button type="button" className="rounded-lg bg-apptext px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" onClick={() => void handleUpload()} disabled={uploading || !uploadFile || !uploadMake.trim() || !uploadTitle.trim()}>
                {uploading ? "Uploading..." : "Upload Document"}
              </button>
              <button type="button" className="rounded-lg border border-appline px-4 py-2 text-sm font-semibold text-appmuted hover:bg-gray-50" onClick={() => { setShowUploadForm(false); setUploadError(""); setUploadSuccess(""); setDuplicateInfo(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* AI Extraction success banner */}
      {extractResult && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">AI Extraction Complete</p>
          <p className="mt-1 text-xs text-emerald-700">{extractResult.notesExtracted} material notes extracted. {extractResult.summary}</p>
          <button type="button" className="mt-2 text-xs font-semibold text-emerald-600 hover:underline" onClick={() => setExtractResult(null)}>Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <input type="text" className="w-60 rounded-lg border border-appline px-3 py-2 text-sm" placeholder="Search documents..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="rounded-lg border border-appline px-3 py-2 text-sm" value={makeFilter} onChange={(e) => setMakeFilter(e.target.value)}>
          <option value="">All Brands</option>
          {allMakes.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
        <select className="rounded-lg border border-appline px-3 py-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {DOC_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <span className="text-xs text-appmuted">{filteredDocs.length} document{filteredDocs.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Documents table */}
      <DataTableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-appline bg-gray-50/60 text-left text-xs font-semibold uppercase tracking-wider text-appmuted">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Years</th>
                <th className="px-4 py-3">Pages</th>
                <th className="px-4 py-3">Extract</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-appline">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-appmuted">Loading...</td></tr>
              ) : filteredDocs.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-appmuted">No documents yet. Upload a repair manual or usage guide to get started.</td></tr>
              ) : filteredDocs.map((doc) => (
                <tr key={doc.id} className={`hover:bg-gray-50/50 ${detailDocId === doc.id ? "bg-blue-50/40" : ""}`}>
                  <td className="px-4 py-3">
                    <button type="button" className="text-left font-medium text-apptext hover:text-blue-600" onClick={() => openDetail(doc.id)}>
                      {doc.title}
                    </button>
                    <div className="mt-0.5 text-xs text-appmuted">{doc.originalFileName}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold uppercase">{doc.make}</span>
                    {doc.model && <span className="ml-1 text-appmuted">{doc.model}</span>}
                  </td>
                  <td className="px-4 py-3">{docTypeBadge(doc.docType)}</td>
                  <td className="px-4 py-3 text-xs">{yearRangeLabel(doc.yearFrom, doc.yearTo)}</td>
                  <td className="px-4 py-3 text-xs">{doc.pageCount || "—"}</td>
                  <td className="px-4 py-3">{extractionBadge(doc.extractionStatus)}</td>
                  <td className="px-4 py-3">{aiBadge(doc.aiExtractionStatus)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold ${doc.noteCount > 0 ? "text-emerald-600" : "text-appmuted"}`}>
                      {doc.noteCount > 0 ? doc.noteCount : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        onClick={() => void handleAiExtract(doc.id)}
                        disabled={extractingId === doc.id || doc.extractionStatus !== "extracted"}
                        title={doc.extractionStatus !== "extracted" ? "Text extraction must succeed first" : "Run AI to extract material notes"}
                      >
                        {extractingId === doc.id ? "Extracting..." : doc.aiExtractionStatus === "completed" ? "Re-extract" : "AI Extract"}
                      </button>
                      <button type="button" className="rounded-lg border border-appline px-2.5 py-1 text-xs font-semibold text-appmuted hover:bg-gray-50" onClick={() => openDetail(doc.id)}>
                        Review
                      </button>
                      <button type="button" className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50" onClick={() => void handleDelete(doc.id)} disabled={deletingId === doc.id}>
                        {deletingId === doc.id ? "..." : "Del"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataTableShell>

      {/* ── Detail / Review panel ──────────────────────────────────── */}
      {detailDoc && (
        <div className="rounded-xl border border-appline bg-white shadow-soft">
          {/* Detail header */}
          <div className="flex items-center justify-between border-b border-appline px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-apptext">{detailDoc.title}</h2>
              <p className="mt-0.5 text-xs text-appmuted">{detailDoc.make.toUpperCase()}{detailDoc.model ? ` ${detailDoc.model}` : ""} · {DOC_TYPE_LABELS[detailDoc.docType] || detailDoc.docType}</p>
            </div>
            <button type="button" className="text-sm text-appmuted hover:text-apptext" onClick={closeDetail}>Close ✕</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-appline px-4">
            {(["notes", "coverage", "text"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`px-3 py-2 text-xs font-semibold transition ${detailTab === tab ? "border-b-2 border-blue-500 text-blue-700" : "text-appmuted hover:text-apptext"}`}
                onClick={() => setDetailTab(tab)}
              >
                {tab === "notes" && `Notes (${noteStats.total})`}
                {tab === "coverage" && "Coverage"}
                {tab === "text" && "Raw Text"}
              </button>
            ))}
          </div>

          {loadingDetail ? (
            <div className="p-8 text-center text-appmuted">Loading...</div>
          ) : (
            <div className="p-4">
              {/* ── Notes tab ──────────────────────────────────────── */}
              {detailTab === "notes" && (
                <div className="space-y-3">
                  {/* Note stats bar */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-appmuted">
                      {noteStats.pending > 0 && <span className="mr-2 font-semibold text-amber-600">{noteStats.pending} pending</span>}
                      {noteStats.confirmed > 0 && <span className="mr-2 font-semibold text-emerald-600">{noteStats.confirmed} confirmed</span>}
                      {noteStats.rejected > 0 && <span className="font-semibold text-red-500">{noteStats.rejected} rejected</span>}
                    </span>
                    {noteStats.pending > 0 && (
                      <button
                        type="button"
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        onClick={() => void confirmAllPending()}
                      >
                        Confirm All ({noteStats.pending})
                      </button>
                    )}
                  </div>

                  {detailNotes.length === 0 ? (
                    <p className="py-6 text-center text-sm text-appmuted">No notes extracted yet. Click &quot;AI Extract&quot; to analyze this document.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-appline text-left text-[10px] font-semibold uppercase tracking-wider text-appmuted">
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Location</th>
                            <th className="px-3 py-2">Operation</th>
                            <th className="px-3 py-2">Material Type</th>
                            <th className="px-3 py-2">Part #</th>
                            <th className="px-3 py-2">Qty</th>
                            <th className="px-3 py-2">Specification</th>
                            <th className="px-3 py-2">Page</th>
                            <th className="px-3 py-2 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-appline/50">
                          {detailNotes.map((note) => (
                            <tr key={note.id} className={`${note.reviewStatus === "rejected" ? "opacity-40" : ""} hover:bg-gray-50/50`}>
                              <td className="px-3 py-2">{reviewBadge(note.reviewStatus)}</td>
                              <td className="px-3 py-2 font-medium">{titleCase(note.location)}</td>
                              <td className="px-3 py-2">{titleCase(note.operation)}</td>
                              <td className="px-3 py-2">{materialTypeBadge(note.materialType)}</td>
                              <td className="px-3 py-2 font-mono text-[11px]">{note.productPartNo || "—"}</td>
                              <td className="px-3 py-2">
                                {note.qty != null ? (
                                  <span>{note.qty} {note.unit || ""}</span>
                                ) : "—"}
                              </td>
                              <td className="max-w-[200px] truncate px-3 py-2" title={note.specification}>{note.specification || "—"}</td>
                              <td className="px-3 py-2 text-appmuted">{note.sourcePageNo || "—"}</td>
                              <td className="px-3 py-2 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {note.reviewStatus !== "confirmed" && (
                                    <button
                                      type="button"
                                      className="rounded border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                                      onClick={() => void updateNoteStatus(note.id, "confirmed")}
                                      disabled={updatingNoteId === note.id}
                                    >
                                      ✓
                                    </button>
                                  )}
                                  {note.reviewStatus !== "rejected" && (
                                    <button
                                      type="button"
                                      className="rounded border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                                      onClick={() => void updateNoteStatus(note.id, "rejected")}
                                      disabled={updatingNoteId === note.id}
                                    >
                                      ✗
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── Coverage tab ───────────────────────────────────── */}
              {detailTab === "coverage" && (
                <div>
                  {!detailCoverage || detailCoverage.cells.length === 0 ? (
                    <p className="py-6 text-center text-sm text-appmuted">No coverage data. Extract notes first.</p>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs text-appmuted">
                        Coverage matrix: {detailCoverage.locations.length} locations × {detailCoverage.operations.length} operations = {detailCoverage.cells.length} knowledge cells
                      </p>
                      <div className="overflow-x-auto">
                        <table className="text-xs">
                          <thead>
                            <tr className="border-b border-appline">
                              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-appmuted">Location</th>
                              {detailCoverage.operations.map((op) => (
                                <th key={op} className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-appmuted">{titleCase(op)}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-appline/50">
                            {detailCoverage.locations.map((loc) => (
                              <tr key={loc}>
                                <td className="whitespace-nowrap px-3 py-2 font-medium">{titleCase(loc)}</td>
                                {detailCoverage.operations.map((op) => {
                                  const cell = detailCoverage.cells.find((c) => c.location === loc && c.operation === op);
                                  if (!cell) {
                                    return <td key={op} className="px-3 py-2 text-center text-appmuted">—</td>;
                                  }
                                  const allConfirmed = cell.confirmedCount === cell.noteCount;
                                  const bgColor = allConfirmed ? "bg-emerald-100" : cell.confirmedCount > 0 ? "bg-amber-50" : "bg-blue-50";
                                  return (
                                    <td key={op} className={`px-3 py-2 text-center ${bgColor} rounded`}>
                                      <div className="text-xs font-semibold">{cell.noteCount}</div>
                                      <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                                        {cell.materialTypes.map((mt) => (
                                          <span key={mt} className="inline-block rounded bg-white/60 px-1 py-0 text-[9px] text-slate-600">
                                            {(MATERIAL_TYPE_LABELS[mt] || mt).slice(0, 8)}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] text-appmuted">
                        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-emerald-100" />All confirmed</span>
                        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-amber-50" />Partially confirmed</span>
                        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded bg-blue-50" />Pending review</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Raw text tab ───────────────────────────────────── */}
              {detailTab === "text" && (
                <div>
                  <div className="mb-2 text-xs text-appmuted">
                    Extracted text ({detailDoc.extractedText.length.toLocaleString()} chars, {detailDoc.pageCount} pages)
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-appline bg-gray-50 p-3 text-xs leading-relaxed text-apptext">
                    {detailDoc.extractedText ? detailDoc.extractedText.slice(0, 8000) : "(No text extracted)"}
                    {detailDoc.extractedText.length > 8000 && "\n\n... [truncated]"}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Brand coverage summary */}
      {stats && stats.byMake.length > 0 && (
        <div className="rounded-xl border border-appline bg-white p-4 shadow-soft">
          <h3 className="mb-3 text-sm font-semibold text-apptext">Documents by Brand</h3>
          <div className="flex flex-wrap gap-2">
            {stats.byMake.map((item) => (
              <button
                key={item.make}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  makeFilter === item.make ? "border-blue-400 bg-blue-50 text-blue-700" : "border-appline text-appmuted hover:border-blue-300 hover:text-blue-600"
                }`}
                onClick={() => setMakeFilter(makeFilter === item.make ? "" : item.make)}
              >
                {item.make.toUpperCase()} ({item.count})
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
