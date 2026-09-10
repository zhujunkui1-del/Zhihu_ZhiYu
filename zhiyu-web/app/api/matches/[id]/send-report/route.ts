import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let fromPersonaId: string | null = null;
  try {
    const body = (await req.json()) as { fromPersonaId?: string };
    fromPersonaId = body.fromPersonaId ?? null;
  } catch {
    // 允许不传
  }

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      personaA: { select: { id: true, displayName: true, userId: true } },
      personaB: { select: { id: true, displayName: true, userId: true } },
      report: true,
    },
  });
  if (!match || !match.report) {
    return NextResponse.json({ ok: false, error: "报告不存在" }, { status: 404 });
  }

  const counterpart =
    fromPersonaId && match.personaA.id === fromPersonaId ? match.personaB : match.personaA;
  const from = counterpart === match.personaB ? match.personaA : match.personaB;

  if (!counterpart.userId) {
    return NextResponse.json({
      ok: true,
      sent: false,
      reason: `${counterpart.displayName} 是 AI 演示人格 / 公开创作者，未注册知遇账号，报告已生成但无法站内投递。`,
    });
  }

  await prisma.notification.create({
    data: {
      userId: counterpart.userId,
      type: "report_received",
      payload: {
        matchId: match.id,
        reportId: match.report.id,
        overallScore: match.report.overallScore,
        counterpart: from.displayName,
      },
    },
  });

  return NextResponse.json({ ok: true, sent: true });
}
