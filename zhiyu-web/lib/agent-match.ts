/**
 * Agent 匹配页的数据装配。
 *
 * 数据来源都是**已经跑通的**后端：
 *   · `Match` / `AgentSession` / `AgentMessage` —— 由 `/api/matches/[id]/start` 写入
 *   · `MatchReport` —— 由同一条路由在对话结束后用 Judge 结果写入
 *     （`result = { rounds, dimensions, reasons, demoMode, llmError }`）
 *
 * 这里只做「读 + 整理成视图」，不重跑对话、不改业务逻辑。
 */

import { prisma } from "@/lib/db";

/** Judge 的五个维度（与 lib/agent/dialogue.ts 的 JudgeDimensions 一致） */
export const JUDGE_DIMENSIONS: { key: string; label: string }[] = [
  { key: "interest", label: "兴趣同频" },
  { key: "thinking", label: "思维共振" },
  { key: "values", label: "价值观契合" },
  { key: "communication", label: "沟通适配" },
  { key: "complementarity", label: "互补程度" },
];

export interface DialogueRoundView {
  round: number;
  question: string;
  aReply: string;
  bReply: string;
}

export interface Counterpart {
  id: string;
  displayName: string;
  kind: string;
}

/** 「认识中」的一条会话 */
export interface SessionView {
  matchId: string;
  status: string;
  mode: string;
  currentRound: number;
  maxRounds: number;
  startedAt: Date | null;
  completedAt: Date | null;
  /** 对方（不是自己那一侧） */
  counterpart: Counterpart;
  /** 自己那一侧 */
  me: Counterpart;
  rounds: DialogueRoundView[];
  /** 最近一轮的问题，用于列表上的一句预览 */
  lastQuestion: string;
}

export interface DimensionView {
  key: string;
  label: string;
  /** 0~100 的整数；缺数据时为 null */
  value: number | null;
}

/** 「匹配报告」的一条 */
export interface ReportView {
  matchId: string;
  overall: number;
  summary: string;
  dimensions: DimensionView[];
  reasons: string[];
  /** true = 用的是确定性 Mock 对话，不是真 LLM。演示时必须如实标注 */
  demoMode: boolean;
  /** 真 LLM 失败时的原因（有值时说明回退到了 Mock） */
  llmError: string | null;
  createdAt: Date;
  counterpart: Counterpart;
  me: Counterpart;
  rounds: DialogueRoundView[];
}

export interface AgentMatchData {
  sessions: SessionView[];
  reports: ReportView[];
  counts: { running: number; reports: number };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 从 result.dimensions（0~1 小数）整理成 0~100 的展示值 */
function toDimensions(raw: unknown): DimensionView[] {
  const o = (raw ?? {}) as Record<string, unknown>;
  return JUDGE_DIMENSIONS.map((d) => {
    const v = o[d.key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { key: d.key, label: d.label, value: null };
    }
    /* 兼容小数与百分数两种存储 */
    const pct = v <= 1 ? v * 100 : v;
    return { key: d.key, label: d.label, value: Math.round(pct) };
  });
}

/** 把 AgentMessage 列表整理成按轮次分组的对话 */
function toRounds(
  messages: { role: string; content: string; round: number }[],
): DialogueRoundView[] {
  const byRound = new Map<number, { q: string; a: string; b: string }>();
  for (const m of messages) {
    const cur = byRound.get(m.round) ?? { q: "", a: "", b: "" };
    if (m.role === "system") cur.q = m.content;
    else if (m.role === "agent_a") cur.a = m.content;
    else if (m.role === "agent_b") cur.b = m.content;
    byRound.set(m.round, cur);
  }
  return [...byRound.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([round, v]) => ({ round, question: v.q, aReply: v.a, bReply: v.b }));
}

export async function buildAgentMatch(personaId: string): Promise<AgentMatchData> {
  const matches = await prisma.match.findMany({
    where: { OR: [{ personaAId: personaId }, { personaBId: personaId }] },
    include: {
      personaA: { select: { id: true, displayName: true, kind: true } },
      personaB: { select: { id: true, displayName: true, kind: true } },
      report: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { messages: { orderBy: [{ round: "asc" }, { createdAt: "asc" }] } },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const sessions: SessionView[] = [];
  const reports: ReportView[] = [];

  for (const m of matches) {
    const isA = m.personaAId === personaId;
    const counterpart = isA ? m.personaB : m.personaA;
    const me = isA ? m.personaA : m.personaB;
    const s = m.sessions[0];
    const rounds = s ? toRounds(s.messages) : [];

    /* 没有报告的进入「认识中」；有报告的进入「匹配报告」 */
    if (!m.report) {
      sessions.push({
        matchId: m.id,
        status: s?.status ?? "pending",
        mode: m.mode,
        currentRound: s?.currentRound ?? 0,
        maxRounds: s?.maxRounds ?? 5,
        startedAt: s?.startedAt ?? null,
        completedAt: s?.completedAt ?? null,
        counterpart,
        me,
        rounds,
        lastQuestion: rounds.length ? rounds[rounds.length - 1].question : "",
      });
      continue;
    }

    const result = (m.report.result ?? {}) as Record<string, unknown>;
    reports.push({
      matchId: m.id,
      overall: Math.round(m.report.overallScore <= 1 ? m.report.overallScore * 100 : m.report.overallScore),
      summary: m.report.summary ?? "",
      dimensions: toDimensions(result.dimensions),
      reasons: Array.isArray(result.reasons)
        ? result.reasons.filter((x): x is string => typeof x === "string")
        : [],
      demoMode: result.demoMode === true,
      llmError: str(result.llmError) || null,
      createdAt: m.report.createdAt,
      counterpart,
      me,
      rounds: (() => {
        const r = result.rounds;
        if (!Array.isArray(r)) return rounds;
        return r
          .map((x) => {
            const o = (x ?? {}) as Record<string, unknown>;
            return {
              round: typeof o.round === "number" ? o.round : 0,
              question: str(o.question),
              aReply: str(o.aReply),
              bReply: str(o.bReply),
            };
          })
          .filter((x) => x.question || x.aReply || x.bReply);
      })(),
    });
  }

  return {
    sessions,
    reports,
    counts: { running: sessions.length, reports: reports.length },
  };
}
