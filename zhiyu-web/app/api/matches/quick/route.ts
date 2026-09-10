import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { quickMatch } from "@/lib/matching/quick";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId");
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }

  const me = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!me) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  // MVP：从整个 Persona 池匹配（真人 / 公开创作者 / AI 演示人格），后续按可见性过滤
  const pool = await prisma.persona.findMany({
    where: { id: { not: personaId } },
    take: 200,
  });

  const matches = quickMatch(me as never, pool as never, 10);

  return NextResponse.json({
    ok: true,
    mode: "quick",
    count: matches.length,
    matches,
  });
}
