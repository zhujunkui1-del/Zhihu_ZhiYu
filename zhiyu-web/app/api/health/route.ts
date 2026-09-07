import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "zhiyu",
    db: process.env.DATABASE_URL ? "configured" : "missing",
    time: new Date().toISOString(),
  });
}
