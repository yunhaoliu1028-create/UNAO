# 05 - 3M Catalog Core Extraction Spec

## Purpose

Extract only the product master data required by the invoice engine path:

`repair action -> consumable usage -> invoice line`.

The source table is:
`assets/3M material list price US.csv`

## Canonical Product Schema (Frozen)

```ts
type PricingMode = "per_piece" | "percent_of_container" | "unknown";

type ThreeMCatalogCoreItem = {
  partNumber: string; // keep as string, preserve leading zeros
  description: string;
  category: string | null;
  containerCost: number | null;
  piecesPerContainer: number | null;
  invoiceUnit: string | null;
  packageType: string | null;
  taxable: boolean | null;
  recoverable: boolean | null;
  pricingMode: PricingMode;
};
```

## Raw CSV -> Canonical Mapping

| Canonical Field | Raw CSV Column |
| --- | --- |
| `partNumber` | `Part Number` |
| `description` | `Description` |
| `category` | `Paint and Materials Category` |
| `containerCost` | `Container Cost` |
| `piecesPerContainer` | `Pieces Per Container` |
| `invoiceUnit` | `Invoice Unit` |
| `packageType` | `Size` |
| `taxable` | `Taxable` |
| `recoverable` | `Enable for Invoicing (Recoverable)` |
| `pricingMode` | derived from `Remove By` |

## Fields Explicitly Dropped

These fields are not needed in the invoice calculation path and are excluded from the core catalog:

- `Manufacturer`
- `Distributor Branch`
- `Order Group (required for integrated distributor)`
- `Stock Location`
- `Min`
- `Max`
- `Quantity On Hand`
- `UPC`
- `Select RepairStack Catalog Product`
- `Sale Price Option (3M List Price or Cost + Markup)`
- `Custom Markup %`
- `Invoicing Categories`
- `Remove By` (kept only as `pricingMode` derived value)

## Normalization Rules

1. **Primary key handling**
   - `partNumber` is always a string.
   - Never cast to integer (to preserve values like `01130`).

2. **Boolean normalization**
   - `Yes` -> `true`
   - `No` -> `false`
   - empty/unknown -> `null`

3. **Number normalization**
   - `containerCost` and `piecesPerContainer` are parsed as numeric.
   - empty/unparseable -> `null`.

4. **Pricing mode derivation**
   - `Remove By = Each Piece` -> `pricingMode = "per_piece"`
   - `Remove By = Percent` -> `pricingMode = "percent_of_container"`
   - other values -> `pricingMode = "unknown"`

5. **Unit handling**
   - Keep raw display text in `invoiceUnit`.
   - Do not aggressively merge units at extraction stage.

6. **Duplicate part number policy**
   - Keep duplicates when the same `partNumber` appears with different rows.
   - De-duplication decisions belong to rule mapping stage, not raw catalog extraction.

## Output Contract for Invoice Rule Layer

Invoice rules should reference only:

- `partNumber`
- usage quantity/value (`qty` or `%`)

The pricing layer then resolves:

- `pricingMode`
- `containerCost`
- `piecesPerContainer`
- `invoiceUnit`

This separation allows CSV price refreshes without changing repair mapping rules.

## Example Records

```json
[
  {
    "partNumber": "08115",
    "description": "3M\u2122 Panel Bonding Adhesive, 200 mL Cartridge",
    "category": "ALLIED - ADHESIVES, COATINGS, SEALERS (ACS)",
    "containerCost": 122.01,
    "piecesPerContainer": null,
    "invoiceUnit": null,
    "packageType": "Cartridge",
    "taxable": false,
    "recoverable": true,
    "pricingMode": "percent_of_container"
  },
  {
    "partNumber": "08852",
    "description": "3M\u2122 Cavity Wax Plus, 18 oz Net Wt / 511g Can",
    "category": "ALLIED - ADHESIVES, COATINGS, SEALERS (ACS)",
    "containerCost": 58.21,
    "piecesPerContainer": null,
    "invoiceUnit": null,
    "packageType": "Can",
    "taxable": false,
    "recoverable": true,
    "pricingMode": "percent_of_container"
  },
  {
    "partNumber": "02035",
    "description": "3M\u2122 Wetordry\u2122 Abrasive Sheet 213Q, P800, 9 in x 11 in",
    "category": "ALLIED - ABRASIVES (ABR)",
    "containerCost": 130.5,
    "piecesPerContainer": 50,
    "invoiceUnit": "Sheet(s)",
    "packageType": "Carton",
    "taxable": false,
    "recoverable": true,
    "pricingMode": "per_piece"
  }
]
```
