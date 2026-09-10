import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId");
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }

  const list = await prisma.match.findMany({
    where: { OR: [{ personaAId: personaId }, { personaBId: personaId }] },
    include: {
      personaA: { select: { id: true, displayName: true, kind: true } },
      personaB: { select: { id: true, displayName: true, kind: true } },
      report: { select: { overallScore: true, summary: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const items = list.map((m) => {
    const isA = m.personaAId === personaId;
    const counterpart = isA ? m.personaB : m.personaA;
    return {
      matchId: m.id,
      mode: m.mode,
      status: m.status,
      createdAt: m.createdAt,
      counterpart,
      report: m.report
        ? { overallScore: m.report.overallScore, summary: m.report.summary }
        : null,
    };
  });

  return NextResponse.json({ ok: true, items });
}
