import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfCrossSite } from "@/lib/auth/csrf";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

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

  /**
   * 幂等：同一场匹配、同一个收件人只投一次。
   *
   * 为什么必须做：按钮可以连点，重复投递会让对方的「发来的报告」里
   * 出现一串一模一样的条目。这里先查后写（同一用户同一 matchId 的
   * `report_received` 已存在就跳过），并在响应里如实回报 `alreadySent`，
   * 界面据此把按钮切成「已送去」。
   */
  const existing = await prisma.notification.findFirst({
    where: {
      userId: counterpart.userId,
      type: "report_received",
      payload: { path: ["matchId"], equals: match.id },
    },
    select: { id: true, createdAt: true },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      sent: true,
      alreadySent: true,
      sentAt: existing.createdAt,
      to: counterpart.displayName,
    });
  }

  const created = await prisma.notification.create({
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
    select: { createdAt: true },
  });

  return NextResponse.json({
    ok: true,
    sent: true,
    alreadySent: false,
    sentAt: created.createdAt,
    to: counterpart.displayName,
  });
}
