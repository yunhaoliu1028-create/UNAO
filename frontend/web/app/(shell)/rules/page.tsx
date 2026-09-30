"use client";

import { useEffect, useMemo, useState } from "react";
import { DataTableShell } from "@/components/ui/data-table-shell";

const PAGE_SIZE = 15;

type RuleRow = {
  id: string;
  location: string;
  operation: string;
  productPartNo: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  make: string | null;
  model: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  bodyMaterial: string | null;
  source: string;
  usageCount: number;
  negativeCount: number;
  createdAt: string;
  updatedAt: string;
};

type SourceFilter = "all" | "user_learned" | "csv_seed" | "brand_preset";

const sourceFilters: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "All Sources" },
  { value: "user_learned", label: "User Learned" },
  { value: "csv_seed", label: "CSV Seed" },
  { value: "brand_preset", label: "Brand Preset" },
];

function sourceBadge(source: string) {
  if (source === "user_learned") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
        Learned
      </span>
    );
  }
  if (source === "brand_preset") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Brand
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      CSV
    </span>
  );
}

function yearRange(from: number | null, to: number | null): string {
  if (!from && !to) return "Any";
  if (from && to && from === to) return String(from);
  if (from && to) return `${from}–${to}`;
  if (from) return `${from}+`;
  return `≤${to}`;
}

export default function RulesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState("");
  const [negatingId, setNegatingId] = useState("");

  async function fetchRules() {
    setLoading(true);
    try {
      const res = await fetch("/v1/material-rules");
      if (!res.ok) {
        setRules([]);
        return;
      }
      const data = (await res.json()) as { rules?: RuleRow[] };
      setRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchRules();
  }, []);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this rule? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch("/v1/material-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== id));
      }
    } finally {
      setDeletingId("");
    }
  }

  async function handleNegative(id: string) {
    setNegatingId(id);
    try {
      const res = await fetch("/v1/material-rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, negative: true }),
      });
      if (res.ok) {
        setRules((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, negativeCount: r.negativeCount + 1 } : r
          )
        );
      }
    } finally {
      setNegatingId("");
    }
  }

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return rules.filter((r) => {
      if (sourceFilter !== "all" && r.source !== sourceFilter) return false;
      if (!kw) return true;
      return (
        r.location.toLowerCase().includes(kw) ||
        r.operation.toLowerCase().includes(kw) ||
        r.description.toLowerCase().includes(kw) ||
        r.productPartNo.toLowerCase().includes(kw) ||
        (r.make || "").toLowerCase().includes(kw) ||
        (r.model || "").toLowerCase().includes(kw)
      );
    });
  }, [rules, query, sourceFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Stats
  const learnedCount = rules.filter((r) => r.source === "user_learned").length;
  const csvCount = rules.filter((r) => r.source === "csv_seed").length;
  const brandCount = rules.filter((r) => r.source === "brand_preset").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-apptext">
              Material Rules
            </h1>
            <p className="mt-2 text-sm text-appmuted">
              Manage learned material rules for consumable invoice generation.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="rounded-xl border border-appline bg-white px-3 py-2 text-center shadow-soft">
              <p className="text-lg font-semibold text-apptext">{learnedCount}</p>
              <p className="text-xs text-appmuted">Learned</p>
            </div>
            <div className="rounded-xl border border-appline bg-white px-3 py-2 text-center shadow-soft">
              <p className="text-lg font-semibold text-apptext">{csvCount}</p>
              <p className="text-xs text-appmuted">CSV Seed</p>
            </div>
            <div className="rounded-xl border border-appline bg-white px-3 py-2 text-center shadow-soft">
              <p className="text-lg font-semibold text-apptext">{brandCount}</p>
              <p className="text-xs text-appmuted">Brand</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            type="text"
            value={query}
            placeholder="Search by location, operation, description, part #, make, model..."
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-full border border-appline bg-white px-4 py-2.5 text-sm text-apptext outline-none transition focus:border-apptext md:max-w-md"
          />
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value as SourceFilter);
              setPage(1);
            }}
            className="rounded-full border border-appline bg-white px-4 py-2.5 text-sm text-apptext outline-none transition focus:border-apptext"
          >
            {sourceFilters.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void fetchRules()}
            className="rounded-full border border-appline bg-white px-4 py-2.5 text-sm font-semibold text-apptext transition hover:bg-appprimary/10"
          >
            Refresh
          </button>
        </div>
      </section>

      {/* Table */}
      <DataTableShell>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-appline">
            <thead className="bg-appprimary/5">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-appmuted">
                <th className="px-3 py-3">Location</th>
                <th className="px-3 py-3">Operation</th>
                <th className="px-3 py-3">Part #</th>
                <th className="px-3 py-3">Description</th>
                <th className="px-3 py-3 text-right">Qty</th>
                <th className="px-3 py-3">Unit</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3">Vehicle</th>
                <th className="px-3 py-3">Years</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3 text-right">Uses</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-appline bg-white text-sm text-apptext">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-appmuted">
                    {loading ? "Loading rules..." : "No rules found."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2.5 font-medium">{r.location}</td>
                    <td className="px-3 py-2.5">{r.operation}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{r.productPartNo || "—"}</td>
                    <td className="max-w-[200px] truncate px-3 py-2.5" title={r.description}>
                      {r.description}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.qty}</td>
                    <td className="px-3 py-2.5">{r.unit}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      ${r.unitPrice.toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.make || r.model
                        ? `${r.make || ""}${r.model ? " " + r.model : ""}`
                        : "Any"}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums">
                      {yearRange(r.yearFrom, r.yearTo)}
                    </td>
                    <td className="px-3 py-2.5">{sourceBadge(r.source)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.usageCount}
                      {r.negativeCount > 0 && (
                        <span className="ml-1 text-xs text-red-500">
                          (-{r.negativeCount})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title="Mark as not applicable"
                          disabled={negatingId === r.id}
                          onClick={() => void handleNegative(r.id)}
                          className="rounded-full border border-appline px-2 py-1 text-xs font-semibold text-appmuted transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          {negatingId === r.id ? "..." : "N/A"}
                        </button>
                        {r.source === "user_learned" && (
                          <button
                            type="button"
                            disabled={deletingId === r.id}
                            onClick={() => void handleDelete(r.id)}
                            className="rounded-full border border-appline px-2 py-1 text-xs font-semibold text-appmuted transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          >
                            {deletingId === r.id ? "..." : "Del"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </DataTableShell>

      {/* Pagination */}
      <section className="flex items-center justify-between rounded-2xl border border-appline bg-white px-4 py-3 text-sm text-appmuted shadow-card">
        <p>
          {filtered.length} rule{filtered.length !== 1 ? "s" : ""} — Page {safePage} / {pageCount}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-full border border-appline px-3 py-1.5 font-semibold text-apptext transition hover:bg-appprimary/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-full border border-appline px-3 py-1.5 font-semibold text-apptext transition hover:bg-appprimary/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
