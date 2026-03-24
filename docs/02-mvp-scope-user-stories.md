# 02 - MVP Scope, User Stories, and UX Wireframe Notes

## MVP Goals

- Let body shop staff upload estimate PDFs and produce a professional consumables invoice quickly
- Support policy tiers (`Basic`, `Normal`) for initial insurer behavior differences
- Keep a searchable history and duplicate prior invoices for similar repairs

## Personas

- `Estimator`: creates and edits invoices
- `ShopManager`: reviews and approves invoice before submission
- `Accounting`: exports and tracks submission outcome

## MVP Functional Scope

### In Scope

- Auth + tenant onboarding
- Estimate PDF upload and parse status tracking
- AI+rule-assisted consumables generation
- Invoice editor (line-level edit/add/remove)
- PDF export
- Invoice history and duplicate

### Out of Scope (for MVP)

- Direct carrier API integrations
- Full policy designer UI for arbitrary rule scripting
- Dynamic strategy learning engine
- Enterprise SSO and multi-region deployment

## User Stories and Acceptance Criteria

### Epic A - Access and Tenant Context

1. **As an Estimator, I can sign in and only see my shop's data.**
   - Given I am authenticated with tenant scope
   - When I request estimates or invoices
   - Then I only receive rows where `tenant_id` equals my tenant

2. **As an OwnerAdmin, I can invite team members with a role.**
   - Invite link expires in configurable time window
   - Role is required at invite creation
   - New user defaults to tenant of inviter

### Epic B - Estimate Intake

3. **As an Estimator, I can upload an estimate PDF.**
   - Accept only PDF up to configured max size
   - Upload creates `Estimate` in `uploaded` status
   - Async parse job starts and status changes to `parsing`

4. **As an Estimator, I can see parse result or failure reason.**
   - Success shows normalized operations summary
   - Failure shows reason and retry option

### Epic C - Invoice Generation

5. **As an Estimator, I can select carrier + tier and generate invoice lines.**
   - Input requires estimate, carrier, and tier
   - Output creates draft invoice and at least one generated line
   - Each generated line stores source metadata (`rule_id`, `operation_ref`)

6. **As an Estimator, I can edit generated lines before export.**
   - Editable: description, qty, unit_price, notes
   - Add/remove lines allowed; manual lines tagged `source=manual`
   - Save persists a new invoice version

### Epic D - Export and History

7. **As Accounting, I can export invoice to PDF.**
   - Exported file includes shop info, claim ref, line totals, grand total
   - File is persisted and downloadable from history detail

8. **As Estimator, I can duplicate a historical invoice as draft.**
   - Duplicate copies line structure and pricing fields
   - Duplicate resets claim-specific metadata
   - New invoice has status `draft`

## Text Wireframes (MVP)

### Screen 1 - Estimate Upload

```text
+-----------------------------------------------------------+
| TopNav: ShopName | Estimates | Invoices | Settings        |
+-----------------------------------------------------------+
| Upload Estimate PDF                                       |
| [ Drag PDF here ] [ Choose file ]                         |
| Carrier (optional for parse): [ dropdown ]                |
| [Upload]                                                  |
|-----------------------------------------------------------|
| Recent Uploads                                            |
| # | File | SourceType | Status | Updated | Actions       |
| 1 | ...  | CCC        | parsing| ...     | View          |
+-----------------------------------------------------------+
```

### Screen 2 - Generate Invoice

```text
+-----------------------------------------------------------+
| Estimate #EST-001 | Parsed Ops: 24                        |
| Carrier: [StateFarm v] Tier: [Normal v] [Generate Draft] |
|-----------------------------------------------------------|
| Operation Group (collapsible)                             |
| - Front bumper refinish                                   |
|   -> Consumables generated lines (read-only preview)      |
| - Blend left fender                                       |
|   -> Consumables generated lines (read-only preview)      |
+-----------------------------------------------------------+
```

### Screen 3 - Invoice Editor

```text
+-----------------------------------------------------------+
| Invoice INV-2026-0001 [Draft]  [Save Version] [Export]   |
|-----------------------------------------------------------|
| Lines                                                     |
| # | Desc | Qty | Unit | UnitPrice | Amount | Source      |
| 1 | ...  | ... | ...  | ...       | ...    | rule:R102   |
| 2 | ...  | ... | ...  | ...       | ...    | manual      |
| [Add Line] [Delete Selected]                              |
|-----------------------------------------------------------|
| Subtotal: ...  Tax: ...  Total: ...                       |
+-----------------------------------------------------------+
```

### Screen 4 - History

```text
+-----------------------------------------------------------+
| Filters: DateRange | Carrier | VIN | Claim# | Status      |
|-----------------------------------------------------------|
| # | InvoiceNo | Carrier | Tier | Total | Outcome | Actions|
| 1 | ...       | ...     | Basic| ...   | pending | Open   |
| 2 | ...       | ...     | Normal| ...  | paid    | Duplicate|
+-----------------------------------------------------------+
```

## MVP Exit Criteria

- 3 pilot shops complete invoice generation and export end-to-end
- Parse success rate >= 85% on target estimate formats for pilot dataset
- Median time from upload to draft invoice <= 2 minutes
