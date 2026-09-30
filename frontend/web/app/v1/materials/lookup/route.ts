import { NextResponse } from "next/server";
import { lookupMaterialByPartNo } from "@/lib/server/material-engine";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const partNo = String(url.searchParams.get("partNo") || "").trim();
    if (!partNo) {
      return NextResponse.json({ code: "INVALID_INPUT", message: "partNo is required." }, { status: 400 });
    }

    const result = await lookupMaterialByPartNo(partNo);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        code: "LOOKUP_FAILED",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
