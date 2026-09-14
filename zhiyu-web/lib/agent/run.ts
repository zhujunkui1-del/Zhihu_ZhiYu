/**
 * 「跑一场 Agent 对话」的核心实现。
 *
 * ── 为什么抽出来 ──────────────────────────────────────────────────────
 * 原先这段逻辑只存在于 `POST /api/matches/[id]/start`。
 * 但产品的入口其实是首页/发现页的「让 Agent 先聊聊」—— 那个按钮**从没调用过后端**
 * （只写 localStorage 弹了个提示），所以「Agent 匹配」页永远空空如也、
 * 通知页也没有记录、平台额度当然也不会动。
 *
 * 现在把引擎收在这里，两处入口共用同一份实现：
 *   · `POST /api/matches/[id]/start` —— 按 matchId 启动（Agent 匹配页用）
 *   · `POST /api/agent/meet`         —— 由 personaId 找/建 match 再启动（首页/发现页用）
 * 分开写两份迟早会行为不一致（一个带通知、一个不带之类）。
 *
 * 模型选择遵循产品规则：**BYOK 优先，其次平台免费额度**，
 * 且受设置页「使用知遇提供的大模型」滑块约束（见 lib/llm/platform.ts）。
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runMockAgentDialogue } from "@/lib/agent/dialogue";
import { runLlmAgentDialogue } from "@/lib/agent/dialogue-llm";
import { decryptSecret } from "@/lib/crypto";
import { chatCompletion } from "@/lib/llm/chat";
import { resolveLlmSource } from "@/lib/llm/platform";

/** 参与对话的一方，字段取自 Persona */
export interface DialogueSideRow {
  id: string;
  displayName: string;
  kind: string;
  interests: unknown;
  topics: unknown;
  communicationStyle: unknown;
  values: unknown;
  personality: unknown;
}

export interface RunDialogueResult {
  sessionId: string;
  matchId: string;
  reportId: string;
  rounds: number;
  overallScore: number;
  summary: string;
  /** byok | platform | mock */
  llmSource: "byok" | "platform" | "mock";
  demoMode: boolean;
  llmError: string | null;
}

interface MatchWithSides {
  id: string;
  personaAId: string;
  personaBId: string;
  personaA: DialogueSideRow & { userId: string | null };
  personaB: DialogueSideRow & { userId: string | null };
}

/**
 * 跑完一场 Agent 对话并落库：AgentSession → AgentMessage → MatchReport → Notification。
 *
 * 这是**同步**执行的（一次约 10~40 秒）。产品上够用，但调用方要注意
 * 前端要有"进行中"的反馈，不能静默等待。
 *
 * @param initiatorUserId 谁发起的（决定用谁的模型额度）；null 时回退到 A 侧用户
 */
export async function runAgentDialogueForMatch(
  match: MatchWithSides,
  initiatorUserId: string | null,
): Promise<RunDialogueResult> {
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

  const a = match.personaA;
  const b = match.personaB;

  let llmError: string | null = null;

  /* 取发起人的 BYOK（若有） */
  const provider = initiator
    ? await prisma.llmProviderConfig.findFirst({
        where: { userId: initiator },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      })
    : null;

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
        chat: (messages) => chatCompletion(chosen, messages, { timeoutMs: 30000 }),
      });
    } catch (e) {
      llmError = (e as Error).message;
    }
  } else if (!llmError) {
    llmError = resolved.reason ?? "没有可用的大模型";
  }

  const { rounds, judge } = llmOut ?? runMockAgentDialogue(a as never, b as never);
  const demoMode = llmOut === null;
  /* 只有真的调通 LLM 才报 byok/platform；否则一律 mock。
     `resolved.source` 可能是 "none"（没有可用模型），那种情况下 llmOut 必为 null，
     所以这里不会把 "none" 当成模型来源报给前端。 */
  const llmSource: RunDialogueResult["llmSource"] =
    llmOut && (resolved.source === "byok" || resolved.source === "platform")
      ? resolved.source
      : "mock";

  /* ⚠️ 必须显式放宽事务超时。
     Prisma 默认 `maxWait` 2s / `timeout` 5s，而本项目的库在 Neon 新加坡，
     且这次事务是在**一次 20~40 秒的 LLM 调用之后**才开始的 ——
     连接可能已被回收，重新建连 + 写入 15 条消息常常超过 5 秒，
     于是随机报 `Unable to start a transaction in the given time`
     （实测：同一段代码有时成功、有时 500）。 */
  const reportId = await prisma.$transaction(
    async (tx) => {
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
      data: { status: "completed", currentRound: rounds.length, completedAt: new Date() },
    });

    await tx.match.update({ where: { id: match.id }, data: { status: "report_ready" } });

    const report = await tx.matchReport.create({
      data: {
        matchId: match.id,
        result: {
          rounds,
          dimensions: judge.dimensions,
          reasons: judge.reasons,
          demoMode,
          llmError,
          llmSource,
        } as unknown as Prisma.InputJsonValue,
        overallScore: judge.overall,
        summary: judge.summary,
      },
    });

    /* 通知双方。**必须给发起人也发一条** —— 否则用户点了按钮
       在通知页看不到任何动静，会以为没生效（实际投诉过）。 */
    const userIds = new Set<string>();
    if (initiator) userIds.add(initiator);
    if (match.personaB.userId) userIds.add(match.personaB.userId);
    for (const uid of userIds) {
      await tx.notification.create({
        data: {
          userId: uid,
          type: "agent_completed",
          payload: {
            matchId: match.id,
            reportId: report.id,
            counterpartName:
              uid === initiator ? b.displayName : a.displayName,
            overallScore: judge.overall,
            demoMode,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return report.id;
    },
    /* 建连最多等 20 秒、事务体最多跑 60 秒 —— 见上方说明 */
    { maxWait: 20000, timeout: 60000 },
  );

  return {
    sessionId: session.id,
    matchId: match.id,
    reportId,
    rounds: rounds.length,
    overallScore: judge.overall,
    summary: judge.summary,
    llmSource,
    demoMode,
    llmError,
  };
}

/**
 * 为「我 ↔ TA」找一场可用的 match，没有就建一场。
 *
 * 复用规则：
 *   · 已有 `report_ready` / `agent_running` 的 → 直接返回（不重复烧额度）
 *   · 只找到 `pending` 的 → 复用它
 *   · 都没有 → 新建
 *
 * 方向约定：personaA = 我（发起人），personaB = 对方。
 * 因为 `runAgentDialogueForMatch` 拿不到发起人时会回退到 A 侧用户，
 * 把我放在 A 侧能让"没有会话"的情况也落在正确的账号上。
 */
export async function findOrCreateMatch(
  myPersonaId: string,
  otherPersonaId: string,
): Promise<{ match: MatchWithSides; created: boolean; reused: boolean }> {
  if (myPersonaId === otherPersonaId) {
    throw new Error("不能和自己匹配");
  }

  const include = {
    personaA: { include: { user: { select: { id: true } } } },
    personaB: { include: { user: { select: { id: true } } } },
  } as const;

  const existing = await prisma.match.findFirst({
    where: {
      OR: [
        { personaAId: myPersonaId, personaBId: otherPersonaId },
        { personaAId: otherPersonaId, personaBId: myPersonaId },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include,
  });

  if (existing) {
    /* 归一化方向：把我放 A 侧，便于下游取发起人 */
    const flipped = existing.personaAId !== myPersonaId;
    const match = (flipped
      ? { ...existing, personaA: existing.personaB, personaB: existing.personaA }
      : existing) as unknown as MatchWithSides;
    return { match, created: false, reused: true };
  }

  const created = await prisma.match.create({
    data: { personaAId: myPersonaId, personaBId: otherPersonaId, mode: "agent", status: "pending" },
    include,
  });

  return { match: created as unknown as MatchWithSides, created: true, reused: false };
}

/** 取一场 match（含两侧），供 start 路由用 */
export async function getMatchWithSides(matchId: string): Promise<MatchWithSides | null> {
  const m = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      personaA: { include: { user: { select: { id: true } } } },
      personaB: { include: { user: { select: { id: true } } } },
    },
  });
  return (m as unknown as MatchWithSides) ?? null;
}
