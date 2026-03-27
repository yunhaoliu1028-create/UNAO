"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { recentHistory } from "@/lib/mock-data";

const PAGE_SIZE = 5;

export default function HistoryPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  function downloadRow(id: string) {
    const row = recentHistory.find((item) => item.id === id);
    if (!row) {
      return;
    }
    const payload = JSON.stringify(row, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${row.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return recentHistory;
    }
    return recentHistory.filter((row) => row.roVin.toLowerCase().includes(keyword) || row.id.toLowerCase().includes(keyword));
  }, [query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.03em] text-apptext">History</h1>
            <p className="mt-2 text-sm text-appmuted">Search and review past consumables invoices.</p>
          </div>
          <input
            type="text"
            value={query}
            placeholder="Search by RO/VIN or invoice id"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            className="w-full rounded-full border border-appline bg-white px-4 py-2.5 text-sm text-apptext outline-none transition focus:border-apptext md:max-w-sm"
          />
        </div>
      </section>

      <DataTableShell>
        <table className="min-w-full divide-y divide-appline">
          <thead className="bg-appprimary/5">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-appmuted">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">RO / VIN</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-appline bg-white text-sm text-apptext">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-appmuted">
                  No records found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">{row.date}</td>
                  <td className="px-4 py-3">{row.roVin}</td>
                  <td className="px-4 py-3 font-semibold text-apptext">${row.total.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/workspace/${row.id}`}
                        className="rounded-full border border-appline px-3 py-1.5 text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        className="rounded-full border border-appline px-3 py-1.5 text-xs font-semibold text-apptext transition hover:bg-appprimary/10"
                        onClick={() => downloadRow(row.id)}
                      >
                        Download
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
    </div>
  );
}
