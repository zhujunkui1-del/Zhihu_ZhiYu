/**
 * 发现页的数据装配。
 *
 * 为什么单独一个模块（而不写在 route 里）：
 * `/api/discover` 与 `/api/matches/quick` 都要输出"候选 + 与我的相似度"，
 * 装配逻辑必须一致，否则两个入口给出的分数会对不上。
 */

import { prisma } from "@/lib/db";
import type { Persona } from "@prisma/client";
import { scoreAll, type MatchablePersona, type QuickMatchResult } from "@/lib/matching/quick";
import { PROVINCES } from "@/lib/regions";
import { matchPersonaType } from "@/lib/persona/fusion";
import { resolvePersonaType } from "@/lib/persona/type-source";
import { clampPercent } from "@/lib/score";

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
  /**
   * 当前用户自己的 persona id。
   *
   * 带上它是为了发现页能判断用户从雷达/卡片点开的是**别人**还是自己
   * —— 弹窗人格卡的标题要区分"XX 的人格卡"与"我的人格"。
   */
  personaId: string;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * 取一个人格的**倾向型**（发现页「人格倾向」筛选与卡片上显示的那个）。
 *
 * 优先级（④c 调整）：
 *   ① `personality.type` —— **蒸馏时由 LLM 读懂证据后判定的**，`typeEvidence`
 *      里带着原话依据。这是现在唯一"有理由"的判型来源。
 *      演示数据预置的型也在这个字段里，所以行为不变。
 *   ② 六维欧氏距离（`matchPersonaType`）—— 仅作**历史数据兜底**：
 *      实测第一名与第二名只差 0.016 个百分点（79.2109% vs 79.1949%），
 *      把 career 从 0.5 挪到 0.6 就换型。那不是判定，是抛硬币，
 *      所以不再作为主来源。
 *   ③ 最后才退回 SBTI 自评的类型名。
 */
function personaType(values: unknown, personality: unknown): string | null {
  /* ⭐ 与首页/人格页**同一个函数**：判型 → 六维兜底 → SBTI → 无。
     这里不再自己排优先级（见 lib/persona/type-source.ts 的事故说明）。 */
  const fusedMatch = matchPersonaType(
    values && typeof values === "object" ? (values as Record<string, unknown>) : null,
  );
  return resolvePersonaType({
    personality,
    fused: fusedMatch ? { type: fusedMatch.type, similarity: fusedMatch.similarity } : null,
  }).type;
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
 * 性能说明（实测数据）：Neon 在新加坡，单次查询往返约 **100~200ms**，
 * 所以"少一次串行查询"就是省 100~200ms。这里做了两件事：
 *   · `me` 与候选池**并发**查询（候选池只依赖 personaId，不依赖 me 的结果）
 *   · 支持传入**已取好的 me**，避免调用方（如 buildHome）重复查一次
 *
 * @param personaId 当前用户的人设 id
 * @param preloadedMe 调用方已经查过的 persona，传进来可省一次往返
 */
export async function buildDiscover(
  personaId: string,
  preloadedMe?: Persona | null,
): Promise<DiscoverResult> {
  const [me, pool] = await Promise.all([
    preloadedMe !== undefined
      ? Promise.resolve(preloadedMe)
      : prisma.persona.findUnique({ where: { id: personaId } }),
    /* 候选池：除自己以外的所有 Persona（真人 / 公开创作者 / AI 演示人格）。
       TODO(可见性): 接入《Agent 社交边界与数据披露规范》后，
       这里要按 CommunicationPrefs.showSimilarity 过滤掉不愿被推荐的人。 */
    prisma.persona.findMany({
      where: { id: { not: personaId } },
      orderBy: { displayName: "asc" },
      take: 200,
    }),
  ]);

  if (!me) {
    return { candidates: [], total: 0, meReady: false, provinces: [], personaId };
  }

  const meReady = isMatchable(me);

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
      type: personaType(p.values, p.personality),
      /* 标签取兴趣前 3 项；不够时用 topics 补 */
      tags: [...interests, ...stringArray(p.topics)].slice(0, 4),
      agentOpen: p.agentOpen,
      /* 分值在 scoreAll 里已收进 [1, 99]；`?? 0` 只在"我这边还没法算"时出现，
         调用方据 `meReady` 决定不显示（0 是哨兵，不是"0% 像"）。 */
      sim: clampPercent(r?.overall) ?? 0,
      dimensions: r?.dimensions ?? {},
      reasons: r?.reasons ?? [],
    };
  });

  /**
   * 省份下拉的选项。
   *
   * ★ 必须用**完整地区表**，不能从候选里推导 ★
   * 曾经写成 `candidates.map(c => c.province)`，后果是下拉只显示"当前有人"
   * 的那十来个省份 —— 用户看到的就是「省份有欠缺」。实际上地区表里
   * 34 个省级单位 + 海外都齐，只是没被列出来。
   *
   * 顺带一个体验好处：能筛到 0 人的省份，用户会看到明确的空态
   * （"这个地区暂时没有人"），而不是"找不到这个选项、以为没这个省"。
   */
  const provinces = PROVINCES.filter((p) => p !== "海外").concat(
    candidates.some((c) => c.province === "海外") ? ["海外"] : [],
  );

  return { candidates, total: candidates.length, meReady, provinces, personaId };
}
