import { type InvoiceLine, type InvoiceMeta } from "@/lib/invoice";

type BodyShopInfo = {
  name: string;
  addressLine1: string;
};

export type SummaryOperationBlock = {
  groupLabel: string;
  operation: string;
  displayOperation: string;
  lines: InvoiceLine[];
  showGroupHeader: boolean;
  groupTotalAmount: number;
  isGroupLastBlock: boolean;
};

type SummaryExportPagesProps = {
  meta: InvoiceMeta;
  bodyShop: BodyShopInfo;
  summaryPages: SummaryOperationBlock[][];
  includeExportAttr: boolean;
  grandTotal: number;
};

function parseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function calcLineAmount(line: InvoiceLine): number {
  return parseNumber(line.qty, 0) * parseNumber(line.unitPrice, 0);
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function parsePartNumberFromSource(source: string): string {
  const match = String(source || "").match(/:3m(\d{3,6})\b/i);
  return match ? `3M ${match[1]}` : "";
}

function resolveLinePartNo(line: Pick<InvoiceLine, "partNo" | "source">): string {
  const manualPartNo = String(line.partNo || "").trim();
  if (manualPartNo) {
    return manualPartNo;
  }
  return parsePartNumberFromSource(line.source);
}

function cleanDescriptionWithPartNo(description: string, partNo: string): string {
  const text = String(description || "").trim();
  if (!text) {
    return "";
  }
  if (!/^3M\s+\d{3,6}$/i.test(String(partNo || "").trim())) {
    return text;
  }
  return text.replace(/^\s*3M[\s\-]+/i, "").trim();
}

function formatBodyShopAddressLines(addressLine1: string): [string, string] {
  const normalized = String(addressLine1 || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["Address Line 1", "City, State ZIP"];
  }
  const commaParts = normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (commaParts.length >= 2) {
    return [commaParts[0], commaParts.slice(1).join(", ")];
  }
  const tokens = normalized.split(" ");
  if (tokens.length <= 6) {
    return [normalized, "City, State ZIP"];
  }
  const splitIndex = Math.ceil(tokens.length * 0.6);
  return [tokens.slice(0, splitIndex).join(" "), tokens.slice(splitIndex).join(" ")];
}

export function SummaryExportPages({ meta, bodyShop, summaryPages, includeExportAttr, grandTotal }: SummaryExportPagesProps) {
  const allPages = summaryPages.length > 0 ? summaryPages : [[]];
  const [shopAddrLine1, shopAddrLine2] = formatBodyShopAddressLines(bodyShop.addressLine1);

  return (
    <>
      {allPages.map((pageBlocks, pageIndex) => (
        <section
          key={`summary-page-${pageIndex}`}
          className="export-page"
          {...(includeExportAttr ? { "data-export-page": "1" } : {})}
        >
          <header className="export-doc-header">
            <div>
              <div className="export-doc-kicker">INSURANCE DOCUMENT</div>
              <div className="export-doc-title">Consumable Usage Summary</div>
            </div>
            <div className="export-doc-meta">
              <span>Date</span>
              <strong>{meta.repairDate || new Date().toLocaleDateString()}</strong>
            </div>
          </header>
          <div className="export-info-grid">
            <div className="export-info-card">
              <div className="export-info-title">Bodyshop</div>
              <div className="export-info-body">
                <div>{bodyShop.name || "Bodyshop Name"}</div>
                <div>{shopAddrLine1}</div>
                <div>{shopAddrLine2}</div>
              </div>
            </div>
            <div className="export-info-card export-info-card-vehicle">
              <div className="export-info-title">Vehicle Information</div>
              <div className="vehicle-grid">
                <span>Vehicle Info</span>
                <strong>{meta.yearMakeModel || "-"}</strong>
                <span>VIN Number</span>
                <strong>{meta.vin || "-"}</strong>
                <span>RO Number</span>
                <strong>{meta.roNo || "-"}</strong>
                <span>Invoice Number</span>
                <strong>{meta.invoiceNo || "-"}</strong>
              </div>
            </div>
          </div>
          <div className="export-lines-table">
            {pageBlocks.map((block, blockIndex) => (
              <div key={`summary-block-${pageIndex}-${blockIndex}`} className="summary-block">
                {block.showGroupHeader ? <div className="summary-group">{block.groupLabel}</div> : null}
                <div className="summary-operation">{block.displayOperation}</div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Part #</th>
                      <th>Description</th>
                      <th style={{ width: 80 }}>Qty</th>
                      <th style={{ width: 90 }}>Unit</th>
                      <th style={{ width: 100 }}>Unit Price</th>
                      <th style={{ width: 100 }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.lines.map((line) => (
                      <tr key={`${block.groupLabel}-${block.operation}-${line.id}`}>
                        <td>{resolveLinePartNo(line) || "-"}</td>
                        <td>{cleanDescriptionWithPartNo(line.description, resolveLinePartNo(line))}</td>
                        <td>{parseNumber(line.qty, 0).toFixed(2)}</td>
                        <td>{line.unit}</td>
                        <td>{formatMoney(parseNumber(line.unitPrice, 0))}</td>
                        <td>{formatMoney(calcLineAmount(line))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {block.isGroupLastBlock ? (
                  <div className="summary-group-total">
                    <span>Application Amount</span>
                    <strong>{formatMoney(block.groupTotalAmount)}</strong>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {pageIndex === allPages.length - 1 ? (
            <div className="summary-grand-total">
              <span>Grand Total Amount</span>
              <strong>{formatMoney(grandTotal)}</strong>
            </div>
          ) : null}
          {allPages.length > 1 ? (
            <div className="export-page-index">
              Page {pageIndex + 1} of {allPages.length}
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}
