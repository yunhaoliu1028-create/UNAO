"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { InvoiceExportPages } from "@/components/invoice/invoice-export-pages";
import { StatusBadge } from "@/components/ui/status-badge";
import type { InvoiceLine, InvoiceMeta } from "@/lib/invoice";

const PAGE_SIZE = 5;

type HistoryRow = {
  id: string;
  date: string;
  roNo: string;
  vin: string;
  roVin: string;
  vehicleInfo: string;
  insuranceCompany: string;
  invoiceNo: string;
  total: number;
  status: "Completed" | "Processing" | "Needs Review";
};

type BodyShopInfo = {
  name: string;
  addressLine1: string;
};

type SavedInvoiceDetails = {
  id: string;
  meta: InvoiceMeta;
  bodyShop: BodyShopInfo;
  lines: InvoiceLine[];
};

const statusFilterItems: Array<{ value: "All" | HistoryRow["status"]; label: string }> = [
  { value: "All", label: "All Status" },
  { value: "Completed", label: "Completed" },
  { value: "Processing", label: "Processing" },
  { value: "Needs Review", label: "Needs Review" }
];

type SortField = "date" | "total" | "status" | "invoiceNo";
type SortDirection = "asc" | "desc";

export default function HistoryPage() {
  const [rowsAll, setRowsAll] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState("");
  const [updatingStatusId, setUpdatingStatusId] = useState("");
  const [statusMenuRowId, setStatusMenuRowId] = useState("");
  const [downloadMenuRowId, setDownloadMenuRowId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | HistoryRow["status"]>("All");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [exportingId, setExportingId] = useState("");
  const [invoiceForExport, setInvoiceForExport] = useState<SavedInvoiceDetails | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const invoiceExportRef = useRef<HTMLDivElement>(null);

  async function refreshRows(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch("/v1/invoices");
      if (!response.ok) {
        setRowsAll([]);
        return;
      }
      const data = (await response.json()) as { invoices?: HistoryRow[] };
      setRowsAll(Array.isArray(data.invoices) ? data.invoices : []);
    } catch {
      setRowsAll([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshRows();
  }, []);

  useEffect(() => {
    function onGlobalPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (statusMenuRef.current && target && !statusMenuRef.current.contains(target)) {
        setStatusMenuRowId("");
      }
      if (downloadMenuRef.current && target && !downloadMenuRef.current.contains(target)) {
        setDownloadMenuRowId("");
      }
    }
    window.addEventListener("mousedown", onGlobalPointerDown);
    return () => window.removeEventListener("mousedown", onGlobalPointerDown);
  }, []);

  function buildExportName(invoiceNo: string, prefix: string, ext: string): string {
    const base = (invoiceNo || "invoice-draft").replace(/[^\w\-]+/g, "_");
    return `${prefix}-${base}.${ext}`;
  }

  async function renderPagesAsImages(container: HTMLDivElement | null, imageType: "png" | "jpeg" = "png"): Promise<string[]> {
    if (!container) {
      return [];
    }
    const pageNodes = Array.from(container.querySelectorAll<HTMLElement>('[data-export-page="1"]'));
    if (pageNodes.length === 0) {
      return [];
    }
    const html2canvas = (await import("html2canvas")).default;
    const output: string[] = [];
    for (const node of pageNodes) {
      const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
      const mime = imageType === "jpeg" ? "image/jpeg" : "image/png";
      const quality = imageType === "jpeg" ? 0.95 : 1;
      output.push(canvas.toDataURL(mime, quality));
    }
    return output;
  }

  async function downloadDocumentImages(container: HTMLDivElement | null, invoiceNo: string): Promise<void> {
    const pageDataUrls = await renderPagesAsImages(container, "jpeg");
    if (pageDataUrls.length === 0) {
      return;
    }
    for (let index = 0; index < pageDataUrls.length; index += 1) {
      const anchor = document.createElement("a");
      anchor.href = pageDataUrls[index];
      anchor.download = buildExportName(invoiceNo, `consumable-invoice-p${index + 1}`, "jpg");
      anchor.click();
    }
  }

  async function downloadDocumentPdf(container: HTMLDivElement | null, invoiceNo: string): Promise<void> {
    const pageDataUrls = await renderPagesAsImages(container);
    if (pageDataUrls.length === 0) {
      return;
    }
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    pageDataUrls.forEach((dataUrl, index) => {
      if (index > 0) {
        pdf.addPage();
      }
      const imageProps = pdf.getImageProperties(dataUrl);
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const scale = Math.min(pageWidth / imageProps.width, pageHeight / imageProps.height);
      const renderWidth = imageProps.width * scale;
      const renderHeight = imageProps.height * scale;
      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;
      pdf.addImage(dataUrl, "PNG", x, y, renderWidth, renderHeight, undefined, "FAST");
    });
    pdf.save(buildExportName(invoiceNo, "consumable-invoice", "pdf"));
  }

  async function openInvoiceDownload(id: string, format: "pdf" | "jpg"): Promise<void> {
    setExportingId(id);
    try {
      const response = await fetch(`/v1/invoices/${encodeURIComponent(id)}`);
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { invoice?: SavedInvoiceDetails };
      const invoice = data.invoice;
      if (!invoice) {
        return;
      }
      setInvoiceForExport(invoice);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      if (format === "pdf") {
        await downloadDocumentPdf(invoiceExportRef.current, invoice.meta.invoiceNo || invoice.id);
      } else {
        await downloadDocumentImages(invoiceExportRef.current, invoice.meta.invoiceNo || invoice.id);
      }
      setDownloadMenuRowId("");
    } finally {
      setExportingId("");
    }
  }

  async function deleteRow(id: string): Promise<void> {
    if (!window.confirm(`Delete invoice ${id}? This cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    try {
      const response = await fetch(`/v1/invoices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        return;
      }
      setRowsAll((prev) => prev.filter((row) => row.id !== id));
    } catch {
      return;
    } finally {
      setDeletingId("");
    }
  }

  async function updateRowStatus(id: string, status: HistoryRow["status"]): Promise<void> {
    setUpdatingStatusId(id);
    try {
      const response = await fetch(`/v1/invoices/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) {
        return;
      }
      setRowsAll((prev) => prev.map((row) => (row.id === id ? { ...row, status } : row)));
    } catch {
      return;
    } finally {
      setUpdatingStatusId("");
    }
  }

  const filteredAndSorted = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filteredRows = rowsAll.filter((row) => {
      const keywordMatched =
        !keyword ||
        row.roVin.toLowerCase().includes(keyword) ||
        row.roNo.toLowerCase().includes(keyword) ||
        row.vin.toLowerCase().includes(keyword) ||
        row.id.toLowerCase().includes(keyword) ||
        row.vehicleInfo.toLowerCase().includes(keyword) ||
        row.insuranceCompany.toLowerCase().includes(keyword) ||
        row.invoiceNo.toLowerCase().includes(keyword);
      const statusMatched = statusFilter === "All" || row.status === statusFilter;
      return keywordMatched && statusMatched;
    });

    return [...filteredRows].sort((a, b) => {
      let compare = 0;
      if (sortField === "date") {
        compare = Date.parse(a.date) - Date.parse(b.date);
      } else if (sortField === "total") {
        compare = a.total - b.total;
      } else if (sortField === "status") {
        compare = a.status.localeCompare(b.status);
      } else {
        compare = a.invoiceNo.localeCompare(b.invoiceNo);
      }
      return sortDirection === "asc" ? compare : -compare;
    });
  }, [query, rowsAll, sortDirection, sortField, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filteredAndSorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-apptext">History</h1>
            <p className="mt-2 text-sm text-appmuted">Search and review past consumables invoices.</p>
          </div>
          <div className="flex w-full flex-col gap-2 md:max-w-sm">
            <input
              type="text"
              value={query}
              placeholder="Search by RO/VIN, vehicle, insurance, invoice #"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-full border border-appline bg-white px-4 py-2.5 text-sm text-apptext outline-none transition focus:border-apptext"
            />
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as "All" | HistoryRow["status"]);
                setPage(1);
              }}
              className="w-full rounded-full border border-appline bg-white px-4 py-2.5 text-sm text-apptext outline-none transition focus:border-apptext"
            >
              {statusFilterItems.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <select
                value={sortField}
                onChange={(event) => {
                  setSortField(event.target.value as SortField);
                  setPage(1);
                }}
                className="w-full rounded-full border border-appline bg-white px-4 py-2.5 text-sm text-apptext outline-none transition focus:border-apptext"
              >
                <option value="date">Sort by Date</option>
                <option value="total">Sort by Total</option>
                <option value="status">Sort by Status</option>
                <option value="invoiceNo">Sort by Invoice #</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
                  setPage(1);
                }}
                className="rounded-full border border-appline bg-white px-4 py-2.5 text-sm font-semibold text-apptext transition hover:bg-appprimary/10"
              >
                {sortDirection === "asc" ? "Asc" : "Desc"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <DataTableShell>
        <table className="min-w-full divide-y divide-appline">
          <thead className="bg-appprimary/5">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-appmuted">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Invoice #</th>
              <th className="px-4 py-3">RO</th>
              <th className="px-4 py-3">Vehicle Info</th>
              <th className="px-4 py-3">VIN</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Insurance</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-appline bg-white text-sm text-apptext">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-appmuted">
                  {loading ? "Loading..." : "No records found."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">{row.date}</td>
                  <td className="px-4 py-3">{row.invoiceNo}</td>
                  <td className="px-4 py-3">{row.roNo}</td>
                  <td className="px-4 py-3">{row.vehicleInfo}</td>
                  <td className="px-4 py-3">{row.vin}</td>
                  <td className="px-4 py-3 font-semibold text-apptext">${row.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <div
                      className="relative inline-flex"
                      ref={(node) => {
                        if (statusMenuRowId === row.id) {
                          statusMenuRef.current = node;
                        }
                      }}
                    >
                      <button
                        type="button"
                        disabled={updatingStatusId === row.id}
                        onClick={() =>
                          setStatusMenuRowId((prev) => {
                            const next = prev === row.id ? "" : row.id;
                            if (next) {
                              setDownloadMenuRowId("");
                            }
                            return next;
                          })
                        }
                        className="disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <StatusBadge status={row.status} />
                      </button>
                      {statusMenuRowId === row.id ? (
                        <div className="absolute left-0 top-9 z-20 min-w-[160px] rounded-xl border border-appline bg-white p-1 shadow-card">
                          {(["Completed", "Processing", "Needs Review"] as const).map((statusOption) => (
                            <button
                              key={`${row.id}-${statusOption}`}
                              type="button"
                              className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                              onClick={() => {
                                void updateRowStatus(row.id, statusOption);
                                setStatusMenuRowId("");
                              }}
                            >
                              {statusOption}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{row.insuranceCompany}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/estimates/new?invoiceId=${encodeURIComponent(row.id)}`}
                        className="rounded-full border border-appline px-3 py-1.5 text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                      >
                        Edit
                      </Link>
                      <div
                        className="relative"
                        ref={(node) => {
                          if (downloadMenuRowId === row.id) {
                            downloadMenuRef.current = node;
                          }
                        }}
                      >
                        <button
                          type="button"
                          className="rounded-full border border-appline px-3 py-1.5 text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                          onClick={() =>
                            setDownloadMenuRowId((prev) => {
                              const next = prev === row.id ? "" : row.id;
                              if (next) {
                                setStatusMenuRowId("");
                              }
                              return next;
                            })
                          }
                        >
                          Download As
                        </button>
                        {downloadMenuRowId === row.id ? (
                          <div className="absolute right-0 top-8 z-20 min-w-[160px] rounded-xl border border-appline bg-white p-1 shadow-card">
                            <button
                              type="button"
                              className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                              onClick={() => {
                                void openInvoiceDownload(row.id, "pdf");
                                setDownloadMenuRowId("");
                              }}
                            >
                              {exportingId === row.id ? "Preparing..." : "Download as PDF"}
                            </button>
                            <button
                              type="button"
                              className="block w-full rounded-lg px-3 py-2 text-left text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                              onClick={() => {
                                void openInvoiceDownload(row.id, "jpg");
                                setDownloadMenuRowId("");
                              }}
                            >
                              {exportingId === row.id ? "Preparing..." : "Download as JPG"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="rounded-full border border-appline px-3 py-1.5 text-xs font-semibold text-apptext transition hover:bg-appprimary/10 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={deletingId === row.id}
                        onClick={() => void deleteRow(row.id)}
                      >
                        {deletingId === row.id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </DataTableShell>

      <section className="flex items-center justify-between rounded-2xl border border-appline bg-white px-4 py-3 text-sm text-appmuted shadow-card">
        <p>
          Page {safePage} / {pageCount}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-appline px-3 py-1.5 font-semibold text-apptext transition hover:bg-appprimary/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-full border border-appline px-3 py-1.5 font-semibold text-apptext transition hover:bg-appprimary/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage >= pageCount}
            onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
          >
            Next
          </button>
        </div>
      </section>
      <div className="pointer-events-none fixed -left-[9999px] -top-[9999px] opacity-0" aria-hidden="true">
        <div ref={invoiceExportRef}>
          {invoiceForExport ? (
            <InvoiceExportPages
              meta={invoiceForExport.meta}
              bodyShop={invoiceForExport.bodyShop}
              lines={invoiceForExport.lines}
              includeExportAttr
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
