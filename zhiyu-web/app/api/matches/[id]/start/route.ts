import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runMockAgentDialogue } from "@/lib/agent/dialogue";
import { runLlmAgentDialogue } from "@/lib/agent/dialogue-llm";
import { decryptSecret } from "@/lib/crypto";
import { chatCompletion } from "@/lib/llm/chat";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  let initiatorUserId: string | null = null;
  try {
    const body = (await req.json()) as { initiatorUserId?: string };
    if (typeof body.initiatorUserId === "string") initiatorUserId = body.initiatorUserId;
  } catch {
    // 未传发起人时使用 A 侧注册用户
  }

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

  const initiator = initiatorUserId ?? match.personaA.userId ?? null;
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

  const provider = initiator
    ? await prisma.llmProviderConfig.findFirst({
        where: { userId: initiator },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    : null;

  let llmOut: Awaited<ReturnType<typeof runLlmAgentDialogue>> | null = null;
  let llmError: string | null = null;
  if (provider) {
    try {
      const apiKey = decryptSecret(provider.apiKeyEnc);
      llmOut = await runLlmAgentDialogue(a, b, {
        chat: (messages) =>
          chatCompletion(
            { baseUrl: provider.baseUrl, apiKey, model: provider.model },
            messages,
            { timeoutMs: 30000 },
          ),
      });
    } catch (e) {
      llmError = (e as Error).message;
    }
  }

  const { rounds, judge } = llmOut ?? runMockAgentDialogue(a, b);
  const demoMode = llmOut === null;

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
    llmError,
    sessionId: session.id,
    report,
  });
}
