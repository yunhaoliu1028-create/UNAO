# 04 - Estimate to Invoice Flow and API Contract Notes

## End-to-End Sequence

```mermaid
sequenceDiagram
  participant User as ShopUser
  participant Web as WebApp
  participant API as BackendAPI
  participant Queue as JobQueue
  participant Parser as ParseWorker
  participant AI as AIWorker
  participant Engine as ConsumableEngine
  participant Export as ExportWorker
  participant Storage as ObjectStorage

  User->>Web: Upload estimate PDF
  Web->>API: POST /v1/estimates (multipart)
  API->>Storage: save original PDF
  API->>Queue: enqueue parse job
  API-->>Web: 202 accepted + estimate_id

  Queue->>Parser: parse estimate job
  Parser->>API: save normalized estimate + operations
  Parser->>Queue: enqueue AI extraction
  Queue->>AI: run extraction
  AI->>API: save AI tags and run metadata

  User->>Web: Select carrier + tier and generate invoice
  Web->>API: POST /v1/invoices/generate
  API->>Engine: evaluate rules with strategy
  Engine-->>API: generated invoice lines
  API-->>Web: draft invoice

  User->>Web: Edit lines and save
  Web->>API: PUT /v1/invoices/{id}
  API->>API: create invoice version snapshot
  API-->>Web: updated invoice

  User->>Web: Export PDF
  Web->>API: POST /v1/invoices/{id}/export
  API->>Queue: enqueue export job
  Queue->>Export: render template
  Export->>Storage: save exported PDF/JPG
  Export->>API: create attachment
  API-->>Web: export ready link
```

## Status Transitions

### Estimate

- `UPLOADED` -> `PARSING` -> `PARSED`
- `UPLOADED` -> `PARSING` -> `FAILED`
- retry: `FAILED` -> `PARSING`

### Invoice

- `DRAFT` -> `APPROVED` -> `EXPORTED` -> `SUBMITTED` -> `SETTLED`
- adjustment path: `APPROVED` -> `DRAFT` (manager unlock)

## Contract Conventions

- Base path: `/v1`
- Auth: Bearer JWT
- Tenant scoping: resolved from token claims; server never trusts client-passed tenant id
- Idempotency:
  - `POST /invoices/generate` accepts `idempotency_key`
  - repeated key within tenant returns existing draft
- Error model:
  - `{ code, message, details, request_id }`

## Core Endpoint List

- `POST /v1/auth/login`
- `POST /v1/estimates`
- `GET /v1/estimates`
- `GET /v1/estimates/{estimate_id}`
- `POST /v1/estimates/{estimate_id}/retry-parse`
- `POST /v1/invoices/generate`
- `GET /v1/invoices`
- `GET /v1/invoices/{invoice_id}`
- `PUT /v1/invoices/{invoice_id}`
- `POST /v1/invoices/{invoice_id}/duplicate`
- `POST /v1/invoices/{invoice_id}/export`
- `GET /v1/invoices/{invoice_id}/attachments`

## Contract-Safe DTO Principles

- Use explicit decimal strings in payload for currency and qty
- Preserve provenance fields on generated lines:
  - `source_type`
  - `source_rule_id`
  - `source_operation_ref`
  - `source_metadata`
- Persist generation context:
  - `ruleset_version`
  - `ai_model`
  - `ai_prompt_version`
  - `strategy_profile_id`
