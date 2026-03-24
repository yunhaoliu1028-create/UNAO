# Backend Module Boundaries

This file defines MVP module boundaries before NestJS scaffolding.

## Modules

- `auth`: login, token refresh, invite acceptance
- `tenants`: shop profile and tenant-scoped settings
- `insurance`: carriers and strategy profile CRUD
- `estimate-intake`: upload, parse status, retry parse
- `ai-processing`: extraction runs, model/prompt versioning
- `consumable-engine`: rule evaluation and line generation
- `invoice`: draft generation, line edits, status changes
- `history`: filters, duplication, version timeline
- `billing`: subscription and usage meter (phase 2 placeholder)
- `audit`: immutable operation logs

## Layering Rules

- Controller -> Service -> Repository
- No cross-module DB access without service contracts
- All repository methods require tenant context
- Async work only through queue adapters
