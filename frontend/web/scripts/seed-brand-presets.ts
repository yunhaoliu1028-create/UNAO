/**
 * Seed brand-specific material presets (Layer 2) into the MaterialRule table.
 *
 * These presets override CSV-seed defaults for vehicles that need different
 * consumable materials — primarily aluminum-body vehicles (no weld-thru
 * coating, more structural adhesive) and heavy-duty trucks (higher quantities).
 *
 * Usage: npx tsx scripts/seed-brand-presets.ts
 */

import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "node:path";

const dbUrl = process.env.DATABASE_URL || `file:${path.resolve(process.cwd(), "dev.db")}`;
const adapter = new PrismaLibSql({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

// ── Material catalog (part# → info) ──────────────────────────────────
// Prices from material_info.csv (already seeded). We reference them here
// so presets have correct pricing without needing the CSV at runtime.
const PARTS = {
  "3M 8115": { desc: "3M Panel Bonding Adhesive, 200 mL Cartridge", unit: "Cartridge(s)", price: 122.01 },
  "3M 8116": { desc: "3M Panel Bonding Adhesive, 400 mL Cartridge", unit: "Cartridge(s)", price: 173.48 },
  "3M 5887": { desc: "3M EZ Sand Multi-Purpose Repair Material, 200 mL", unit: "Cartridge(s)", price: 116.03 },
  "3M 8852": { desc: "3M Cavity Wax Plus, 18 oz", unit: "Can(s)", price: 58.21 },
  "3M 8360": { desc: "3M Urethane Seam Sealer - White, 310 mL", unit: "Sachet(s)", price: 53.46 },
  "3M 8307": { desc: "3M Self-Leveling Seam Sealer, 200 mL", unit: "Cartridge(s)", price: 90.67 },
  "3M 5917": { desc: "3M Weld-Thru Coating II, 12.75 oz", unit: "Can(s)", price: 78.17 },
  "3M 8883": { desc: "3M Rubberized Undercoating, 19.7 oz", unit: "Can(s)", price: 40.17 },
  "3M 4274": { desc: "3M NVH Dampening Material, 200 mL", unit: "Cartridge(s)", price: 118.76 },
  "3M 8889": { desc: "3M Rocker Panel Coating - Grey, 23 oz", unit: "Can(s)", price: 102.67 },
  "3M 38527": { desc: "3M Aluminum Repair & Straightening Compound", unit: "Cartridge(s)", price: 89.50 },
} as const;

type PartKey = keyof typeof PARTS;

type PresetLine = {
  partNo: PartKey;
  qty: number;
};

type PresetDef = {
  location: string;
  operation: string;
  lines: PresetLine[];
};

// ── Aluminum-body presets ─────────────────────────────────────────────
// Key differences from steel:
// - NO weld-thru coating (3M 5917) — aluminum panels are bonded/riveted
// - MORE panel bonding adhesive (3M 8115/8116)
// - Structural repair material still used

const ALUMINUM_PRESETS: PresetDef[] = [
  {
    location: "hood",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.5 },
      { partNo: "3M 8115", qty: 0.5 },   // bonding adhesive — aluminum hoods bonded not welded
      { partNo: "3M 8360", qty: 0.3 },   // seam sealer
    ],
  },
  {
    location: "fender",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.15 },
      { partNo: "3M 8115", qty: 0.3 },
    ],
  },
  {
    location: "door shell",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.4 },
      { partNo: "3M 8115", qty: 0.5 },
      { partNo: "3M 5887", qty: 0.4 },
      { partNo: "3M 8360", qty: 0.3 },
    ],
  },
  {
    location: "door skin",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.4 },
      { partNo: "3M 8115", qty: 0.8 },   // aluminum door skins use more adhesive
      { partNo: "3M 5887", qty: 0.4 },
      { partNo: "3M 8360", qty: 0.5 },
    ],
  },
  {
    location: "quarter panel",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.5 },
      { partNo: "3M 8115", qty: 1.5 },   // large panel = more adhesive
      { partNo: "3M 8360", qty: 1.0 },
      { partNo: "3M 4274", qty: 0.5 },
    ],
  },
  {
    location: "trunk",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.4 },
      { partNo: "3M 8115", qty: 0.5 },
      { partNo: "3M 5887", qty: 0.4 },
    ],
  },
  {
    location: "liftgate",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.5 },
      { partNo: "3M 8115", qty: 0.6 },
      { partNo: "3M 5887", qty: 0.6 },
    ],
  },
  {
    location: "roof",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 2.0 },
      { partNo: "3M 8115", qty: 2.0 },   // roof replacement: heavy bonding
      { partNo: "3M 8307", qty: 3.0 },
    ],
  },
  {
    location: "rocker panel",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.8 },
      { partNo: "3M 8115", qty: 1.0 },
      { partNo: "3M 8360", qty: 0.5 },
      { partNo: "3M 8889", qty: 0.25 },
    ],
  },
  {
    location: "rear body panel",
    operation: "replace",
    lines: [
      { partNo: "3M 8852", qty: 0.4 },
      { partNo: "3M 8115", qty: 0.8 },
      { partNo: "3M 8360", qty: 0.5 },
      { partNo: "3M 4274", qty: 0.3 },
    ],
  },
  // Repair operations (aluminum)
  {
    location: "hood",
    operation: "repair",
    lines: [
      { partNo: "3M 8852", qty: 0.5 },
      { partNo: "3M 5887", qty: 0.3 },
    ],
  },
  {
    location: "fender",
    operation: "repair",
    lines: [
      { partNo: "3M 8852", qty: 0.1 },
      { partNo: "3M 5887", qty: 0.2 },
    ],
  },
  {
    location: "quarter panel",
    operation: "repair",
    lines: [
      { partNo: "3M 8852", qty: 0.2 },
      { partNo: "3M 5887", qty: 0.3 },
    ],
  },
];

// ── Vehicle groups that get aluminum presets ──────────────────────────
type VehicleGroup = {
  make: string;
  models?: string[];       // null = all models for this make
  yearFrom?: number;
  yearTo?: number;
};

const ALUMINUM_VEHICLES: VehicleGroup[] = [
  // Tesla — all models, all years (aluminum/steel mix, primarily aluminum panels)
  { make: "tesla" },
  // BMW — i-series electric + some traditional models
  { make: "bmw", models: ["i3", "i4", "i5", "i7", "i8", "ix"] },
  // Audi — high-end aluminum
  { make: "audi", models: ["a8", "e-tron", "q8 e-tron", "r8"] },
  // Ford F-150 — aluminum body from 2015+
  { make: "ford", models: ["f150", "f-150"], yearFrom: 2015 },
  // Jaguar — aluminum architecture
  { make: "jaguar", models: ["xe", "xf", "f-type", "f-pace", "i-pace"] },
  // Land Rover / Range Rover — aluminum unibody
  { make: "land rover", models: ["range rover", "range rover sport", "defender"] },
  // Rivian — all aluminum/composite
  { make: "rivian" },
  // Lucid — aluminum
  { make: "lucid" },
  // Mercedes EQ line
  { make: "mercedes-benz", models: ["eqs", "eqe", "eqb", "eqa", "eqs suv", "eqe suv"] },
  // Porsche Taycan
  { make: "porsche", models: ["taycan"] },
];

// ── Heavy-duty truck presets ─────────────────────────────────────────
// Higher quantities for larger panels
const HD_TRUCK_QTY_MULTIPLIER = 1.4;

const HD_TRUCK_VEHICLES: VehicleGroup[] = [
  { make: "ford", models: ["f250", "f-250", "f350", "f-350", "f450", "f-450", "super duty"] },
  { make: "chevrolet", models: ["silverado 2500", "silverado 3500", "silverado hd"] },
  { make: "gmc", models: ["sierra 2500", "sierra 3500", "sierra hd"] },
  { make: "ram", models: ["2500", "3500"] },
];

// ── Seed logic ───────────────────────────────────────────────────────

async function clearBrandPresets(): Promise<number> {
  const result = await prisma.materialRule.deleteMany({
    where: { source: "brand_preset" },
  });
  return result.count;
}

async function seedAluminumPresets(): Promise<number> {
  let count = 0;

  for (const vehicle of ALUMINUM_VEHICLES) {
    const models = vehicle.models || [null]; // null = all models

    for (const model of models) {
      for (const preset of ALUMINUM_PRESETS) {
        for (const line of preset.lines) {
          const partInfo = PARTS[line.partNo];
          await prisma.materialRule.create({
            data: {
              location: preset.location,
              operation: preset.operation,
              make: vehicle.make,
              model: model,
              yearFrom: vehicle.yearFrom ?? null,
              yearTo: vehicle.yearTo ?? null,
              bodyMaterial: "aluminum",
              productPartNo: line.partNo,
              description: partInfo.desc,
              qty: line.qty,
              unit: partInfo.unit,
              unitPrice: partInfo.price,
              source: "brand_preset",
            },
          });
          count++;
        }
      }
    }
  }

  return count;
}

async function seedHDTruckPresets(): Promise<number> {
  // For HD trucks, we take the CSV seed baseline and multiply quantities.
  // First get existing csv_seed rules.
  const csvRules = await prisma.materialRule.findMany({
    where: { source: "csv_seed" },
  });

  let count = 0;

  for (const vehicle of HD_TRUCK_VEHICLES) {
    const models = vehicle.models || [null];

    for (const model of models) {
      for (const csvRule of csvRules) {
        await prisma.materialRule.create({
          data: {
            location: csvRule.location,
            operation: csvRule.operation,
            make: vehicle.make,
            model: model,
            yearFrom: vehicle.yearFrom ?? null,
            yearTo: vehicle.yearTo ?? null,
            bodyMaterial: null,
            productPartNo: csvRule.productPartNo,
            description: csvRule.description,
            qty: Number((csvRule.qty * HD_TRUCK_QTY_MULTIPLIER).toFixed(3)),
            unit: csvRule.unit,
            unitPrice: csvRule.unitPrice,
            source: "brand_preset",
          },
        });
        count++;
      }
    }
  }

  return count;
}

async function main() {
  console.log("Seeding brand preset rules (Layer 2)...\n");

  // Clear existing brand presets
  const cleared = await clearBrandPresets();
  console.log(`Cleared ${cleared} existing brand_preset rules.`);

  // Seed aluminum presets
  const aluminumCount = await seedAluminumPresets();
  console.log(`Seeded ${aluminumCount} aluminum-body preset rules.`);

  // Seed HD truck presets
  const hdCount = await seedHDTruckPresets();
  console.log(`Seeded ${hdCount} heavy-duty truck preset rules.`);

  console.log(`\nTotal brand_preset rules: ${aluminumCount + hdCount}`);

  // Verify
  const total = await prisma.materialRule.count({ where: { source: "brand_preset" } });
  console.log(`Verified in DB: ${total} brand_preset rules.`);

  // Show summary by make
  const byMake = await prisma.materialRule.groupBy({
    by: ["make"],
    where: { source: "brand_preset" },
    _count: true,
  });
  console.log("\nRules by make:");
  for (const row of byMake.sort((a, b) => (b._count ?? 0) - (a._count ?? 0))) {
    console.log(`  ${row.make || "universal"}: ${row._count} rules`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Error seeding brand presets:", err);
  process.exit(1);
});
