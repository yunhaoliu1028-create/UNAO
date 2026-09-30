"use client";

import { use, useMemo, useState } from "react";
import { Tabs } from "@/components/ui/tabs";

const tabItems = [
  { id: "report", label: "Report" },
  { id: "invoice", label: "Consumable Invoice" },
  { id: "resources", label: "ALLDATA Resources" },
  { id: "estimate", label: "Original Estimate" }
];

const reportRows = [
  {
    operation: "R&I Front Bumper",
    consumable: "Adhesion Promoter",
    reason: "Plastic substrate prep requires promoter before basecoat.",
    source: "ALLDATA"
  },
  {
    operation: "Quarter Panel Refinish",
    consumable: "Seam Sealer",
    reason: "Refinish and corrosion protection repair path includes seam restoration.",
    source: "OEM Corrosion Protection Supports"
  },
  {
    operation: "Blend Left Rear Door",
    consumable: "Blend Solvent",
    reason: "Blend edge control and fade-out process in panel transition.",
    source: "3M Docs"
  }
];

const invoiceRows = [
  { item: "Masking Paper", qty: 2, unitPrice: 9.5 },
  { item: "Seam Sealer", qty: 1, unitPrice: 24.0 },
  { item: "Adhesion Promoter", qty: 1, unitPrice: 18.2 },
  { item: "Blend Solvent", qty: 1, unitPrice: 12.4 }
];

const resources = [
  { title: "OEM Corrosion Protection - Ford F150", href: "https://www.alldata.com" },
  { title: "3M Refinish Process Guide", href: "https://www.3m.com" },
  { title: "ALLDATA Blend Procedure Reference", href: "https://www.alldata.com" }
];

type WorkspacePageProps = {
  params: Promise<{ id: string }>;
};

export default function WorkspacePage({ params }: WorkspacePageProps) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState("report");
  const total = useMemo(() => invoiceRows.reduce((sum, row) => sum + row.qty * row.unitPrice, 0), []);

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-apptext">Workspace View</h1>
        <p className="mt-2 text-sm text-appmuted">
          Workspace ID: <span className="font-medium text-apptext">{id}</span>
        </p>
      </section>

      <section className="rounded-3xl border border-appline bg-white p-7 shadow-card sm:p-8">
        <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} />

        {activeTab === "report" ? (
          <div id="panel-report" role="tabpanel" aria-labelledby="tab-report" className="space-y-3 pt-1">
            {reportRows.map((row) => (
              <article key={`${row.operation}-${row.consumable}`} className="rounded-2xl border border-appline p-4">
                <p className="text-sm font-semibold text-apptext">
                  {row.operation} - {row.consumable}
                </p>
                <p className="mt-1 text-sm text-appmuted">{row.reason}</p>
                <span className="mt-2 inline-flex rounded-full border border-appline bg-appprimary/5 px-2.5 py-1 text-xs font-semibold text-appmuted">
                  {row.source}
                </span>
              </article>
            ))}
          </div>
        ) : null}

        {activeTab === "invoice" ? (
          <div id="panel-invoice" role="tabpanel" aria-labelledby="tab-invoice" className="space-y-4 pt-1">
            <div className="overflow-x-auto rounded-2xl border border-appline">
              <table className="min-w-full divide-y divide-appline">
                <thead className="bg-appprimary/5">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-appmuted">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Unit Price</th>
                    <th className="px-4 py-3">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-appline bg-white text-sm text-apptext">
                  {invoiceRows.map((row) => (
                    <tr key={row.item}>
                      <td className="px-4 py-3">{row.item}</td>
                      <td className="px-4 py-3">{row.qty}</td>
                      <td className="px-4 py-3">${row.unitPrice.toFixed(2)}</td>
                      <td className="px-4 py-3">${(row.qty * row.unitPrice).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ml-auto w-full max-w-xs rounded-2xl border border-appline bg-appprimary/5 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-appmuted">Subtotal</span>
                <strong className="text-apptext">${total.toFixed(2)}</strong>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-appline pt-2 text-base">
                <span className="font-semibold text-apptext">Total</span>
                <strong className="text-apptext">${total.toFixed(2)}</strong>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "resources" ? (
          <div id="panel-resources" role="tabpanel" aria-labelledby="tab-resources" className="grid gap-3 pt-1 md:grid-cols-2">
            {resources.map((resource) => (
              <a
                key={resource.title}
                href={resource.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-appline p-4 transition hover:bg-appprimary/5"
              >
                <p className="text-sm font-semibold text-apptext">{resource.title}</p>
                <p className="mt-1 text-xs text-appmuted">Open OEM / ALLDATA source page</p>
              </a>
            ))}
          </div>
        ) : null}

        {activeTab === "estimate" ? (
          <div id="panel-estimate" role="tabpanel" aria-labelledby="tab-estimate" className="space-y-3 pt-1">
            <div className="aspect-[16/10] w-full rounded-2xl border border-appline bg-appprimary/5 p-3">
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-appline bg-white text-sm text-appmuted">
                Embedded PDF Viewer Placeholder
              </div>
            </div>
            <div className="rounded-2xl border border-appline bg-appprimary/5 p-4 text-sm text-apptext">
              <p className="font-semibold text-apptext">Extracted Estimate Text (Fallback)</p>
              <p className="mt-1">
                Labor op 111A: R&I Front Bumper. Labor op 235C: Quarter Panel Refinish. Material line indicates corrosion
                protection and blending requirements.
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
