import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runMockAgentDialogue } from "@/lib/agent/dialogue";
import { runLlmAgentDialogue } from "@/lib/agent/dialogue-llm";
import { decryptSecret } from "@/lib/crypto";
import { chatCompletion } from "@/lib/llm/chat";
import { resolveLlmSource } from "@/lib/llm/platform";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const { id } = await params;

  /* 发起人**只**来自会话。
     以前这里读 body 里的 `initiatorUserId` —— 那意味着填上别人的 userId
     就能用**别人的 BYOK API Key** 跑这场 Agent 对话（替别人花钱），
     而且这是一次真实的付费调用。 */
  const me = await resolveIdentity();

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      personaA: { include: { user: true } },
      personaB: { include: { user: true } },
    },
  });
  if (!match) {
    return NextResponse.json({ ok: false, error: "Match 不存在" }, { status: 404 });
  }
  if (match.status === "report_ready") {
    return NextResponse.json({ ok: false, error: "该 Match 已有报告" }, { status: 409 });
  }

  /* 会话用户优先；没有会话（本地演示/A 侧注册用户场景）才回退到 A 侧 */
  const initiator = me?.userId ?? match.personaA.userId ?? null;
  const session = await prisma.agentSession.create({
    data: {
      matchId: match.id,
      status: "running",
      currentRound: 0,
      maxRounds: 5,
      initiatorUserId: initiator,
      startedAt: new Date(),
    },
  });

  const a = {
    id: match.personaA.id,
    displayName: match.personaA.displayName,
    kind: match.personaA.kind,
    interests: match.personaA.interests,
    topics: match.personaA.topics,
    communicationStyle: match.personaA.communicationStyle,
    values: match.personaA.values,
    personality: match.personaA.personality,
  };
  const b = {
    id: match.personaB.id,
    displayName: match.personaB.displayName,
    kind: match.personaB.kind,
    interests: match.personaB.interests,
    topics: match.personaB.topics,
    communicationStyle: match.personaB.communicationStyle,
    values: match.personaB.values,
    personality: match.personaB.personality,
  };

  let llmError: string | null = null;

  const provider = initiator
    ? await prisma.llmProviderConfig.findFirst({
        where: { userId: initiator },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    : null;

  /* BYOK 优先，其次用平台免费额度（#7）—— 受设置页滑块约束。
     以前没有 BYOK 就直接退化成 mock 对话，等于"平台模型"这条链路
     在 Agent 对话里完全没接上。 */
  let byok: { baseUrl: string; apiKey: string; model: string } | null = null;
  if (provider) {
    try {
      byok = {
        baseUrl: provider.baseUrl,
        apiKey: decryptSecret(provider.apiKeyEnc),
        model: provider.model,
      };
    } catch (e) {
      llmError = `读取你的模型配置失败：${(e as Error).message}`;
    }
  }

  const prefs = initiator
    ? await prisma.communicationPrefs.findUnique({ where: { userId: initiator } })
    : null;
  const resolved = resolveLlmSource(prefs, byok);

  let llmOut: Awaited<ReturnType<typeof runLlmAgentDialogue>> | null = null;
  if (resolved.provider) {
    try {
      const chosen = resolved.provider;
      llmOut = await runLlmAgentDialogue(a, b, {
        chat: (messages) =>
          chatCompletion(chosen, messages, { timeoutMs: 30000 }),
      });
    } catch (e) {
      llmError = (e as Error).message;
    }
  } else if (!llmError) {
    llmError = resolved.reason ?? "没有可用的大模型";
  }

  const { rounds, judge } = llmOut ?? runMockAgentDialogue(a, b);
  const demoMode = llmOut === null;
  /** 记下这次用的是谁的模型，便于排查"为什么走了 mock" */
  const llmSource = llmOut ? resolved.source : "mock";

  await prisma.$transaction(async (tx) => {
    for (const r of rounds) {
      await tx.agentMessage.createMany({
        data: [
          { sessionId: session.id, role: "system", content: r.question, round: r.round },
          { sessionId: session.id, role: "agent_a", content: r.aReply, round: r.round },
          { sessionId: session.id, role: "agent_b", content: r.bReply, round: r.round },
        ],
      });
    }

    await tx.agentSession.update({
      where: { id: session.id },
      data: {
        status: "completed",
        currentRound: rounds.length,
        completedAt: new Date(),
      },
    });

    await tx.match.update({
      where: { id: match.id },
      data: { status: "report_ready" },
    });

    const report = await tx.matchReport.create({
      data: {
        matchId: match.id,
        result: {
          rounds,
          dimensions: judge.dimensions,
          reasons: judge.reasons,
          demoMode,
          llmError,
        } as unknown as Prisma.InputJsonValue,
        overallScore: judge.overall,
        summary: judge.summary,
      },
    });

    const userIds = new Set<string>();
    if (initiator) userIds.add(initiator);
    if (match.personaB.userId) userIds.add(match.personaB.userId);
    for (const uid of userIds) {
      await tx.notification.create({
        data: {
          userId: uid,
          type: uid === initiator ? "agent_completed" : "report_received",
          payload: {
            matchId: match.id,
            reportId: report.id,
            overallScore: judge.overall,
            counterpart: uid === initiator ? b.displayName : a.displayName,
          },
        },
      });
    }

    return report;
  });

  const report = await prisma.matchReport.findUniqueOrThrow({
    where: { matchId: match.id },
  });

  return NextResponse.json({
    ok: true,
    demoMode,
    /** byok=用用户自己的模型；platform=用知遇免费额度；mock=都没用上 */
    llmSource,
    llmError,
    sessionId: session.id,
    report,
  });
}
