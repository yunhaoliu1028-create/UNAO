export type HistoryRow = {
  id: string;
  date: string;
  roVin: string;
  total: number;
  status: "Completed" | "Processing" | "Needs Review";
};

export const recentHistory: HistoryRow[] = [
  { id: "inv-1042", date: "2026-03-24", roVin: "RO 22091 / 1HGCM82633A004352", total: 284.7, status: "Completed" },
  { id: "inv-1041", date: "2026-03-23", roVin: "RO 22078 / 3FA6P0H72HR196321", total: 191.55, status: "Needs Review" },
  { id: "inv-1040", date: "2026-03-22", roVin: "RO 22030 / WAUENAF43JN028911", total: 348.2, status: "Completed" },
  { id: "inv-1039", date: "2026-03-21", roVin: "RO 22024 / 5NPE34AF3FH131907", total: 152.1, status: "Processing" },
  { id: "inv-1038", date: "2026-03-20", roVin: "RO 22006 / 1N4AL3AP7GC224160", total: 226.48, status: "Completed" },
  { id: "inv-1037", date: "2026-03-19", roVin: "RO 21990 / 1G1ZD5ST6JF130204", total: 301.99, status: "Processing" },
  { id: "inv-1036", date: "2026-03-18", roVin: "RO 21971 / JTDKN3DU4A1239841", total: 118.75, status: "Completed" }
];
