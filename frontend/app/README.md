# Frontend App Information Architecture (MVP)

## Route Groups

- `(auth)`
  - `/login`
  - `/invite/accept`
- `(dashboard)`
  - `/estimates`
  - `/estimates/[estimateId]`
  - `/invoices`
  - `/invoices/[invoiceId]`
  - `/settings/strategies`
  - `/settings/shop`

## Shared UI Blocks

- Estimate upload panel
- Parse status badge
- Invoice line editor table
- Source metadata tooltip
- Export action drawer

## Client-State Boundaries

- Query cache: lists/details from API
- Form state: invoice line editing only
- No tenant id in URL query; tenant resolved from auth session

## Local Prototype Page

- File: `estimate-invoice-prototype.html`
- Purpose: MVP browser prototype for estimate PDF upload/drag-drop -> consumable invoice line generation -> inline editing
- Open directly in browser (double-click) while Next.js app is not scaffolded yet

## Next.js Implementation

- New app path: `../web`
- Route: `/estimates/new`
- Includes the same flow with API-first generation and local fallback rules
