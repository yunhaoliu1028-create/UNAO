# 06 - CCC Estimate Operation Parsing Rulebook

## Purpose

This rulebook defines how the backend should parse CCC estimate PDFs into normalized repair operations that can safely drive consumable invoice generation.

Goals:

- maximize precision for operation extraction from CCC estimate PDFs
- avoid duplicate operations and overlap from summary/supplement layouts
- preserve enough provenance to explain why an operation was kept, dropped, or downgraded
- keep LLM usage optional and limited to low-confidence edge cases

Non-goals:

- full estimate pricing reconstruction
- insurer-specific billing policy logic
- replacing OEM repair procedures or vehicle-specific footnotes

## Source Materials

This rulebook is distilled from:

- `assets/info/estimate_additional_info.txt`
- `assets/info/read_ccc_estimate_of_record.pdf`
- `assets/info/ccc_motor_guide.pdf`

Important source takeaways:

- CCC estimate PDFs commonly appear in two major layouts
- operation meaning is primarily derived from `Oper`, `Description`, and `Line Notes`
- `with Summary` layouts can contain duplicate summary content and must be de-overlapped
- MOTOR footnotes and "Add If Required" content are contextual and take precedence when applicable
- symbols such as `#`, `*`, `**`, and `N` materially affect line interpretation

## Core Parsing Principles

1. Parse the estimate top-to-bottom.
2. Treat the estimate as a structured document, not a flat text blob.
3. Extract candidate operations only from estimate line sections, not from totals, disclosures, notes headers, or glossary blocks.
4. Merge meaning across `Oper`, `Description`, `Labor Type`, part indicators, and `Line Notes`.
5. Favor precision over recall when a line is ambiguous and would create invoice noise.
6. Separate operation extraction from invoice generation. The parser should output normalized operations plus confidence and evidence.

## Supported CCC Layouts

### Layout A - Estimate / Final Bill

Typical traits:

- first page usually contains `Estimate` or `Final Bill`
- operation column often uses fully written actions
- common actions include:
  - `Remove/Replace`
  - `Repair`
  - `Remove/Install`
  - `Blend`

Interpretation guidance:

- action words are more explicit
- abbreviations still appear in parts/labor/type columns
- less normalization is needed than in Estimate of Record layouts

### Layout B - Estimate of Record / Preliminary / Supplement

Typical titles:

- `Estimate of Record`
- `Preliminary Estimate`
- `Supplement of Record <n> with Summary`
- `Preliminary Supplement <n> with Summary`

Typical traits:

- more abbreviations in `Oper`
- more dependence on line notes and special symbols
- more separate adjustment rows such as overlap, included, and add-on labor

Interpretation guidance:

- normalize abbreviations before matching
- distinguish estimate lines from headers, summaries, and note sections
- when title contains `with Summary`, read the consolidated estimate only and avoid double counting supplement summary content

## Document Segmentation

The parser should divide the PDF text into these logical regions:

1. Header / administrative details
2. Vehicle details
3. Estimate line detail area
4. Line item notes
5. Estimate notes
6. Subtotals / totals / adjustments / disclosures

Only regions `3` and `4` are primary operation sources.

Rules:

- region `3` provides the base operation candidate
- region `4` modifies, clarifies, or invalidates the base operation
- regions `1`, `2`, `5`, and `6` should not generate repair operations

## Section and Line Classification

Every parsed line should be classified into one of these buckets:

- `group_heading`
- `estimate_line`
- `adjustment_line`
- `included_line`
- `line_note`
- `estimate_note`
- `summary_or_total`
- `other_charge`
- `disclosure_or_glossary`
- `unknown`

### Group Headings

Group headings are structural context, not operations.

Examples:

- body group names
- MOTOR group sequence headings

Use group headings to:

- infer panel or vehicle area
- improve downstream matching
- connect nearby ambiguous lines to a major panel

Do not emit an operation from a heading alone.

### Estimate Lines

An `estimate_line` is a candidate operation row if it has enough of the following:

- line number
- operation token in `Oper`
- part or panel description
- labor hours or labor type

### Adjustment Lines

Treat these as non-base operations by default:

- `Paint Overlap`
- `Labor Overlap`
- threshold add-ons
- betterment
- deductions

These lines may affect pricing context, but should not create consumable-driving repair operations.

### Included Lines

Lines marked `Incl.` indicate labor included in another operation.

Rules:

- do not create a standalone base repair operation from an `Incl.` line
- keep the line as supporting evidence if attached to a nearby base operation
- if an `Incl.` line is the only mention of a procedure, classify it as contextual only

## Abbreviation Normalization

Normalize action and context abbreviations before any matching.

### Operation Abbreviations

| Raw | Canonical |
| --- | --- |
| `Repl` | `Replace` |
| `R&R` | `Replace` |
| `R&I` | `Remove Install` |
| `Rpr` | `Repair` |
| `Refn` / `Ref` | `Refinish` |
| `Blnd` | `Blend` |
| `Subl` | `Sublet` |
| `Sect` | `Section` |
| `O/H` | `Overhaul` |
| `D&R` | `Disconnect Reconnect` |

### Direction and Position

| Raw | Canonical |
| --- | --- |
| `LT` | `Left` |
| `RT` | `Right` |
| `Adj.` | `Adjacent` |
| `Non-Adj.` | `Non Adjacent` |
| `W/O` | `Without` |

### Part and Material Context

| Raw | Canonical |
| --- | --- |
| `A/M` | `Aftermarket` |
| `CAPA` | `CAPA` |
| `LKQ` | `LKQ Used` |
| `NSF` | `NSF Certified` |
| `RECOND` | `Reconditioned` |
| `OEM` | `OEM` |
| `OPT OEM` | `Optional OEM` |
| `ALU` | `Aluminum` |
| `BOR` | `Boron Steel` |
| `HSS` | `High Strength Steel` |
| `HYD` | `Hydroformed Steel` |
| `SAS` | `Sandwiched Steel` |
| `STS` | `Stainless Steel` |
| `UHS` | `Ultra High Strength Steel` |
| `CFC` | `Carbon Fiber` |
| `MAG` | `Magnesium` |

### Labor Type Context

| Raw | Canonical |
| --- | --- |
| `B` | `Body Labor` |
| `D` | `Diagnostic Labor` |
| `E` | `Electrical Labor` |
| `F` | `Frame Labor` |
| `G` | `Glass Labor` |
| `M` | `Mechanical Labor` |
| `P` | `Paint Labor` |
| `S` | `Structural Labor` |
| `T` | `Taxed Miscellaneous` |
| `X` | `Non-Taxed Miscellaneous` |

## Symbol Semantics

| Symbol | Meaning | Parsing Effect |
| --- | --- | --- |
| `#` | manual line entry | reduce trust unless reinforced by notes/context |
| `*` | database line modified by estimator | keep line, mark as modified |
| `**` | aftermarket database line | keep line, mark part source as aftermarket |
| `N` | notes attached to line | fetch linked line notes before final interpretation |
| `D` | discontinued part in MOTOR context | part availability signal, not operation action |
| `A` | approximate price in MOTOR context | pricing signal only |

## Candidate Operation Extraction

A candidate operation should be built from:

- canonical action from `Oper`
- canonical location from `Description`
- optional group heading context
- optional note-based modifier

Recommended extraction formula:

`candidate_operation = canonical_action + canonical_location`

Examples:

- `Rpr LT Qtr Pnl` -> `Repair Left Quarter Panel`
- `Repl RR Dr Shell` -> `Replace Right Rear Door Shell`
- `R&I Frt Bmpr` -> `Remove Install Front Bumper`

## Operation Inclusion Rules

Keep an operation candidate if all conditions below are true:

1. the line is in the estimate line region
2. the line has a valid action token after normalization
3. the line has a repairable/replaceable/installable location or component
4. the line is not solely a header, overlap deduction, subtotal, disclosure, or note wrapper

### Preferred Base Actions

These are normally material-relevant:

- `Replace`
- `Repair`
- `Remove Install`
- `Section`

### Conditional Actions

These need context:

- `Blend`
- `Refinish`
- `Overhaul`
- `Disconnect Reconnect`

Rules:

- `Blend` and `Refinish` should usually not stand alone as consumable-driving repair operations unless your invoice strategy explicitly supports paint-material-only outputs
- `Overhaul` should be treated as contextual unless mapped to a known consumable rule
- `Disconnect Reconnect` should usually not produce a body consumable operation unless joined to a parent repair event

### Exclude by Default

- `Sublet`
- wheel alignment
- towing
- storage
- betterment
- deductible lines
- customer pay / insurance pay summaries
- category subtotal rows
- grand total rows
- estimate notes without line linkage

## Notes-Driven Overrides

`Line Notes` are first-class evidence. A note can override the naive meaning of `Oper`.

### High-Priority Rule

If a line has an `N` indicator or a linked line note, evaluate the note before finalizing the operation.

### Known Semantic Corrections

These examples come directly from shop experience in `estimate_additional_info.txt` and must be encoded as hard rules:

1. If line action is `Rpr` but note contains `drop`, do not interpret the line as normal repair-and-refinish work.
2. If line action is `Rpr` on molding or glass and note contains `rope`, treat it as partial remove/install context, not full repair/refinish.
3. Similar note-driven corrections should downgrade operation confidence or reclassify the line to `partial_ri_context`.

Examples:

- `rpr rocker mldg 0.3 body` + note `drop` -> do not emit `Repair Rocker Molding`
- `rpr qtr glass 0.3 b` + note `rope` -> do not emit `Repair Quarter Glass`
- `rpr w'shield` + note `rope` -> do not emit `Repair Windshield`

Suggested parser behavior:

- mark these as `reclassified_by_note`
- keep raw evidence for audit
- do not feed them into invoice generation as base repair operations

## Summary and Supplement De-Overlap

This is mandatory for layout B.

When the title contains `with Summary`:

- identify the main consolidated estimate section
- identify supplement summary blocks
- emit operations from the consolidated estimate only
- do not re-emit operations from supplement recap lines

Practical rules:

- if the same line number and canonical operation appear in both main body and summary block, keep the main body line only
- if a summary block lacks unique repair detail and only repeats prior totals or recap descriptions, ignore it
- if a supplement adds truly new lines outside the recap, keep only the new lines

## MOTOR Guide Precedence Rules

The merged MOTOR guide introduces important precedence rules:

1. vehicle-specific footnotes take precedence over generic guide language
2. "Add If Required" means conditional, not automatic
3. included/not-included labor assumptions must be respected before deriving downstream operations
4. special notation sections often redefine what labor or material is already accounted for

Implications for the parser:

- do not blindly convert every visible procedure into a standalone operation
- maintain a catalog of known `context_only` procedures from MOTOR
- allow vehicle-specific footnotes to override default assumptions when present

## Operation Confidence Scoring

Each emitted operation should include a confidence score.

Suggested scoring dimensions:

- `+3` valid action token in `Oper`
- `+2` clear panel/component in `Description`
- `+2` consistent group heading context
- `+2` line note supports the action
- `-3` line classified as overlap/included/summary
- `-3` line note downgrades meaning such as `drop` or `rope`
- `-2` manual line `#` with weak context
- `-2` ambiguous component without location

Suggested confidence bands:

- `0-2`: reject or send to manual review
- `3-5`: keep as low confidence, optional LLM review
- `6-9`: accept

## Canonical Output Schema

The parser should emit normalized operation records, not just strings.

```json
{
  "line_ref": "42",
  "raw_oper": "Rpr",
  "raw_description": "LT Qtr Pnl",
  "raw_note": "",
  "canonical_action": "Repair",
  "canonical_location": "Left Quarter Panel",
  "canonical_operation": "Repair Left Quarter Panel",
  "group_heading": "Quarter Panel",
  "labor_type": "Body Labor",
  "part_type_flags": ["OEM"],
  "format_type": "estimate_of_record",
  "line_class": "estimate_line",
  "confidence": 8,
  "decision": "keep",
  "decision_reason": "oper+description+group aligned",
  "source_metadata": {
    "manual_line": false,
    "aftermarket_line": false,
    "has_notes": false,
    "included_flag": false,
    "overlap_flag": false
  }
}
```

## LLM Usage Policy

The backend should not send the whole PDF to the LLM by default.

Use LLM only when:

- confidence is low
- note semantics are unclear
- OCR damage makes the action/location pairing unreliable
- multiple nearby lines conflict

When using LLM:

- send only the suspect line, nearby lines, group heading, and linked note
- send the normalized abbreviation table once as a versioned system prompt
- do not send full guide documents or full estimate text on every request

## Validation Dataset Guidance

Build a regression set with at least these buckets:

- standard `Estimate`
- standard `Final Bill`
- `Estimate of Record`
- `Supplement of Record with Summary`
- `Preliminary Supplement with Summary`
- PDFs with heavy notes usage
- PDFs with overlap and included lines
- PDFs with glass, molding, and rope/drop note edge cases

For each sample, store:

- expected kept operations
- expected dropped lines
- expected note-based reclassifications
- expected unmatched/ambiguous lines

## Minimum Backend Implementation Plan

Implement in separate modules, not inline in route handlers.

Recommended modules:

- `estimate-format-detector`
- `estimate-section-parser`
- `estimate-abbreviation-normalizer`
- `estimate-line-classifier`
- `estimate-note-resolver`
- `estimate-operation-extractor`
- `estimate-confidence-scorer`
- `estimate-llm-reviewer`

Recommended processing order:

1. detect document format
2. segment sections
3. parse line items and line notes
4. normalize abbreviations and symbols
5. classify line types
6. attach notes to owning lines
7. extract candidate operations
8. apply drop/rope and similar overrides
9. de-overlap summary/supplement content
10. score confidence
11. emit canonical operations for invoice generation

## Rulebook Versioning

Persist parser provenance for every extraction run:

- `ruleset_version`
- `abbreviation_map_version`
- `note_override_version`
- `format_detector_version`
- `llm_prompt_version`

This makes future parser improvements auditable and allows back-testing against historical estimate files.

## Initial Hard Rules To Encode First

These should be implemented before any advanced ML or LLM layer:

1. detect format A vs format B
2. normalize core CCC abbreviations
3. ignore headers, subtotals, disclosures, and other-charge summaries
4. treat `Incl.` as contextual, not standalone
5. drop overlap adjustment rows from operation output
6. apply `with Summary` de-overlap
7. attach `Line Notes` by line number
8. downgrade or drop `drop` and `rope` note cases
9. exclude `Sublet` from consumable-driving operations
10. emit confidence + reason for every decision

## Expected Result

If these rules are followed, the backend should:

- extract fewer false-positive operations
- stop over-counting supplement summary lines
- stop turning note-driven partial R/I work into false repair operations
- preserve clearer provenance for invoice generation
- reduce token spend by limiting LLM usage to true edge cases
