import { PDFParse } from "pdf-parse";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ExtractResult = {
  plainText: string;
  tableText: string;
  firstPagePlainText: string;
  firstPageTableText: string;
  source: "server";
};

function toPlainText(text: string): string {
  return text.replace(/\s*\|\s*/g, " ");
}

async function extractPdfText(data: Uint8Array): Promise<ExtractResult> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({
      cellSeparator: " | ",
      cellThreshold: 18,
      pageJoiner: ""
    });
    const tablePages = result.pages.map((page) => page.text);
    const plainPages = tablePages.map(toPlainText);
    return {
      plainText: plainPages.join("\n"),
      tableText: tablePages.join("\n\n"),
      firstPagePlainText: plainPages[0] || "",
      firstPageTableText: tablePages[0] || "",
      source: "server"
    };
  } finally {
    await parser.destroy();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "file is required." }, { status: 400 });
    }

    const result = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { code: "EXTRACT_FAILED", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
