import { NextRequest, NextResponse } from "next/server";
import { consumeEstimateIntake, saveEstimateIntake } from "@/lib/server/estimate-intake-store";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing PDF file." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const token = saveEstimateIntake({
      bytes,
      name: file.name || "estimate.pdf",
      type: file.type || "application/pdf"
    });
    return NextResponse.json({ token });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Failed to save intake file." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const token = String(request.nextUrl.searchParams.get("token") || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing intake token." }, { status: 400 });
  }
  const record = consumeEstimateIntake(token);
  if (!record) {
    return NextResponse.json({ error: "Intake token expired or not found." }, { status: 404 });
  }
  const body = new ArrayBuffer(record.bytes.byteLength);
  new Uint8Array(body).set(record.bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": record.type || "application/pdf",
      "Content-Disposition": `inline; filename="${record.name}"`,
      "X-Intake-File-Name": encodeURIComponent(record.name),
      "X-Intake-File-Type": record.type || "application/pdf"
    }
  });
}
