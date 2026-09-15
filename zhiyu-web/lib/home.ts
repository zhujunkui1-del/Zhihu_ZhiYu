/**
 * 首页数据装配。
 *
 * 首页要同时展示四块内容：我的人格总览、Agent 匹配进行中、发现预览、通知。
 * 放在一个模块里一次查完，避免页面内散落多次查询、也避免各块口径不一致。
 */

import { prisma } from "@/lib/db";
import { buildPersonaBoard, type PersonaBoard } from "@/lib/persona-view";
import { buildDiscover, type DiscoverCandidate } from "@/lib/discover";

export interface RunningSession {
  matchId: string;
  status: string;
  currentRound: number;
  maxRounds: number;
  counterpartName: string;
  counterpartId: string;
}

export interface NotifyItem {
  id: string;
  type: string;
  read: boolean;
  createdAt: Date;
  /** 从 payload 里取出的可读标题 */
  title: string;
}

export interface HomeData {
  board: PersonaBoard;
  /** Agent 匹配预览（进行中优先，其次已完成） */
  running: RunningSession[];
  /** 发现预览候选（按相似度降序） */
  preview: DiscoverCandidate[];
  /** 发现预览里可轮换的全部候选（「换一批」用） */
  previewPool: DiscoverCandidate[];
  notify: NotifyItem[];
  unread: number;
  /**
   * 当前用户的画像是否已就绪（决定"相似度"能不能显示）。
   *
   * 没就绪时所有候选的 `sim` 都是 0 —— 那是"**没算过**"，
   * 不是"跟你 0% 像"。产品要求界面上不出现 0%，所以这种情况
   * 干脆不显示相似度，而不是把它渲染成"0%"或硬凑成"1%"。
   */
  meReady: boolean;
}

/** 从通知 payload 里提炼一句可读文案 */
function notifyTitle(type: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const who = typeof p.counterpartName === "string" ? p.counterpartName : "";
  switch (type) {
    case "agent_completed":
      return who ? `与 ${who} 的 Agent 对话已完成` : "一组 Agent 对话已完成";
    case "report_received":
      return who ? `收到来自 ${who} 的匹配报告` : "收到一份匹配报告";
    case "agent_started":
      return who ? `与 ${who} 的 Agent 对话已开始` : "一组 Agent 对话已开始";
    default:
      return typeof p.title === "string" ? p.title : "有一条新通知";
  }
}

export async function buildHome(personaId: string, userId: string): Promise<HomeData | null> {
  /* 一次取好 persona（含 sources），后面人格卡与发现预览**共用**它。
     不共享的话同一个 persona 会被查两遍 —— 每次往返 100~200ms。 */
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    include: { sources: true },
  });
  if (!persona) return null;

  const board = await buildPersonaBoard(personaId, persona);
  if (!board) return null;

  const [matches, notifications, discover] = await Promise.all([
    prisma.match.findMany({
      where: { OR: [{ personaAId: personaId }, { personaBId: personaId }] },
      include: {
        personaA: { select: { id: true, displayName: true } },
        personaB: { select: { id: true, displayName: true } },
        sessions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    buildDiscover(personaId, persona),
  ]);

  /* Agent 匹配：进行中的排前面 */
  const running: RunningSession[] = matches
    .map((m) => {
      const isA = m.personaAId === personaId;
      const counterpart = isA ? m.personaB : m.personaA;
      const s = m.sessions[0];
      return {
        matchId: m.id,
        status: s?.status ?? "pending",
        currentRound: s?.currentRound ?? 0,
        maxRounds: s?.maxRounds ?? 5,
        counterpartName: counterpart.displayName,
        counterpartId: counterpart.id,
      };
    })
    .sort((a, b) => {
      const rank = (s: string) =>
        s === "running" || s === "analyzing" ? 0 : s === "pending" ? 1 : 2;
      return rank(a.status) - rank(b.status);
    })
    .slice(0, 3);

  const notify: NotifyItem[] = notifications.map((n) => ({
    id: n.id,
    type: n.type,
    read: Boolean(n.readAt),
    createdAt: n.createdAt,
    title: notifyTitle(n.type, n.payload),
  }));

  const pool = [...discover.candidates].sort((a, b) => b.sim - a.sim);

  /**
   * 首次进入时展示的 3 位。
   *
   * ⚠️ 不能直接取相似度前 3。内置演示人格（16 个）对演示用户算出的相似度
   * 天然偏高，长期占满前 16 名，真实知乎用户（27 个）最高才第 17 名 ——
   * 直接取前 3 会让首页**永远只显示演示人格**，看不到真人。
   * 这里按类别取：2 位真人 + 1 位演示人格（真人不够时自动降级）。
   */
  const isBuiltin = (p: DiscoverCandidate) => /^演示人格\s*\d+$/.test(p.displayName);
  const realCandidates = pool.filter((p) => !isBuiltin(p));
  const builtinCandidates = pool.filter(isBuiltin);
  const previewSeed = [
    ...realCandidates.slice(0, 2),
    ...builtinCandidates.slice(0, 1),
  ];
  /* 某一类为空时用另一类补满，保证始终 3 张卡 */
  if (previewSeed.length < 3) {
    for (const p of pool) {
      if (previewSeed.length >= 3) break;
      if (!previewSeed.some((x) => x.id === p.id)) previewSeed.push(p);
    }
  }

  return {
    board,
    running,
    preview: previewSeed.slice(0, 3),
    previewPool: pool,
    notify: notify.slice(0, 4),
    unread: notify.filter((n) => !n.read).length,
    meReady: discover.meReady,
  };
}
