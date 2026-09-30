import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type ExtractResult = {
  plainText: string;
  tableText: string;
  firstPagePlainText: string;
  firstPageTableText: string;
  source: "server";
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "file is required." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const tempDir = await mkdtemp(join(tmpdir(), "unao-pdf-"));
    const tempPdfPath = join(tempDir, "upload.pdf");

    try {
      await writeFile(tempPdfPath, new Uint8Array(arrayBuffer));

      const nodeScript = `
(async () => {
  const fs = require("node:fs");
  const pdfPath = process.argv[1];
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const normalizePdfToken = (text) => String(text || "").replace(/\\s+/g, " ").trim();
  const groupItemsByVisualLine = (items) => {
    const sorted = [...items].sort((a, b) => {
      const dy = Math.abs(a.y - b.y);
      if (dy > 1.8) return b.y - a.y;
      return a.x - b.x;
    });
    const rows = [];
    for (const item of sorted) {
      const current = rows[rows.length - 1];
      if (!current) {
        rows.push([item]);
        continue;
      }
      const anchorY = current[0]?.y ?? item.y;
      if (Math.abs(anchorY - item.y) <= 1.8) current.push(item);
      else rows.push([item]);
    }
    return rows.map((row) => row.sort((a, b) => a.x - b.x));
  };
  const rowToColumns = (row) => {
    if (row.length === 0) return [];
    const columns = [];
    let current = normalizePdfToken(row[0]?.text || "");
    let prevX = row[0]?.x ?? 0;
    for (let i = 1; i < row.length; i += 1) {
      const token = normalizePdfToken(row[i]?.text || "");
      if (!token) continue;
      const x = row[i]?.x ?? prevX;
      const gap = x - prevX;
      if (gap > 18) {
        if (current) columns.push(current);
        current = token;
      } else {
        current = current ? \`\${current} \${token}\` : token;
      }
      prevX = x;
    }
    if (current) columns.push(current);
    return columns;
  };
  const buildTableAwarePageText = (items) => {
    const rows = groupItemsByVisualLine(items);
    const lines = rows
      .map((row) => rowToColumns(row))
      .filter((cells) => cells.length > 0)
      .map((cells) => cells.join(" | "));
    return lines.join("\\n");
  };
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const plainPages = [];
  const tablePages = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const textItems = content.items
      .map((item) => {
        if (!item || typeof item.str !== "string" || !Array.isArray(item.transform)) return null;
        const text = normalizePdfToken(item.str);
        if (!text) return null;
        return { text, x: Number(item.transform[4] || 0), y: Number(item.transform[5] || 0) };
      })
      .filter(Boolean);
    const plain = textItems.map((item) => item.text).join(" ");
    const table = buildTableAwarePageText(textItems);
    plainPages.push(plain);
    tablePages.push(table);
  }
  const out = {
    plainText: plainPages.join("\\n"),
    tableText: tablePages.join("\\n\\n"),
    firstPagePlainText: plainPages[0] || "",
    firstPageTableText: tablePages[0] || "",
    source: "server"
  };
  process.stdout.write(JSON.stringify(out));
})().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
      `.trim();

      const { stdout, stderr } = await execFileAsync(process.execPath, ["-e", nodeScript, tempPdfPath], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });

      if (stderr && stderr.trim()) {
        throw new Error(stderr.trim());
      }

      const result = JSON.parse(stdout) as ExtractResult;
      return NextResponse.json(result);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (error) {
    return NextResponse.json(
      { code: "EXTRACT_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
