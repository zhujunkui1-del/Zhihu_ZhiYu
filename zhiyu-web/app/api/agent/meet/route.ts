import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findOrCreateMatch, runAgentDialogueForMatch } from "@/lib/agent/run";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";
import { platformAvailability, planLlmSource } from "@/lib/llm/platform";

export const dynamic = "force-dynamic";

/**
 * 「让 Agent 先聊聊」——首页与发现页那个按钮的真正入口。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * 在此之前那个按钮**只写 localStorage + 弹个提示**，从不调用后端。
 * 后果正是用户反馈的：Agent 匹配页没有任何对话、通知页没有记录、
 * 平台额度也不动 —— 因为**根本没有发生任何对话**。
 *
 * 它现在做的事：
 *   ① 校验身份与他人偏好（对方可拒绝被我派 Agent）
 *   ② 找一场已有的 match，没有就新建（**避免重复烧额度**）
 *   ③ 真的跑完多轮 Agent 对话（BYOK 优先 / 否则平台免费额度）
 *   ④ 落库：AgentSession + AgentMessage + MatchReport + 双方 Notification
 *   ⑤ 告诉前端这次**是不是真的用了大模型**（llmSource），不掩盖降级
 *
 * 注意：这是同步执行（约 10~40 秒）。前端必须给出"进行中"反馈。
 */
export async function POST(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me?.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或还没有自己的人格" },
      { status: 401 },
    );
  }

  let body: { targetPersonaId?: string; force?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 允许空 body，下面会报缺参数 */
  }

  const targetId = body.targetPersonaId?.trim();
  if (!targetId) {
    return NextResponse.json(
      { ok: false, code: "MISSING_TARGET", error: "缺少 targetPersonaId" },
      { status: 400 },
    );
  }
  if (targetId === me.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "SELF_MATCH", error: "不能和自己的 Agent 聊" },
      { status: 400 },
    );
  }

  /* 目标必须存在（顺带取名字用于提示与通知） */
  const target = await prisma.persona.findUnique({
    where: { id: targetId },
    select: { id: true, displayName: true, agentOpen: true, userId: true },
  });
  if (!target) {
    return NextResponse.json(
      { ok: false, code: "TARGET_NOT_FOUND", error: "对方的人格不存在" },
      { status: 404 },
    );
  }

  /* ── 尊重对方意愿 ──────────────────────────────────────────────────
     两层开关：
       · Persona.agentOpen           —— 人设级（发现页列表据此过滤）
       · CommunicationPrefs.allowAgentInvite —— 用户级，**真正拦截以它为准**
     对方关了就必须拒绝，而不是"界面上不显示按钮、接口照样能打"。 */
  if (!target.agentOpen) {
    return NextResponse.json(
      { ok: false, code: "AGENT_CLOSED", error: `${target.displayName} 目前不接受 Agent 对话` },
      { status: 403 },
    );
  }
  if (target.userId) {
    const theirPrefs = await prisma.communicationPrefs.findUnique({
      where: { userId: target.userId },
      select: { allowAgentInvite: true },
    });
    if (theirPrefs && !theirPrefs.allowAgentInvite) {
      return NextResponse.json(
        {
          ok: false,
          code: "AGENT_CLOSED",
          error: `${target.displayName} 已关闭「允许他人派 Agent 与我对话」`,
        },
        { status: 403 },
      );
    }
  }

  /* ── 先看清"这次会不会真的用上大模型" ─────────────────────────────
     提前判定有两个好处：
       · 没有可用模型时可以直接告知用户，而不是跑完一场 mock 才让他发现
       · 响应里如实回报 llmSource，不掩盖降级 */
  const myPrefs = await prisma.communicationPrefs.findUnique({
    where: { userId: me.userId },
    select: { usePlatformLlm: true },
  });
  const myByok = await prisma.llmProviderConfig.findFirst({
    where: { userId: me.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const planned = planLlmSource(myPrefs, Boolean(myByok));
  const platform = platformAvailability();

  if (planned.source === "none") {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_LLM",
        error: `没有可用的大模型：${planned.reason ?? "请接入模型或开启平台额度"}`,
        platformLlm: platform.usable,
        freeUntil: platform.freeUntil,
      },
      { status: 503 },
    );
  }

  const { match, reused } = await findOrCreateMatch(me.ownPersonaId, targetId);

  /* 已经有报告：不重复烧额度，直接把已有报告返回（前端可提示"已聊过"） */
  const existingReport = await prisma.matchReport.findUnique({
    where: { matchId: match.id },
    select: { id: true, overallScore: true, summary: true },
  });
  if (existingReport && !body.force) {
    return NextResponse.json({
      ok: true,
      alreadyDone: true,
      matchId: match.id,
      reportId: existingReport.id,
      overallScore: existingReport.overallScore,
      summary: existingReport.summary,
      counterpartName: target.displayName,
    });
  }

  try {
    const result = await runAgentDialogueForMatch(match, me.userId);
    return NextResponse.json({
      ok: true,
      alreadyDone: false,
      reusedMatch: reused,
      matchId: result.matchId,
      sessionId: result.sessionId,
      reportId: result.reportId,
      rounds: result.rounds,
      overallScore: result.overallScore,
      summary: result.summary,
      /** byok / platform / mock —— 前端据此如实提示，不谎称用了大模型 */
      llmSource: result.llmSource,
      demoMode: result.demoMode,
      llmError: result.llmError,
      counterpartName: target.displayName,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, code: "DIALOGUE_FAILED", error: (e as Error).message },
      { status: 500 },
    );
  }
}
