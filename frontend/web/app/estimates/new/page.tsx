"use client";

import { useMemo, useRef, useState } from "react";
import {
  calcLineAmount,
  detectOperationsDetailed,
  extractMetadata,
  generateFallbackLines,
  generateInvoiceViaApi,
  parseNumber,
  type InvoiceLine,
  type InvoiceMeta,
  type OperationDetectionCandidate
} from "@/lib/invoice";

type StatusTone = "" | "ok" | "error";

const defaultMeta: InvoiceMeta = {
  invoiceNo: "INV-DRAFT-001",
  roNo: "",
  vin: "",
  yearMakeModel: "",
  repairDate: "",
  currency: "USD",
  notes: ""
};

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function simplifyOperationDisplay(value: string): string {
  const cleaned = value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\bA\/M\b/gi, " ")
    .replace(/\b(CAPA|KEYSIQ|NSF)\b/gi, " ")
    .replace(/\blift[\s-]*gate\b/gi, "Liftgate")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function operationDedupeKey(value: string): string {
  return simplifyOperationDisplay(value)
    .toLowerCase()
    .replace(/\blift[\s-]*gate\b/g, "liftgate")
    .replace(/\b(repl|rpl|remove\/replace|remove replace)\b/g, "replace")
    .replace(/\b(r&i|r\/i|remove\/install|remove install)\b/g, "remove install")
    .replace(/\b(without|w\/o|w o|with|w\/)\b.*$/g, "")
    .replace(/\b(assy|assembly|complete|us built)\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasOperationActionToken(value: string): boolean {
  return /\b(remove\/replace|remove\/install|remove|replace|repair|blend|refinish|overlap|add|sublet)\b/i.test(value);
}

function isLikelyGroupHeading(label: string): boolean {
  const cleaned = String(label || "").trim();
  if (!cleaned || hasOperationActionToken(cleaned)) {
    return false;
  }
  if (cleaned.length < 3 || cleaned.length > 48) {
    return false;
  }
  const upper = cleaned.toUpperCase();
  const letters = cleaned.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) {
    return false;
  }
  return cleaned === upper;
}

type LineContextMeta = {
  lineNo: number;
  ver: string;
  groupLabel: string;
};

function buildLineContextMap(parseText: string): Record<number, LineContextMeta> {
  const mapping: Record<number, LineContextMeta> = {};
  const lines = String(parseText || "").split(/\r?\n/);
  let currentGroup = "";

  for (const rawLine of lines) {
    const cells = rawLine.split("|").map((cell) => cell.trim());
    const lineNoText = cells[0] || "";
    const lineNo = Number.parseInt(lineNoText, 10);
    if (!Number.isFinite(lineNo)) {
      continue;
    }
    const ver = (cells[1] || "").trim().toUpperCase();
    const operationCell = cells[2] || "";
    if (isLikelyGroupHeading(operationCell)) {
      currentGroup = operationCell;
    }
    mapping[lineNo] = { lineNo, ver, groupLabel: currentGroup };
  }

  return mapping;
}

function formatOperationWithTriggerLabel(operation: string, context: LineContextMeta | null): string {
  if (!context || !context.lineNo) {
    return operation;
  }
  const verText = context.ver ? ` ${context.ver}` : "";
  return `${operation} (Estimate line #${context.lineNo}${verText} )`;
}

function tokenizeOperationKey(value: string): string[] {
  return operationDedupeKey(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function pickBestLineNosForOperation(operation: string, operationToLineNos: Record<string, number[]>): number[] {
  const exactKey = operationDedupeKey(operation);
  if (operationToLineNos[exactKey]?.length) {
    return operationToLineNos[exactKey];
  }
  const opTokens = tokenizeOperationKey(operation);
  if (opTokens.length === 0) {
    return [];
  }
  let bestKey = "";
  let bestScore = 0;
  for (const [key, lineNos] of Object.entries(operationToLineNos)) {
    if (!lineNos.length) {
      continue;
    }
    const score = opTokens.filter((token) => key.includes(token)).length;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestScore >= 2 ? operationToLineNos[bestKey] || [] : [];
}

function toDirectionAbbreviation(value: string): string {
  return value
    .replace(/\bLeft\b/gi, "LT")
    .replace(/\bRight\b/gi, "RT")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeOperationsForUi(ops: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const op of ops) {
    const display = simplifyOperationDisplay(op);
    const key = operationDedupeKey(display);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(display);
  }
  return output;
}

function readFileAsPdf(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

type PdfTextItem = {
  text: string;
  x: number;
  y: number;
};

function normalizePdfToken(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function groupItemsByVisualLine(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => {
    const dy = Math.abs(a.y - b.y);
    if (dy > 1.8) {
      // PDF coordinate system usually has larger y near top.
      return b.y - a.y;
    }
    return a.x - b.x;
  });

  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const current = rows[rows.length - 1];
    if (!current) {
      rows.push([item]);
      continue;
    }
    const anchorY = current[0]?.y ?? item.y;
    if (Math.abs(anchorY - item.y) <= 1.8) {
      current.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows.map((row) => row.sort((a, b) => a.x - b.x));
}

function rowToColumns(row: PdfTextItem[]): string[] {
  if (row.length === 0) {
    return [];
  }
  const columns: string[] = [];
  let current = normalizePdfToken(row[0]?.text || "");
  let prevX = row[0]?.x ?? 0;

  for (let i = 1; i < row.length; i += 1) {
    const token = normalizePdfToken(row[i]?.text || "");
    if (!token) {
      continue;
    }
    const x = row[i]?.x ?? prevX;
    const gap = x - prevX;
    // A larger x-gap is treated as a new table column.
    if (gap > 18) {
      if (current) {
        columns.push(current);
      }
      current = token;
    } else {
      current = current ? `${current} ${token}` : token;
    }
    prevX = x;
  }

  if (current) {
    columns.push(current);
  }
  return columns;
}

function buildTableAwarePageText(items: PdfTextItem[]): string {
  const rows = groupItemsByVisualLine(items);
  const lines = rows
    .map((row) => rowToColumns(row))
    .filter((cells) => cells.length > 0)
    .map((cells) => cells.join(" | "));
  return lines.join("\n");
}

async function extractPdfText(file: File): Promise<{ plainText: string; tableText: string }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const buffer = await readFileAsPdf(file);
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const plainPages: string[] = [];
  const tablePages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const textItems = content.items
      .map((item) => {
        if (!("str" in item) || !Array.isArray(item.transform)) {
          return null;
        }
        const text = normalizePdfToken(String(item.str || ""));
        if (!text) {
          return null;
        }
        const x = Number(item.transform[4] || 0);
        const y = Number(item.transform[5] || 0);
        return { text, x, y } as PdfTextItem;
      })
      .filter((item): item is PdfTextItem => Boolean(item));

    plainPages.push(textItems.map((item) => item.text).join(" "));
    tablePages.push(buildTableAwarePageText(textItems));
  }

  return {
    plainText: plainPages.join("\n"),
    tableText: tablePages.join("\n\n")
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function EstimateToInvoicePage() {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("Waiting for PDF...");
  const [statusTone, setStatusTone] = useState<StatusTone>("");
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [operations, setOperations] = useState<string[]>([]);
  const [operationContextByKey, setOperationContextByKey] = useState<Record<string, LineContextMeta | null>>({});
  const [operationDebugRows, setOperationDebugRows] = useState<OperationDetectionCandidate[]>([]);
  const [showOperationDebug, setShowOperationDebug] = useState(false);
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [meta, setMeta] = useState<InvoiceMeta>(defaultMeta);
  const [tier, setTier] = useState<"T1" | "T2" | "T3">("T1");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const invoiceExportRef = useRef<HTMLDivElement>(null);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + calcLineAmount(line), 0);
    const tax = 0;
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

  const groupedLines = useMemo(() => {
    const map = new Map<string, { operation: string; lines: InvoiceLine[] }>();
    for (const line of lines) {
      const operation = simplifyOperationDisplay(line.operation || "Unknown Operation");
      const key = operation;
      const existing = map.get(key);
      if (existing) {
        existing.lines.push(line);
      } else {
        map.set(key, { operation, lines: [line] });
      }
    }
    return Array.from(map.entries());
  }, [lines]);

  function getOperationContext(operation: string): LineContextMeta | null {
    const key = operationDedupeKey(operation);
    return operationContextByKey[key] || null;
  }

  function getInvoiceOperationDisplay(operation: string): string {
    if (/\(Estimate line #\d+/i.test(operation)) {
      return operation;
    }
    return formatOperationWithTriggerLabel(toDirectionAbbreviation(operation), getOperationContext(operation));
  }

  function setStatusMessage(message: string, tone: StatusTone = ""): void {
    setStatus(message);
    setStatusTone(tone);
  }

  function onChooseFile(selected: File | null): void {
    if (!selected) {
      return;
    }
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) {
      setStatusMessage("Only PDF is supported.", "error");
      return;
    }
    setFile(selected);
    setStatusMessage(`Loaded file: ${selected.name}`);
  }

  function toggleOperation(operation: string, checked: boolean): void {
    setSelectedOps((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(operation);
      } else {
        next.delete(operation);
      }
      return next;
    });
  }

  function resetAll(): void {
    setFile(null);
    setRawText("");
    setOperations([]);
    setOperationContextByKey({});
    setOperationDebugRows([]);
    setSelectedOps(new Set());
    setLines([]);
    setMeta(defaultMeta);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setStatusMessage("Cleared.");
  }

  async function parseEstimate(): Promise<void> {
    if (!file) {
      setStatusMessage("Please select a PDF first.", "error");
      return;
    }

    try {
      setStatusMessage("Parsing PDF...");
      const extracted = await extractPdfText(file);
      // Keep both variants: plain text is useful for metadata;
      // table text preserves rows/columns for operation parsing.
      const parseText = `${extracted.tableText}\n\n${extracted.plainText}`.trim();
      const lineContextMap = buildLineContextMap(extracted.tableText);
      const localDetection = detectOperationsDetailed(parseText);
      const localOps = localDetection.operations;
      const detectedMeta = extractMetadata(extracted.plainText || parseText);
      let detectedOps = localOps;
      let parseSource = "local";
      let operationToLineNos: Record<string, number[]> = {};

      try {
        const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/v1/estimates/analyze?debug=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            estimateText: parseText,
            localOperations: localOps
          })
        });
        if (response.ok) {
          const data = (await response.json()) as {
            operations?: string[];
            source?: string;
            note?: string | null;
            parse_debug?: {
              candidates?: Array<{
                lineNo?: number | null;
                canonical?: string;
                decision?: "keep" | "review" | "drop";
              }>;
            };
          };
          if (Array.isArray(data.operations) && data.operations.length > 0) {
            detectedOps = data.operations;
          }
          const candidates = Array.isArray(data.parse_debug?.candidates) ? data.parse_debug?.candidates : [];
          const byOperation = new Map<string, Set<number>>();
          for (const candidate of candidates) {
            const decision = candidate?.decision || "drop";
            const lineNo = candidate?.lineNo;
            const canonical = String(candidate?.canonical || "").trim();
            if (decision === "drop" || !canonical || typeof lineNo !== "number" || !Number.isFinite(lineNo)) {
              continue;
            }
            const key = operationDedupeKey(canonical);
            const existing = byOperation.get(key) || new Set<number>();
            existing.add(lineNo);
            byOperation.set(key, existing);
          }
          operationToLineNos = {};
          for (const [key, lineNos] of byOperation.entries()) {
            operationToLineNos[key] = Array.from(lineNos).sort((a, b) => a - b);
          }
          parseSource = data.source || "api";
          if (data.note) {
            // Keep the warning lightweight so it doesn't block flow.
            console.warn("Analyze note:", data.note);
          }
        }
      } catch {
        parseSource = "local";
      }

      const displayOps = dedupeOperationsForUi(detectedOps);
      setRawText(parseText);
      setOperations(displayOps);
      const contextByKey: Record<string, LineContextMeta | null> = {};
      for (const operation of displayOps) {
        const key = operationDedupeKey(operation);
        const lineNos = pickBestLineNosForOperation(operation, operationToLineNos);
        const primaryLineNo = lineNos.length > 0 ? lineNos[0] : null;
        contextByKey[key] = primaryLineNo ? lineContextMap[primaryLineNo] || null : null;
      }
      setOperationContextByKey(contextByKey);
      setOperationDebugRows(localDetection.candidates);
      setSelectedOps(new Set(displayOps));
      setMeta((prev) => ({ ...prev, ...detectedMeta }));
      setStatusMessage(`Parse complete (${parseSource}). Detected ${displayOps.length} operation(s).`, "ok");
    } catch (error) {
      setStatusMessage(`PDF parse failed: ${getErrorMessage(error)}.`, "error");
    }
  }

  async function generateLines(): Promise<void> {
    const opList = Array.from(selectedOps);
    if (opList.length === 0) {
      setStatusMessage("Select at least one operation.", "error");
      return;
    }

    setStatusMessage("Generating invoice lines...");
    const apiResult = await generateInvoiceViaApi(apiBaseUrl, {
      estimateText: rawText,
      operations: opList,
      tier
    });

    const generated = (apiResult?.lines ?? generateFallbackLines(opList)).map((line) => ({
      ...line,
      id: line.id || makeId()
    }));
    setLines(generated);

    if (apiResult) {
      const unmatchedCount = apiResult.unmatched_operations?.length ?? 0;
      const warningsCount = apiResult.warnings?.length ?? 0;
      setStatusMessage(
        `Generated ${generated.length} line(s) from API. Unmatched ops: ${unmatchedCount}. Warnings: ${warningsCount}.`,
        "ok"
      );
    } else {
      setStatusMessage(`Generated ${generated.length} line(s) from local fallback rules.`, "ok");
    }
  }

  function addLine(): void {
    setLines((prev) => [
      ...prev,
      {
        id: makeId(),
        operation: "Manual",
        description: "",
        qty: 1,
        unit: "Each",
        unitPrice: 0,
        source: "manual"
      }
    ]);
  }

  function deleteSelectedLines(): void {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[data-line-select="1"]:checked');
    const ids = Array.from(checkboxes).map((cb) => cb.dataset.id).filter(Boolean) as string[];
    if (ids.length === 0) {
      setStatusMessage("Select line(s) to delete.", "error");
      return;
    }
    setLines((prev) => prev.filter((line) => !ids.includes(line.id)));
    setStatusMessage(`Deleted ${ids.length} line(s).`, "ok");
  }

  function updateLine(lineId: string, field: keyof InvoiceLine, value: string): void {
    setLines((prev) =>
      prev.map((line) => {
        if (line.id !== lineId) {
          return line;
        }
        if (field === "qty" || field === "unitPrice") {
          return { ...line, [field]: parseNumber(value, 0) };
        }
        return { ...line, [field]: value };
      })
    );
  }

  function onMetaChange(field: keyof InvoiceMeta, value: string): void {
    setMeta((prev) => ({ ...prev, [field]: value }));
  }

  function buildExportName(ext: string): string {
    const base = (meta.invoiceNo || "invoice-draft").replace(/[^\w\-]+/g, "_");
    return `${base}.${ext}`;
  }

  async function exportJpg(): Promise<void> {
    if (!invoiceExportRef.current) {
      setStatusMessage("Nothing to export yet.", "error");
      return;
    }
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(invoiceExportRef.current, {
      backgroundColor: "#ffffff",
      scale: 2
    });
    const url = canvas.toDataURL("image/jpeg", 0.95);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildExportName("jpg");
    anchor.click();
    setStatusMessage("Exported JPG successfully.", "ok");
  }

  async function exportPdf(): Promise<void> {
    if (!invoiceExportRef.current) {
      setStatusMessage("Nothing to export yet.", "error");
      return;
    }
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(invoiceExportRef.current, {
      backgroundColor: "#ffffff",
      scale: 2
    });
    const imageData = canvas.toDataURL("image/png", 1);
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
    if (!printWindow) {
      setStatusMessage("Popup blocked. Please allow popups and retry PDF export.", "error");
      return;
    }
    printWindow.document.write(
      `<!doctype html><html><head><title>${buildExportName("pdf")}</title>` +
        `<style>body{margin:0;padding:16px;background:#fff}img{max-width:100%;height:auto;display:block;margin:0 auto}</style>` +
        `</head><body><img src="${imageData}" alt="invoice"/></body></html>`
    );
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setStatusMessage("Opened print dialog. Choose 'Save as PDF' to export.", "ok");
  }

  function exportJson(): void {
    const payload = {
      ...meta,
      operations: Array.from(selectedOps),
      lines: lines.map((line) => ({
        ...line,
        amount: Number(calcLineAmount(line).toFixed(2))
      })),
      totals: {
        subtotal: Number(totals.subtotal.toFixed(2)),
        tax: Number(totals.tax.toFixed(2)),
        total: Number(totals.total.toFixed(2))
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${meta.invoiceNo || "invoice-draft"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatusMessage("Exported JSON successfully.", "ok");
  }

  return (
    <main className="page">
      <div className="header">
        <h1>Estimate -&gt; Consumable Invoice</h1>
        <p>Upload/drag PDF estimate, parse operations, generate invoice lines, then edit in browser.</p>
      </div>

      <div className="grid">
        <section className="card">
          <h2>1) Estimate Intake</h2>
          <div
            className={`drop-zone${dragging ? " dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              onChooseFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <p>
              <strong>Drag PDF here</strong> or click to choose
            </p>
            <p style={{ marginTop: 6, color: "#4b5563" }}>Supported: .pdf</p>
          </div>

          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => onChooseFile(event.target.files?.[0] ?? null)}
          />

          <div className="actions">
            <button className="btn-primary" onClick={parseEstimate} disabled={!file}>
              Parse Estimate
            </button>
            <button className="btn-soft" onClick={resetAll}>
              Clear
            </button>
          </div>
          <div className={`status${statusTone ? ` ${statusTone}` : ""}`}>{status}</div>
          <div className="small-note">API base URL: {apiBaseUrl || "(not set, fallback mode)"}</div>

          <div className="meta-grid">
            <div>
              <label htmlFor="invoiceNo">Invoice #</label>
              <input
                id="invoiceNo"
                type="text"
                value={meta.invoiceNo}
                onChange={(event) => onMetaChange("invoiceNo", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="roNo">RO #</label>
              <input id="roNo" type="text" value={meta.roNo} onChange={(event) => onMetaChange("roNo", event.target.value)} />
            </div>
            <div>
              <label htmlFor="vin">VIN</label>
              <input id="vin" type="text" value={meta.vin} onChange={(event) => onMetaChange("vin", event.target.value)} />
            </div>
            <div>
              <label htmlFor="yearMakeModel">Year / Make / Model</label>
              <input
                id="yearMakeModel"
                type="text"
                value={meta.yearMakeModel}
                onChange={(event) => onMetaChange("yearMakeModel", event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="repairDate">Repair Date</label>
              <input
                id="repairDate"
                type="text"
                value={meta.repairDate}
                onChange={(event) => onMetaChange("repairDate", event.target.value)}
              />
            </div>
          </div>
          <div className="small-note" style={{ marginTop: 6 }}>
            Currency is fixed to USD.
          </div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" value={meta.notes} onChange={(event) => onMetaChange("notes", event.target.value)} />
          </div>

          <h2 style={{ marginTop: 14 }}>2) Detected Repair Operations</h2>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 13, color: "#4b5563" }}>
            <input
              type="checkbox"
              checked={showOperationDebug}
              onChange={(event) => setShowOperationDebug(event.target.checked)}
            />
            Show CCC operation debug (raw -&gt; normalized)
          </label>
          <div className="ops-list">
            {operations.length === 0 ? (
              <div className="small-note">No operation detected yet.</div>
            ) : (
              operations.map((operation) => {
                const context = getOperationContext(operation);
                return (
                  <label className="op-item" key={operation}>
                    <input
                      type="checkbox"
                      checked={selectedOps.has(operation)}
                      onChange={(event) => toggleOperation(operation, event.target.checked)}
                    />
                    <span>
                      {context?.groupLabel ? (
                        <>
                          <strong>{context.groupLabel}</strong>
                          <br />
                          {formatOperationWithTriggerLabel(toDirectionAbbreviation(operation), context)}
                        </>
                      ) : (
                        <>
                          {operation}
                          <br />
                          <em style={{ color: "#9ca3af" }}>(Estimate line # unavailable)</em>
                        </>
                      )}
                    </span>
                  </label>
                );
              })
            )}
          </div>
          {showOperationDebug && (
            <div className="raw-preview" style={{ marginTop: 10, maxHeight: 220 }}>
              {operationDebugRows.length === 0 ? (
                "No debug rows yet."
              ) : (
                operationDebugRows.map((row, index) => (
                  <div key={`${row.source}-${index}`} style={{ marginBottom: 6 }}>
                    [{row.source}] {row.kept ? "KEEP" : "DROP"} | {row.reason}
                    <br />
                    raw: {row.raw}
                    <br />
                    normalized: {row.normalized}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="actions">
            <button className="btn-primary" onClick={generateLines} disabled={operations.length === 0}>
              Generate Consumable Lines
            </button>
            <label style={{ marginLeft: 8, fontSize: 13, color: "#4b5563" }}>
              Tier
              <select
                style={{ marginLeft: 6 }}
                value={tier}
                onChange={(event) => setTier(event.target.value as "T1" | "T2" | "T3")}
              >
                <option value="T1">T1</option>
                <option value="T2">T2</option>
                <option value="T3">T3</option>
              </select>
            </label>
          </div>

          <div className="raw-preview">{rawText ? rawText.slice(0, 1800) : "Parsed text preview will appear here."}</div>
        </section>

        <section className="card">
          <div className="invoice-title" ref={invoiceExportRef}>
            <h2>3) Editable Consumable Invoice</h2>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn-soft" onClick={addLine}>
                Add Line
              </button>
              <button className="btn-danger" onClick={deleteSelectedLines}>
                Delete Selected
              </button>
              <button className="btn-primary" onClick={exportJson}>
                Export JSON
              </button>
              <button className="btn-primary" onClick={exportPdf}>
                Export PDF
              </button>
              <button className="btn-primary" onClick={exportJpg}>
                Export JPG
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 28 }}>Sel</th>
                  <th>Description</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 90 }}>Unit</th>
                  <th style={{ width: 110 }}>Unit Price</th>
                  <th style={{ width: 96 }}>Line Total</th>
                  <th style={{ width: 120 }}>Source</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>
                      No invoice lines. Generate from operations or add manually.
                    </td>
                  </tr>
                ) : (
                  groupedLines.flatMap(([groupKey, grouped]) => [
                    <tr key={`group-${groupKey}`}>
                      <td colSpan={8} style={{ background: "#f3f4f6", fontWeight: 700, padding: "10px 12px", textAlign: "left" }}>
                        {getInvoiceOperationDisplay(grouped.operation)}
                      </td>
                    </tr>,
                    ...grouped.lines.map((line, index) => (
                      <tr key={line.id}>
                        <td>{index + 1}</td>
                        <td>
                          <input type="checkbox" data-line-select="1" data-id={line.id} />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={line.description}
                            onChange={(event) => updateLine(line.id, "description", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={line.qty}
                            onChange={(event) => updateLine(line.id, "qty", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={line.unit}
                            onChange={(event) => updateLine(line.id, "unit", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(event) => updateLine(line.id, "unitPrice", event.target.value)}
                          />
                        </td>
                        <td className="amount-cell">
                          <strong>{formatMoney(calcLineAmount(line))}</strong>
                        </td>
                        <td>{line.source}</td>
                      </tr>
                    ))
                  ])
                )}
              </tbody>
            </table>
          </div>

          <div className="totals">
            <div className="totals-row">
              <span>Subtotal</span>
              <strong>{formatMoney(totals.subtotal)}</strong>
            </div>
            <div className="totals-row">
              <span>Tax</span>
              <strong>{formatMoney(totals.tax)}</strong>
            </div>
            <div className="totals-row final">
              <span>Total</span>
              <strong>{formatMoney(totals.total)}</strong>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
