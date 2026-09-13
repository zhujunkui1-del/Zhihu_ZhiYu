/**
 * 发现页的数据装配。
 *
 * 为什么单独一个模块（而不写在 route 里）：
 * `/api/discover` 与 `/api/matches/quick` 都要输出"候选 + 与我的相似度"，
 * 装配逻辑必须一致，否则两个入口给出的分数会对不上。
 */

import { prisma } from "@/lib/db";
import { scoreAll, type MatchablePersona, type QuickMatchResult } from "@/lib/matching/quick";

/** 发现页需要展示的候选视图 */
export interface DiscoverCandidate {
  id: string;
  /**
   * `id` 的别名，仅为兼容既有调用方（首页、Agent 匹配页用 `m.personaId`）。
   *
   * 为什么保留：本接口曾重构为返回完整候选对象，字段名从 `personaId` 变成 `id`，
   * 结果 `/home` 拿到 `undefined` —— React 因此把 5 张卡片判为同一个 key
   * （报"unique key"警告），且「让 Agent 先聊聊」会因 target.personaId 为空而失败。
   * 与其逐个改调用方，这里把旧的键名一并给出，新代码请用 `id`。
   */
  personaId: string;
  displayName: string;
  kind: string;
  /** 一句话简介 */
  bio: string | null;
  province: string | null;
  city: string | null;
  /** 人格倾向（SBTI 的 typeTitle） */
  type: string | null;
  /** 标签（取 interests 前几项，用于卡片上的小标签） */
  tags: string[];
  /** 是否接受 Agent 对话 */
  agentOpen: boolean;
  /** 与当前用户的相似度（0~100） */
  sim: number;
  /** 六维明细，key 为 interest/personality/topics/values/communication/complementarity */
  dimensions: QuickMatchResult["dimensions"];
  /** 推荐理由（可解释性） */
  reasons: string[];
}

export interface DiscoverResult {
  candidates: DiscoverCandidate[];
  /** 候选池总数（未筛选前） */
  total: number;
  /** 当前用户的人设是否已就绪；未就绪时 sim 全为 0 且这里为 false */
  meReady: boolean;
  /** 可用的省份列表（按候选池实际出现的省去重） */
  provinces: string[];
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/** 从 personality JSON 里取人格倾向名与 SBTI 类型 */
function personaType(personality: unknown): string | null {
  const p = (personality ?? {}) as Record<string, unknown>;
  const sbti = p.sbti as { type?: string; typeTitle?: string } | undefined;
  return sbti?.typeTitle ?? sbti?.type ?? null;
}

/**
 * 当前用户的人设是否"可参与匹配"。
 *
 * 判据是引擎真正依赖的字段是否齐备。缺任何一项都会让对应维度静默变 null，
 * 报告上表现为空格 —— 早期 demo 用户只有 displayName，六维全 null 就是这个原因。
 */
function isMatchable(p: {
  interests: unknown;
  topics: unknown;
  communicationStyle: unknown;
  values: unknown;
  personality: unknown;
}): boolean {
  const valuesOk = p.values && typeof p.values === "object" && Object.keys(p.values).length > 0;
  const codes = (p.personality as { sbti?: { codes?: string } } | null)?.sbti?.codes;
  const codesOk = typeof codes === "string" && codes.replaceAll("-", "").length === 15;
  return (
    stringArray(p.interests).length > 0 &&
    stringArray(p.topics).length > 0 &&
    stringArray(p.communicationStyle).length > 0 &&
    Boolean(valuesOk) &&
    codesOk
  );
}

/**
 * 装配发现页数据。
 *
 * @param personaId 当前用户的人设 id
 */
export async function buildDiscover(personaId: string): Promise<DiscoverResult> {
  const me = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!me) {
    return { candidates: [], total: 0, meReady: false, provinces: [] };
  }

  const meReady = isMatchable(me);

  /* 候选池：除自己以外的所有 Persona（真人 / 公开创作者 / AI 演示人格）。
     TODO(可见性): 接入《Agent 社交边界与数据披露规范》后，
     这里要按 CommunicationPrefs.showSimilarity 过滤掉不愿被推荐的人。 */
  const pool = await prisma.persona.findMany({
    where: { id: { not: personaId } },
    orderBy: { displayName: "asc" },
    take: 200,
  });

  /* 用与 quickMatch 完全相同的评分逻辑，但不排序截断 —— 搜索/随机也要有相似度 */
  const scored = meReady
    ? new Map(
        scoreAll(me as unknown as MatchablePersona, pool as unknown as MatchablePersona[]).map(
          (r) => [r.personaId, r],
        ),
      )
    : new Map<string, QuickMatchResult>();

  const candidates: DiscoverCandidate[] = pool.map((p) => {
    const r = scored.get(p.id);
    const interests = stringArray(p.interests);
    return {
      id: p.id,
      personaId: p.id,
      displayName: p.displayName,
      kind: p.kind,
      bio: p.bio ?? null,
      province: p.province ?? null,
      city: p.city ?? null,
      type: personaType(p.personality),
      /* 标签取兴趣前 3 项；不够时用 topics 补 */
      tags: [...interests, ...stringArray(p.topics)].slice(0, 4),
      agentOpen: p.agentOpen,
      sim: r?.overall ?? 0,
      dimensions: r?.dimensions ?? {},
      reasons: r?.reasons ?? [],
    };
  });

  const provinces = [...new Set(candidates.map((c) => c.province).filter((x): x is string => !!x))];

  return { candidates, total: candidates.length, meReady, provinces };
}
