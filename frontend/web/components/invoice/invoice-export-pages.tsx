import { type InvoiceLine, type InvoiceMeta } from "@/lib/invoice";

type BodyShopInfo = {
  name: string;
  addressLine1: string;
};

type InvoiceExportPagesProps = {
  meta: InvoiceMeta;
  bodyShop: BodyShopInfo;
  lines: InvoiceLine[];
  includeExportAttr: boolean;
  pageRowLimit?: number;
};

function parseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function buildAggregateRows(lines: InvoiceLine[]) {
  const map = new Map<
    string,
    {
      partNo: string;
      description: string;
      unit: string;
      unitPrice: number;
      totalQty: number;
    }
  >();

  for (const line of lines) {
    const partNo = resolveLinePartNo(line);
    const description = line.description || "Unnamed Consumable";
    const unit = line.unit || "Each";
    const unitPrice = parseNumber(line.unitPrice, 0);
    const key = `${partNo}|${description}|${unit}|${unitPrice.toFixed(2)}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalQty += parseNumber(line.qty, 0);
    } else {
      map.set(key, {
        partNo,
        description,
        unit,
        unitPrice,
        totalQty: parseNumber(line.qty, 0)
      });
    }
  }

  return Array.from(map.values())
    .map((row) => ({
      ...row,
      amount: Number((row.totalQty * row.unitPrice).toFixed(2))
    }))
    .sort((a, b) => a.description.localeCompare(b.description));
}

export function InvoiceExportPages({ meta, bodyShop, lines, includeExportAttr, pageRowLimit = 30 }: InvoiceExportPagesProps) {
  const aggregateRows = buildAggregateRows(lines);
  const pages: typeof aggregateRows[] = [];
  for (let i = 0; i < aggregateRows.length; i += pageRowLimit) {
    pages.push(aggregateRows.slice(i, i + pageRowLimit));
  }
  const allPages = pages.length > 0 ? pages : [[]];
  const grandTotal = aggregateRows.reduce((sum, row) => sum + row.amount, 0);
  const [shopAddrLine1, shopAddrLine2] = formatBodyShopAddressLines(bodyShop.addressLine1);

  return (
    <>
      {allPages.map((rows, pageIndex) => (
        <section
          key={`invoice-page-${pageIndex}`}
          className="export-page"
          {...(includeExportAttr ? { "data-export-page": "1" } : {})}
        >
          <header className="export-doc-header">
            <div>
              <div className="export-doc-kicker">BILLING DOCUMENT</div>
              <div className="export-doc-title">Consumable Invoice</div>
            </div>
            <div className="export-doc-meta">
              <span>Date</span>
              <strong>{meta.repairDate || new Date().toLocaleDateString()}</strong>
            </div>
          </header>
          <div className="export-info-grid">
            <div className="export-info-card">
              <div className="export-info-title">Bill From</div>
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
          <table className="export-invoice-table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Part #</th>
                <th>Description</th>
                <th style={{ width: 90 }}>Total Qty</th>
                <th style={{ width: 90 }}>Unit</th>
                <th style={{ width: 110 }}>Unit Price</th>
                <th style={{ width: 110 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.partNo}-${row.description}-${row.unitPrice}`}>
                  <td>{row.partNo || "-"}</td>
                  <td>{cleanDescriptionWithPartNo(row.description, row.partNo)}</td>
                  <td>{row.totalQty.toFixed(2)}</td>
                  <td>{row.unit}</td>
                  <td>{formatMoney(row.unitPrice)}</td>
                  <td>{formatMoney(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
