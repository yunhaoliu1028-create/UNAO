import { createClient } from "@libsql/client";

const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!remoteUrl?.startsWith("libsql://")) {
  throw new Error("TURSO_DATABASE_URL must be a libsql:// URL.");
}
if (!authToken) {
  throw new Error("TURSO_AUTH_TOKEN is required.");
}

const local = createClient({ url: "file:./dev.db" });
const remote = createClient({ url: remoteUrl, authToken });

const tableNames = [
  "Organization",
  "SavedInvoice",
  "MaterialRule",
  "ClaimOutcome",
  "CustomLogicTemplate",
  "BrandKnowledgeDoc",
  "BrandMaterialNote",
];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

try {
  const schemaRows = await local.execute({
    sql: `SELECT type, name, sql
          FROM sqlite_master
          WHERE type IN ('table', 'index')
            AND name NOT LIKE 'sqlite_%'
            AND name <> '_prisma_migrations'
            AND sql IS NOT NULL
          ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
    args: [],
  });

  for (const row of schemaRows.rows) {
    await remote.execute(String(row.sql).replace(/^CREATE (TABLE|INDEX)/i, "CREATE $1 IF NOT EXISTS"));
  }

  const counts = {};
  for (const tableName of tableNames) {
    const source = await local.execute(`SELECT * FROM ${quoteIdentifier(tableName)}`);
    counts[tableName] = source.rows.length;
    if (source.rows.length === 0) continue;

    const columns = source.columns.map(quoteIdentifier).join(", ");
    const placeholders = source.columns.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${columns}) VALUES (${placeholders})`;

    for (let start = 0; start < source.rows.length; start += 100) {
      const chunk = source.rows.slice(start, start + 100);
      await remote.batch(
        chunk.map((row) => ({
          sql,
          args: source.columns.map((column) => row[column]),
        })),
        "write",
      );
    }
  }

  console.log(JSON.stringify({ migrated: counts }, null, 2));
} finally {
  local.close();
  remote.close();
}
