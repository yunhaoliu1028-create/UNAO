"use client";

import { useMemo, useRef, useState } from "react";
import {
  calcLineAmount,
  detectOperations,
  extractMetadata,
  generateFallbackLines,
  generateInvoiceViaApi,
  parseNumber,
  type InvoiceLine,
  type InvoiceMeta
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

function readFileAsPdf(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Use CDN worker to avoid bundling worker setup complexity in prototype stage.
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const buffer = await readFileAsPdf(file);
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? String(item.str) : "")).join(" "));
  }

  return pages.join("\n");
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
  const [selectedOps, setSelectedOps] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [meta, setMeta] = useState<InvoiceMeta>(defaultMeta);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + calcLineAmount(line), 0);
    const tax = 0;
    return { subtotal, tax, total: subtotal + tax };
  }, [lines]);

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
      const text = await extractPdfText(file);
      const detectedOps = detectOperations(text);
      const detectedMeta = extractMetadata(text);

      setRawText(text);
      setOperations(detectedOps);
      setSelectedOps(new Set(detectedOps));
      setMeta((prev) => ({ ...prev, ...detectedMeta }));
      setStatusMessage(`Parse complete. Detected ${detectedOps.length} operation(s).`, "ok");
    } catch {
      setStatusMessage("PDF parse failed. Try another file.", "error");
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
      operations: opList
    });

    const generated = (apiResult?.lines ?? generateFallbackLines(opList)).map((line) => ({
      ...line,
      id: line.id || makeId()
    }));
    setLines(generated);

    if (apiResult) {
      setStatusMessage(`Generated ${generated.length} line(s) from API.`, "ok");
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
            <div>
              <label htmlFor="currency">Currency</label>
              <input
                id="currency"
                type="text"
                value={meta.currency}
                onChange={(event) => onMetaChange("currency", event.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label htmlFor="notes">Notes</label>
            <textarea id="notes" value={meta.notes} onChange={(event) => onMetaChange("notes", event.target.value)} />
          </div>

          <h2 style={{ marginTop: 14 }}>2) Detected Repair Operations</h2>
          <div className="ops-list">
            {operations.length === 0 ? (
              <div className="small-note">No operation detected yet.</div>
            ) : (
              operations.map((operation, index) => (
                <label className="op-item" key={operation}>
                  <input
                    type="checkbox"
                    checked={selectedOps.has(operation)}
                    onChange={(event) => toggleOperation(operation, event.target.checked)}
                  />
                  <span>
                    {index + 1}. {operation}
                  </span>
                </label>
              ))
            )}
          </div>
          <div className="actions">
            <button className="btn-primary" onClick={generateLines} disabled={operations.length === 0}>
              Generate Consumable Lines
            </button>
          </div>

          <div className="raw-preview">{rawText ? rawText.slice(0, 1800) : "Parsed text preview will appear here."}</div>
        </section>

        <section className="card">
          <div className="invoice-title">
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
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 28 }}>Sel</th>
                  <th style={{ width: 180 }}>Operation</th>
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
                    <td colSpan={9} style={{ textAlign: "center", color: "#6b7280", padding: 20 }}>
                      No invoice lines. Generate from operations or add manually.
                    </td>
                  </tr>
                ) : (
                  lines.map((line, index) => (
                    <tr key={line.id}>
                      <td>{index + 1}</td>
                      <td>
                        <input type="checkbox" data-line-select="1" data-id={line.id} />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={line.operation}
                          onChange={(event) => updateLine(line.id, "operation", event.target.value)}
                        />
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
