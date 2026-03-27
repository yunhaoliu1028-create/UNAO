import rules from "@/lib/server/estimate-operation-rules.json";

type ParsedFormat = "layoutA" | "layoutB" | "unknown";

type RuleConfig = {
  version: string;
  formatHints: {
    layoutA: string[];
    layoutB: string[];
    withSummary: string[];
  };
  actionMap: Record<string, string>;
  locationMap: Record<string, string>;
  lineDropContains: string[];
  standaloneDropActions: string[];
  operationKeywords: string[];
  lineNoteOverrideKeywords: {
    downgradeToRemoveInstall: string[];
  };
  lineNoteOverrideTargets: string[];
  includedMarkers: string[];
  confidenceThresholds: {
    keep: number;
    review: number;
  };
};

type Candidate = {
  rawLine: string;
  lineNo: number | null;
  normalizedLine: string;
  action: string;
  location: string;
  canonical: string;
  confidence: number;
  reason: string;
};

export type ParseEstimateOperationsResult = {
  rulesetVersion: string;
  format: ParsedFormat;
  hasSummary: boolean;
  operations: string[];
  lowConfidenceOperations: string[];
  llmContextText: string;
  warnings: string[];
  debugCandidates: Array<{
    lineNo: number | null;
    rawLine: string;
    canonical: string;
    confidence: number;
    reason: string;
    decision: "keep" | "review" | "drop";
  }>;
};

const config = rules as RuleConfig;
const ACTION_STOP_WORDS = new Set([
  "replace",
  "repair",
  "remove",
  "install",
  "refinish",
  "blend",
  "section",
  "overhaul",
  "disconnect",
  "reconnect"
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return normalizeWhitespace(String(value || "").toLowerCase().replace(/[^\x20-\x7e]/g, " "));
}

function normalizeEstimatePayload(value: string): string {
  return normalizeText(value)
    .replace(/\bw\/o\b/g, "without")
    .replace(/\bw\//g, "with ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyTokenMap(value: string, tokenMap: Record<string, string>): string {
  let output = value;
  for (const [from, to] of Object.entries(tokenMap)) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`\\b${escaped}\\b`, "g"), to);
  }
  return output;
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function parseLineNo(rawLine: string): number | null {
  const match = rawLine.match(/^\s*(\d{1,4})\b/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function detectFormat(estimateText: string): { format: ParsedFormat; hasSummary: boolean } {
  const header = normalizeText(estimateText.slice(0, 2400));
  const hasLayoutB = config.formatHints.layoutB.some((item) => header.includes(item));
  const hasLayoutA = config.formatHints.layoutA.some((item) => header.includes(item));
  const hasSummary = config.formatHints.withSummary.some((item) => header.includes(item));
  if (hasLayoutB) {
    return { format: "layoutB", hasSummary };
  }
  if (hasLayoutA) {
    return { format: "layoutA", hasSummary };
  }
  return { format: "unknown", hasSummary };
}

function hasActionToken(line: string): boolean {
  return /\b(replace|repair|remove install|remove|install|refinish|blend|section|overhaul|disconnect reconnect|sublet)\b/.test(
    line
  );
}

function extractAction(line: string): string {
  if (line.includes("remove install")) {
    return "Remove Install";
  }
  if (line.includes("replace")) {
    return "Replace";
  }
  if (line.includes("repair")) {
    return "Repair";
  }
  if (line.includes("section")) {
    return "Section";
  }
  if (line.includes("overhaul")) {
    return "Overhaul";
  }
  if (line.includes("disconnect reconnect")) {
    return "Disconnect Reconnect";
  }
  if (line.includes("refinish")) {
    return "Refinish";
  }
  if (line.includes("blend")) {
    return "Blend";
  }
  if (line.includes("sublet")) {
    return "Sublet";
  }
  return "";
}

function shouldDropLine(normalizedLine: string): boolean {
  if (!normalizedLine) {
    return true;
  }
  if (/\bnote\s*:/.test(normalizedLine)) {
    return true;
  }
  if (/\bdeduct\s+for\b/.test(normalizedLine)) {
    return true;
  }
  if (/\boverlap\s+(minor|major)\b/.test(normalizedLine)) {
    return true;
  }
  if (/\badd\s+for\s+inside\b/.test(normalizedLine)) {
    return true;
  }
  if (config.lineDropContains.some((token) => normalizedLine.includes(token))) {
    return true;
  }
  if (config.includedMarkers.some((token) => normalizedLine.includes(token))) {
    return true;
  }
  return false;
}

function extractLocation(normalizedLine: string): string {
  const withoutPrefix = normalizedLine.replace(/^\s*\d{1,4}\s+/, "");
  const withoutAction = withoutPrefix
    .replace(/\|\s*[a-z]\d{2}\s*\|/g, " ")
    .replace(/\b(remove install|replace|repair|refinish|blend|section|overhaul|disconnect reconnect|sublet)\b/g, " ")
    .replace(
      /\b(line#?\s*\d{1,4}|qty|hours?|hr|body|paint|labor|diag|elec|mech|struc|misc|oem|a\/m|lkq|glass|other)\b/g,
      " "
    )
    .replace(/\b[a-z]\d{2}\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?t?\b/g, " ")
    .replace(/\|/g, " ")
    .replace(/[^\w\s/-]/g, " ");
  const tokens = normalizeWhitespace(withoutAction)
    .split(" ")
    .filter((token) => token.length > 1 && !ACTION_STOP_WORDS.has(token));
  return tokens.slice(0, 8).join(" ");
}

type ParsedTableCells = {
  lineNo: number;
  ver: string;
  operationCell: string;
  descriptionCell: string;
};

function parseTableCells(rawLine: string): ParsedTableCells | null {
  if (!rawLine.includes("|")) {
    return null;
  }
  const cells = rawLine.split("|").map((part) => normalizeWhitespace(part));
  if (cells.length < 4) {
    return null;
  }
  const lineNo = Number.parseInt(cells[0] || "", 10);
  if (!Number.isFinite(lineNo)) {
    return null;
  }
  return {
    lineNo,
    ver: normalizeWhitespace(cells[1] || "").toUpperCase(),
    operationCell: normalizeWhitespace(cells[2] || ""),
    descriptionCell: normalizeWhitespace(cells[3] || "")
  };
}

function operationLooksRelevant(normalizedLine: string, location: string): boolean {
  const hasKeyword = config.operationKeywords.some((keyword) => normalizedLine.includes(keyword) || location.includes(keyword));
  return hasKeyword || /\b(door|panel|bumper|fender|quarter|glass|windshield|rocker|hood|roof)\b/.test(location);
}

function buildCandidate(rawLine: string): Candidate | null {
  const tableCells = parseTableCells(rawLine);
  if (tableCells) {
    const normalizedActionCell = applyTokenMap(normalizeEstimatePayload(tableCells.operationCell), config.actionMap);
    if (!hasActionToken(normalizedActionCell)) {
      return null;
    }
    const action = extractAction(normalizedActionCell);
    if (!action) {
      return null;
    }
    const descNormalized = applyTokenMap(normalizeEstimatePayload(tableCells.descriptionCell), config.locationMap);
    if (shouldDropLine(descNormalized)) {
      return null;
    }
    const locationRaw = extractLocation(descNormalized);
    const location = toTitleCase(locationRaw);
    if (!location || !operationLooksRelevant(descNormalized, locationRaw)) {
      return null;
    }
    const canonical = `${action} ${location}`.replace(/\s+/g, " ").trim();
    let confidence = 0;
    confidence += 3;
    confidence += 3;
    confidence += 1;
    confidence += operationLooksRelevant(descNormalized, locationRaw) ? 2 : 0;
    if (tableCells.ver) {
      confidence += 1;
    }
    if (config.standaloneDropActions.some((item) => action.toLowerCase() === item)) {
      confidence -= 6;
    }
    return {
      rawLine,
      lineNo: tableCells.lineNo,
      normalizedLine: `${normalizedActionCell} ${descNormalized}`.trim(),
      action,
      location,
      canonical,
      confidence,
      reason: "table row action/description parse"
    };
  }

  const lineNo = parseLineNo(rawLine);
  const normalizedBase = normalizeText(rawLine);
  const withActions = applyTokenMap(normalizedBase, config.actionMap);
  const normalizedLine = applyTokenMap(withActions, config.locationMap);
  if (shouldDropLine(normalizedLine) || !hasActionToken(normalizedLine)) {
    return null;
  }
  const action = extractAction(normalizedLine);
  if (!action) {
    return null;
  }
  const locationRaw = extractLocation(normalizedLine);
  const location = toTitleCase(locationRaw);
  if (!location || !operationLooksRelevant(normalizedLine, locationRaw)) {
    return null;
  }
  const canonical = `${action} ${location}`.replace(/\s+/g, " ").trim();
  let confidence = 0;
  confidence += action ? 3 : 0;
  confidence += location ? 2 : 0;
  confidence += lineNo !== null ? 1 : 0;
  confidence += operationLooksRelevant(normalizedLine, locationRaw) ? 2 : 0;
  if (config.standaloneDropActions.some((item) => action.toLowerCase() === item)) {
    confidence -= 6;
  }
  return {
    rawLine,
    lineNo,
    normalizedLine,
    action,
    location,
    canonical,
    confidence,
    reason: "line action/location parse"
  };
}

function buildLineNotes(lines: string[]): Map<number, string> {
  const notes = new Map<number, string>();
  for (const line of lines) {
    const normalized = normalizeText(line);
    const lineNo = parseLineNo(line);
    if (lineNo === null) {
      continue;
    }
    if (hasActionToken(applyTokenMap(applyTokenMap(normalized, config.actionMap), config.locationMap))) {
      continue;
    }
    const notePayload = normalizeWhitespace(normalized.replace(/^\s*\d{1,4}\s+/, ""));
    if (notePayload.length < 4) {
      continue;
    }
    notes.set(lineNo, `${notes.get(lineNo) || ""} ${notePayload}`.trim());
  }
  return notes;
}

function applyNoteOverride(candidate: Candidate, notesByLine: Map<number, string>): Candidate {
  if (candidate.lineNo === null) {
    return candidate;
  }
  const note = normalizeText(notesByLine.get(candidate.lineNo) || "");
  if (!note) {
    return candidate;
  }
  const hasDowngradeKeyword = config.lineNoteOverrideKeywords.downgradeToRemoveInstall.some((token) => note.includes(token));
  const hitsTarget = config.lineNoteOverrideTargets.some(
    (target) => candidate.normalizedLine.includes(target) || candidate.canonical.toLowerCase().includes(target)
  );
  if (hasDowngradeKeyword && hitsTarget && candidate.action.toLowerCase() === "repair") {
    return {
      ...candidate,
      action: "Remove Install",
      canonical: `Remove Install ${candidate.location}`.trim(),
      confidence: candidate.confidence - 2,
      reason: `note override (${note})`
    };
  }
  return candidate;
}

function uniqueCanonical(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>();
  for (const item of candidates) {
    const key = item.canonical.toLowerCase();
    const existing = map.get(key);
    if (!existing || item.confidence > existing.confidence) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function applySummaryDedupe(candidates: Candidate[], hasSummary: boolean): Candidate[] {
  if (!hasSummary) {
    return candidates;
  }
  return candidates.filter((item) => !/\bsummary\b/.test(item.normalizedLine));
}

export function parseEstimateOperationsWithRules(input: {
  estimateText: string;
  localOperations?: string[];
}): ParseEstimateOperationsResult {
  const estimateText = String(input.estimateText || "");
  const lines = estimateText.split(/\r?\n/).map((line) => normalizeWhitespace(line));
  const { format, hasSummary } = detectFormat(estimateText);
  const warnings: string[] = [];
  const notesByLine = buildLineNotes(lines);

  const rawCandidates: Candidate[] = [];
  for (const line of lines) {
    const candidate = buildCandidate(line);
    if (candidate) {
      rawCandidates.push(applyNoteOverride(candidate, notesByLine));
    }
  }

  const deduped = uniqueCanonical(applySummaryDedupe(rawCandidates, hasSummary));
  const operations: string[] = [];
  const lowConfidenceOperations: string[] = [];
  const llmContextRows: string[] = [];
  const debugCandidates: ParseEstimateOperationsResult["debugCandidates"] = [];
  for (const item of deduped) {
    if (item.confidence >= config.confidenceThresholds.keep) {
      operations.push(item.canonical);
      debugCandidates.push({
        lineNo: item.lineNo,
        rawLine: item.rawLine,
        canonical: item.canonical,
        confidence: item.confidence,
        reason: item.reason,
        decision: "keep"
      });
      continue;
    }
    if (item.confidence >= config.confidenceThresholds.review) {
      lowConfidenceOperations.push(item.canonical);
      llmContextRows.push(
        `${item.lineNo ?? "?"} | ${item.rawLine} | canonical=${item.canonical} | confidence=${item.confidence} | reason=${item.reason}`
      );
      debugCandidates.push({
        lineNo: item.lineNo,
        rawLine: item.rawLine,
        canonical: item.canonical,
        confidence: item.confidence,
        reason: item.reason,
        decision: "review"
      });
      continue;
    }
    warnings.push(`Dropped low-confidence line: ${item.rawLine}`);
    debugCandidates.push({
      lineNo: item.lineNo,
      rawLine: item.rawLine,
      canonical: item.canonical,
      confidence: item.confidence,
      reason: item.reason,
      decision: "drop"
    });
  }

  // Safety net for OCR-heavy documents.
  if (operations.length === 0 && Array.isArray(input.localOperations) && input.localOperations.length > 0) {
    operations.push(...input.localOperations.slice(0, 20));
    warnings.push("Parser emitted no confident operations, fell back to localOperations.");
  }

  return {
    rulesetVersion: config.version,
    format,
    hasSummary,
    operations: Array.from(new Set(operations)).slice(0, 30),
    lowConfidenceOperations: Array.from(new Set(lowConfidenceOperations)).slice(0, 20),
    llmContextText: llmContextRows.slice(0, 30).join("\n"),
    warnings,
    debugCandidates: debugCandidates.slice(0, 120)
  };
}
