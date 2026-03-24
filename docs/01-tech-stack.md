# 01 - Technical Stack Decision Record

## Product Shape

- Multi-tenant B2B SaaS
- Single deployment, shared infrastructure, strict tenant isolation
- Async-heavy pipeline for PDF parsing and export jobs

## Chosen Stack

### Frontend

- Framework: Next.js 15 (App Router) + React + TypeScript
- UI: Tailwind CSS + component primitives
- Data: TanStack Query + typed API client
- Why: fast dashboard iteration, strong TS ecosystem, SSR where needed

### Backend

- Framework: NestJS + TypeScript
- API style: REST first, OpenAPI contract; optional GraphQL later
- Job processing: BullMQ + Redis
- Why: modular boundaries map to domain modules from roadmap

### Data Layer

- Primary DB: PostgreSQL 16
- ORM: Prisma
- Cache/queue broker: Redis
- Object storage: S3-compatible bucket for PDF/JPG exports

### AI and Parsing

- OCR/PDF extraction pipeline:
  - Native text extraction first
  - OCR fallback for scanned PDFs
- LLM extraction:
  - Structured JSON output with strict schema
  - Versioned prompts and model metadata persisted per run

## Cloud and Ops Baseline

- Runtime: Dockerized services
- Environments: `dev`, `staging`, `prod`
- CI/CD: GitHub Actions (lint, test, build, deploy)
- Observability:
  - OpenTelemetry traces
  - Structured logs with tenant/user context
  - Metrics for parse success rate and invoice generation latency

## Security Baseline

- Auth: access token + refresh token
- RBAC: Estimator, Manager, Accounting, OwnerAdmin
- Data isolation:
  - `tenant_id` on all business tables
  - server-side tenant scoping in each query path
- Audit trails for all billable and policy-impacting edits

## Deferred Decisions

- Multi-region architecture after PMF
- Elasticsearch/OpenSearch only after query load justifies it
- SSO (SAML/OIDC enterprise setup) in phase 2+
