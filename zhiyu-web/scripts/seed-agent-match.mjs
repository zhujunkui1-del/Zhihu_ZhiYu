/**
 * Agent 匹配演示数据 seed。
 *
 * 为什么需要：Agent 匹配页需要真实的 Match / AgentSession / MatchReport 才能渲染，
 * 而生成它们要调用 `/api/matches/[id]/start`（会跑一遍对话）。演示前不该依赖
 * "手动点几遍"来造数据。
 *
 * 关键：**复用 `lib/agent/dialogue.ts` 的 `runMockAgentDialogue`**，
 * 而不是自己编几轮对话。这样 seed 出的数据与真实运行时的结构完全一致
 * （rounds / dimensions / reasons / overall 都由同一份代码产生）。
 *
 * 用法：node --env-file=.env scripts/seed-agent-match.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { runMockAgentDialogue } from "../lib/agent/dialogue.ts";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** 演示用的 Agent 问题文案由 dialogue.ts 决定，这里不重复定义 */

try {
  const me = await prisma.persona.findFirst({ where: { kind: "human" } });
  if (!me) {
    console.error("找不到 human 人设，请先跑 scripts/seed-demo.mjs");
    process.exit(1);
  }

  const candidates = await prisma.persona.findMany({
    where: { kind: "synthetic" },
    orderBy: { displayName: "asc" },
    take: 8,
  });
  if (candidates.length < 6) {
    console.error(`候选不足（${candidates.length} 个），请先跑 seed-demo.mjs`);
    process.exit(1);
  }

  /* 清理旧的演示匹配（只删与 demo 人设相关的，避免误伤真实数据） */
  const old = await prisma.match.deleteMany({
    where: {
      OR: [{ personaAId: me.id }, { personaBId: me.id }],
      mode: "agent",
    },
  });
  console.log(`已清理旧的 agent 匹配: ${old.count} 条`);

  /* 前 3 条做成"已完成 + 有报告"，后 3 条做成"进行中" */
  const DONE_COUNT = 3;
  const RUNNING_PROGRESS = [2, 3, 4]; /* 分别进行到第几轮 */

  let done = 0;
  let running = 0;

  for (let i = 0; i < 6; i += 1) {
    const other = candidates[i];
    const { rounds, judge } = runMockAgentDialogue(me, other);
    const finished = i < DONE_COUNT;

    /* personaA 固定为自己，这样对话里 agent_a = 我，agent_b = 对方，
       与页面上「我 / TA」的左右分栏一致 */
    await prisma.$transaction(async (tx) => {
      const match = await tx.match.create({
        data: {
          personaAId: me.id,
          personaBId: other.id,
          mode: "agent",
          status: finished ? "report_ready" : "agent_running",
        },
      });

      const shownRounds = finished ? rounds : rounds.slice(0, RUNNING_PROGRESS[i - DONE_COUNT]);
      const session = await tx.agentSession.create({
        data: {
          matchId: match.id,
          status: finished ? "completed" : "running",
          currentRound: shownRounds.length,
          maxRounds: 5,
          initiatorUserId: me.userId,
          startedAt: new Date(Date.now() - (6 - i) * 3600_000),
          completedAt: finished ? new Date(Date.now() - (6 - i) * 1800_000) : null,
        },
      });

      for (const r of shownRounds) {
        await tx.agentMessage.createMany({
          data: [
            { sessionId: session.id, role: "system", content: r.question, round: r.round },
            { sessionId: session.id, role: "agent_a", content: r.aReply, round: r.round },
            { sessionId: session.id, role: "agent_b", content: r.bReply, round: r.round },
          ],
        });
      }

      if (finished) {
        await tx.matchReport.create({
          data: {
            matchId: match.id,
            result: {
              rounds,
              dimensions: judge.dimensions,
              reasons: judge.reasons,
              demoMode: true, /* 由 Mock 规则产生，演示时如实标注 */
              llmError: null,
            },
            overallScore: judge.overall,
            summary: judge.summary,
          },
        });
      }
    });

    if (finished) done += 1;
    else running += 1;
  }

  console.log(`已创建 agent 匹配 ${done + running} 条：已完成带报告 ${done} 条 / 进行中 ${running} 条`);
  console.log(`进行中进度：第 ${RUNNING_PROGRESS.join(" / ")} 轮`);
} finally {
  await prisma.$disconnect();
}
