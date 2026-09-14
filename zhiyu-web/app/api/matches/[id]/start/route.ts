import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getMatchWithSides, runAgentDialogueForMatch } from "@/lib/agent/run";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 按 matchId 启动一场 Agent 对话。
 *
 * 引擎（模型选择 / 对话 / 报告 / 通知）在 `lib/agent/run.ts` —— 与
 * `POST /api/agent/meet`（首页/发现页「让 Agent 先聊聊」的入口）**共用同一份**，
 * 避免两个入口行为不一致。
 */
export async function POST(req: NextRequest, { params }: Params) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const { id } = await params;

  /* 发起人**只**来自会话。
     以前这里读 body 里的 `initiatorUserId` —— 那意味着填上别人的 userId
     就能用**别人的 BYOK API Key** 跑这场 Agent 对话（替别人花钱），
     而且这是一次真实的付费调用。 */
  const me = await resolveIdentity();

  const match = await getMatchWithSides(id);
  if (!match) {
    return NextResponse.json({ ok: false, error: "Match 不存在" }, { status: 404 });
  }

  /* 已经有报告的不重复跑（重复跑会白烧额度） */
  const done = await prisma.matchReport.findUnique({ where: { matchId: match.id } });
  if (done) {
    return NextResponse.json(
      { ok: false, code: "ALREADY_DONE", error: "该 Match 已有报告", reportId: done.id },
      { status: 409 },
    );
  }

  /* 会话用户优先；没有会话（本地演示/A 侧注册用户场景）才回退到 A 侧 */
  const initiator = me?.userId ?? match.personaA.userId ?? null;

  try {
    const result = await runAgentDialogueForMatch(match, initiator);
    const report = await prisma.matchReport.findUniqueOrThrow({
      where: { id: result.reportId },
    });

    return NextResponse.json({
      ok: true,
      demoMode: result.demoMode,
      /** byok=用用户自己的模型；platform=用知遇免费额度；mock=都没用上 */
      llmSource: result.llmSource,
      llmError: result.llmError,
      sessionId: result.sessionId,
      report,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, code: "DIALOGUE_FAILED", error: (e as Error).message },
      { status: 500 },
    );
  }
}
