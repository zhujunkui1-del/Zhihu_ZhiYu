import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { personaAId?: string; personaBId?: string; mode?: string };
  if (!body.personaAId || !body.personaBId) {
    return NextResponse.json({ ok: false, error: "缺少 personaAId / personaBId" }, { status: 400 });
  }
  if (body.personaAId === body.personaBId) {
    return NextResponse.json({ ok: false, error: "不能和自己匹配" }, { status: 400 });
  }

  const a = await prisma.persona.findUnique({ where: { id: body.personaAId } });
  const b = await prisma.persona.findUnique({ where: { id: body.personaBId } });
  if (!a || !b) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  const match = await prisma.match.create({
    data: {
      personaAId: a.id,
      personaBId: b.id,
      mode: body.mode === "agent" ? "agent" : "quick",
      status: "pending",
    },
  });

  return NextResponse.json({ ok: true, match }, { status: 201 });
}
