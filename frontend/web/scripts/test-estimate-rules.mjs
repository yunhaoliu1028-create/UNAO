import { readFile } from "node:fs/promises";
import path from "node:path";

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function toSet(items) {
  return new Set((items || []).map((item) => normalizeText(item)).filter(Boolean));
}

function includesAny(haystackItems, needles) {
  const haystack = haystackItems.map((item) => normalizeText(item));
  return (needles || []).every((needle) => {
    const n = normalizeText(needle);
    return haystack.some((item) => item.includes(n));
  });
}

function excludesAll(haystackItems, needles) {
  const haystack = haystackItems.map((item) => normalizeText(item));
  return (needles || []).every((needle) => {
    const n = normalizeText(needle);
    return !haystack.some((item) => item.includes(n));
  });
}

async function run() {
  const root = process.cwd();
  const casesPath = path.resolve(root, "..", "..", "assets", "info", "estimate-rule-test-cases.json");
  const apiBase = process.env.TEST_API_BASE_URL || "http://localhost:3000";
  const requestTimeoutMs = Number(process.env.TEST_API_TIMEOUT_MS || "20000");
  const testFile = JSON.parse(await readFile(casesPath, "utf-8"));
  const cases = Array.isArray(testFile.cases) ? testFile.cases : [];
  if (cases.length === 0) {
    console.log("No test cases found.");
    process.exit(1);
  }

  const results = [];
  for (const item of cases) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
    let body;
    try {
      const response = await fetch(`${apiBase}/v1/estimates/analyze?debug=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          estimateText: item.input_text,
          localOperations: []
        }),
        signal: controller.signal
      });
      body = await response.json();
    } catch (error) {
      const message =
        error && typeof error === "object" && "name" in error && error.name === "AbortError"
          ? `Request timeout after ${requestTimeoutMs}ms.`
          : String(error);
      results.push({
        id: item.id,
        pass: false,
        keepPass: false,
        reviewPass: false,
        dropPass: false,
        operationCount: 0,
        source: "error",
        error: message
      });
      clearTimeout(timeoutId);
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
    const operations = Array.isArray(body.operations) ? body.operations : [];
    const expectedKeep = toSet(item.expected_keep_operations);
    const expectedReview = toSet(item.expected_review_operations);
    const expectedDropContains = item.expected_drop_contains || [];
    const debugCandidates = body?.parse_debug?.candidates || [];
    const keepOps = debugCandidates.filter((c) => c.decision === "keep").map((c) => c.canonical || "");
    const reviewOps = debugCandidates.filter((c) => c.decision === "review").map((c) => c.canonical || "");
    const actualKeep = toSet(keepOps);
    const actualReview = toSet(reviewOps);
    const nonDroppedText = debugCandidates
      .filter((c) => c.decision !== "drop")
      .map((c) => `${c.canonical || ""} ${c.rawLine || ""}`);

    const keepPass = [...expectedKeep].every((op) => actualKeep.has(op));
    const reviewPass = [...expectedReview].every((op) => actualReview.has(op));
    const dropPass = excludesAll(nonDroppedText, expectedDropContains);
    const pass = keepPass && reviewPass && dropPass;

    results.push({
      id: item.id,
      pass,
      keepPass,
      reviewPass,
      dropPass,
      operationCount: operations.length,
      source: body.source || "unknown",
      error: null
    });
  }

  const failed = results.filter((r) => !r.pass);
  console.table(results);
  if (failed.length > 0) {
    console.error(`Rule regression failed: ${failed.length}/${results.length} cases.`);
    process.exit(1);
  }
  console.log(`Rule regression passed: ${results.length}/${results.length} cases.`);
}

run().catch((error) => {
  console.error("Rule regression execution failed:", error);
  process.exit(1);
});
