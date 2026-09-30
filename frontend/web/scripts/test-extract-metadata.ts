/**
 * Smoke test for extractMetadata and parseVehicleFromYMM.
 * Usage: npx tsx scripts/test-extract-metadata.ts
 */
import { extractMetadata, parseVehicleFromYMM } from "../lib/invoice";

const tests = [
  // CCC ONE structured fields
  { input: "Year: 2008\nMake: HOND\nModel: ACCORD EX\nColor: GOLD", expected: "2008 HONDA ACCORD EX" },
  // CCC ONE inline header
  { input: "Vehicle: 2022 HOND CIVIC 4D SED 2.0L-FI SILVER", expected: "2022 HONDA CIVIC" },
  // CCC ONE with TOYO
  { input: "Year: 2019\nMake: TOYO\nModel: RAV4 XLE", expected: "2019 TOYOTA RAV4 XLE" },
  // Full brand name (non-CCC) — trim level "SE" may be dropped at double-space boundary
  { input: "2023 TOYOTA CAMRY SE  VIN: 123456789012345", expected: "2023 TOYOTA CAMRY" },
  // CCC abbreviated CHEV
  { input: "Year: 2021\nMake: CHEV\nModel: SILVERADO 1500", expected: "2021 CHEVROLET SILVERADO 1500" },
  // BMW (3-letter make)
  { input: "Year: 2020\nMake: BMW\nModel: X5", expected: "2020 BMW X5" },
  // Tesla
  { input: "Year: 2024\nMake: TESL\nModel: MODEL Y", expected: "2024 TESLA MODEL Y" },
  // Generic inline
  { input: "RO 1234\n2022 HONDA CIVIC\nInsurance: State Farm", expected: "2022 HONDA CIVIC" },
  // Nissan abbreviated
  { input: "Year: 2018\nMake: NISS\nModel: ALTIMA SV", expected: "2018 NISSAN ALTIMA SV" },
  // Ford (already short)
  { input: "Vehicle: 2023 FORD F150 CREW 4WD 3.5L-FI BLUE", expected: "2023 FORD F150" },
  // Subaru
  { input: "Year: 2022\nMake: SUBA\nModel: OUTBACK", expected: "2022 SUBARU OUTBACK" },
  // Hyundai
  { input: "Year: 2021\nMake: HYUN\nModel: TUCSON", expected: "2021 HYUNDAI TUCSON" },
];

let pass = 0;
let fail = 0;

for (const t of tests) {
  const result = extractMetadata(t.input);
  const ok = result.yearMakeModel === t.expected;
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: expected "${t.expected}" got "${result.yearMakeModel}"`);
    console.log(`  input: ${t.input.substring(0, 60).replace(/\n/g, "\\n")}`);
  }
}
console.log(`\nextractMetadata: ${pass}/${pass + fail} passed`);

// Test parseVehicleFromYMM
const vTests = [
  { input: "2022 HONDA CIVIC", expected: { year: 2022, make: "HONDA", model: "CIVIC" } },
  { input: "2019 TOYO RAV4", expected: { year: 2019, make: "TOYOTA", model: "RAV4" } },
  { input: "2008 HOND ACCORD EX", expected: { year: 2008, make: "HONDA", model: "ACCORD EX" } },
  { input: "HONDA CIVIC", expected: { make: "HONDA", model: "CIVIC" } },
  { input: "2021 CHEVROLET SILVERADO 1500", expected: { year: 2021, make: "CHEVROLET", model: "SILVERADO 1500" } },
];

let vpass = 0;
for (const t of vTests) {
  const r = parseVehicleFromYMM(t.input);
  const ok =
    r.make === t.expected.make &&
    r.model === t.expected.model &&
    (r.year || undefined) === ((t.expected as { year?: number }).year || undefined);
  if (ok) {
    vpass++;
  } else {
    console.log(`FAIL parseVehicleFromYMM: input="${t.input}" expected=${JSON.stringify(t.expected)} got=${JSON.stringify(r)}`);
  }
}
console.log(`parseVehicleFromYMM: ${vpass}/${vTests.length} passed`);

if (fail > 0) process.exit(1);
