/**
 * Seed script — imports material_logic.csv + material_info.csv into the
 * MaterialRule table (source="csv_seed").
 *
 * Usage:  npx tsx scripts/seed-material-rules.ts
 */

import { parse } from "csv-parse/sync";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// ── Prisma client ───────────────────────────────────────────────────
// dev.db is at project root (frontend/web/dev.db) per .env DATABASE_URL="file:./dev.db"
const dbPath = path.resolve(process.cwd(), "dev.db");
const adapter = new PrismaLibSql({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

// ── Helpers ─────────────────────────────────────────────────────────
function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizePartNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toLowerCase();
}

function normalizeHeader(h: string): string {
  return h.replace(/[\r\n]+/g, " ").trim();
}

// ── Load material_info.csv for pricing ──────────────────────────────
interface MaterialInfoRow {
  partNumberKey: string;
  containerCost: number | null;
  removeBy: string | null;
  piecesPerContainer: number | null;
  description: string;
  invoiceUnit: string | null;
  packageType: string | null;
}

function loadMaterialInfo(): Map<string, MaterialInfoRow> {
  // Assets are at unao/assets/ — 2 levels up from frontend/web/
  const csvPath = path.resolve(process.cwd(), "..", "..", "assets", "material_info.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn(`[WARN] material_info.csv not found at ${csvPath}, prices will be 0`);
    return new Map();
  }
  const content = fs.readFileSync(csvPath, "utf-8");
  const records = parse(content, {
    columns: (headers: string[]) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
  }) as Array<Record<string, string>>;

  const map = new Map<string, MaterialInfoRow>();
  for (const row of records) {
    const rawPart = normalizeWhitespace(row["Part Number"] || "");
    const key = normalizePartNumber(rawPart);
    if (!key) continue;
    if (map.has(key)) continue;

    const cost = row["Container Cost"] ? parseFloat(row["Container Cost"]) : null;
    const pieces = row["Pieces Per Container"] ? parseFloat(row["Pieces Per Container"]) : null;

    map.set(key, {
      partNumberKey: key,
      containerCost: cost !== null && isFinite(cost) ? cost : null,
      removeBy: normalizeWhitespace(row["Remove By"] || "") || null,
      piecesPerContainer: pieces !== null && isFinite(pieces) ? pieces : null,
      description: normalizeWhitespace(row["Description"] || ""),
      invoiceUnit: normalizeWhitespace(row["Invoice Unit"] || "") || null,
      packageType: normalizeWhitespace(row["Size"] || "") || null,
    });
  }
  console.log(`  Loaded ${map.size} material info entries`);
  return map;
}

function calcUnitPrice(info: MaterialInfoRow | undefined): number {
  if (!info || info.containerCost === null) return 0;
  const removeBy = (info.removeBy || "").toLowerCase();
  if (removeBy === "percent") return info.containerCost;
  const pieces = info.piecesPerContainer && info.piecesPerContainer > 0 ? info.piecesPerContainer : 1;
  return info.containerCost / pieces;
}

// ── Parse logic lines ───────────────────────────────────────────────
interface ParsedLine {
  partNumber: string | null;
  description: string;
  qty: number;
  unit: string;
}

function parseLogicLine(line: string): ParsedLine | null {
  const raw = normalizeWhitespace(line);
  if (!raw) return null;

  // Remove price notes like ($XX.XX/each)
  const withoutPrice = normalizeWhitespace(raw.replace(/\(\s*\$[^)]*\)/g, ""));

  // Extract part number (3m + digits)
  const partMatch = withoutPrice.match(/\b3m\s*([0-9]{3,6})\b/i);
  const partNumber = partMatch ? normalizePartNumber(partMatch[1]) : null;

  // Remove part token to parse qty/unit
  const withoutPart = normalizeWhitespace(withoutPrice.replace(/\b3m\s*[0-9]{3,6}\b/gi, ""));
  const qtyMatches = Array.from(withoutPart.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s+([A-Za-z]+(?:\([^)]+\))?)(?=\s|$)/g));
  const last = qtyMatches.length > 0 ? qtyMatches[qtyMatches.length - 1] : null;
  const qty = last ? parseFloat(last[1]) : 1;
  const unit = last ? last[2] : "Each";

  return {
    partNumber,
    description: withoutPrice,
    qty: isFinite(qty) ? qty : 1,
    unit: normalizeWhitespace(unit || "Each"),
  };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Seeding MaterialRule table from CSV ===\n");

  const materialInfo = loadMaterialInfo();

  // Load material_logic.csv
  const logicPath = path.resolve(process.cwd(), "..", "..", "assets", "material_logic.csv");
  if (!fs.existsSync(logicPath)) {
    console.error(`material_logic.csv not found at ${logicPath}`);
    process.exit(1);
  }
  const logicContent = fs.readFileSync(logicPath, "utf-8");
  const logicRecords = parse(logicContent, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
  }) as Array<Record<string, string>>;

  console.log(`  Loaded ${logicRecords.length} logic rows\n`);

  // Clear existing csv_seed rules
  const deleted = await prisma.materialRule.deleteMany({ where: { source: "csv_seed" } });
  console.log(`  Cleared ${deleted.count} existing csv_seed rules\n`);

  let created = 0;
  let skipped = 0;

  for (const row of logicRecords) {
    const location = normalizeWhitespace(row.LOCATION || "").toLowerCase();
    const operation = normalizeWhitespace(row.OPERATION || "").toLowerCase();
    if (!location || !operation) {
      skipped++;
      continue;
    }

    // Process each tier (T1, T2, T3) — resolve "SAME" references
    const t1raw = row.T1 || "";
    const t2raw = normalizeWhitespace(row.T2 || "").toUpperCase() === "SAME" ? t1raw : (row.T2 || "");
    const t3raw = normalizeWhitespace(row.T3 || "").toUpperCase() === "SAME" ? t2raw : (row.T3 || "");

    // We seed all tiers as universal rules. The tier info can be used later for
    // different insurance tiers, but for now we seed T1 (most basic) as the default.
    // To avoid duplicates across tiers, we only seed unique lines from the combined set.
    const seenParts = new Set<string>();
    const allTierLines = t1raw.split("\n");

    for (const rawLine of allTierLines) {
      const parsed = parseLogicLine(rawLine);
      if (!parsed) continue;

      const partNo = parsed.partNumber ? `3M ${parsed.partNumber}` : parsed.description.slice(0, 30);
      const partKey = partNo.toLowerCase();
      if (seenParts.has(partKey)) continue;
      seenParts.add(partKey);

      // material_info.csv uses leading-zero part numbers (08115) while logic uses 8115
      let info = parsed.partNumber ? materialInfo.get(parsed.partNumber) : undefined;
      if (!info && parsed.partNumber) {
        info = materialInfo.get("0" + parsed.partNumber);
      }
      const unitPrice = calcUnitPrice(info);

      await prisma.materialRule.create({
        data: {
          location,
          operation,
          make: null,
          model: null,
          yearFrom: null,
          yearTo: null,
          bodyMaterial: null,
          productPartNo: partNo,
          description: info?.description || parsed.description,
          qty: parsed.qty,
          unit: parsed.unit,
          unitPrice,
          source: "csv_seed",
          orgId: null,
        },
      });
      created++;
    }
  }

  console.log(`  Created ${created} csv_seed rules (skipped ${skipped} empty rows)`);
  console.log("\n=== Seed complete ===");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
