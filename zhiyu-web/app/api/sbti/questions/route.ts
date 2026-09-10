import { NextResponse } from "next/server";
import { questions } from "@/lib/sbti/scoring";

export const dynamic = "force-dynamic";

export function GET() {
  const payload = questions.map((q) => ({
    id: q.id,
    dim: q.dim,
    dimName: q.dimName,
    text: q.text,
    options: q.options.map((o) => ({ key: o.key, text: o.text })),
  }));

  return NextResponse.json({ ok: true, count: payload.length, questions: payload });
}
