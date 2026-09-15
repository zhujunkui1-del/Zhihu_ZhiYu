/**
 * 分源人格解析：把库里**按源存好的证据**逐源解析成 facet，
 * 再融合成综合画像（六维 + 人格倾向）。
 *
 * ── 产品要求（用户原话整理）────────────────────────────────────────────
 *   · 拿到某个源的数据后，就应该能解析出"这个人在这个源里表现出什么特征"
 *   · 「我的人格」页要把每个源的解析分别展示出来
 *   · 「综合画像」是**多源蒸馏融合**的结果，不是 SBTI 自评结果的复述
 *   · **SBTI 的结果也算人格数据，也要参与蒸馏**（用户 2026-09 追加要求）
 *
 * 之前的实现只有"整体蒸馏"这一步，且把 SBTI 结果当成综合画像；
 * 分源解析与融合判定都不存在。本模块补上这两层。
 *
 * ── SBTI 现在是"源"之一，但性质要标注清楚 ─────────────────────────────
 * 知乎/微信/QQ/飞书/钉钉是**观察到的行为**，SBTI 是**本人自报**。
 * 两者都进入融合（产品要求），但融合结果必须带
 * `selfReportSources` / `observedSources`，并且当**只有自评**时
 * 置 `selfReportOnly`，界面据此说明"这版画像目前只反映你自己说的"——
 * 让自评参与，但不让自评冒充观察结论。
 *
 * 数据来源：`PersonaEvidence`（source / trait / value / note / url）
 * 用于观察类源；SBTI 的六维折算则直接读 `Persona.personality.sbti`
 * （那才是唯一事实来源，且 `facetFromSbti` 是纯函数、无需 LLM）。
 */

import { prisma } from "@/lib/db";
import { personalities } from "@/lib/sbti/scoring";
import {
  facetFromContents,
  facetFromSbti,
  fuseSourceFacets,
  matchPersonaType,
  isObservedSource,
  interestFromContents,
  VALUE_KEYS,
  type SourceContent,
  type SourceFacet,
  type TypeMatch,
  type ValueKey,
  type FacetWarning,
} from "./fusion";

/**
 * 按代码查 SBTI 人格记录。
 *
 * ⚠️ 字段含义容易搞反（实测）：
 *   `id`    = 编号（"20"）
 *   `name`  = **代码**（"MONK"）
 *   `title` = 中文名（"僧人"）
 *   `description` = 解读长文；`greeting` = 一句话开场白
 * 所以按代码查要用 `name`，不是 `id`。
 */
function findSbti(code: string | null | undefined) {
  if (!code) return null;
  const want = code.trim().toUpperCase();
  return personalities.find((x) => String(x.name).trim().toUpperCase() === want) ?? null;
}

/**
 * 取某个 SBTI 人格的解析文案。
 *
 * 人格库（25 型：CTRL 拿捏者 / MONK 僧人 / DEAD 死者 …）本来就随项目带着
 * （`lib/sbti/data/personalities.json`），`description` 就是完整解读 ——
 * 直接拿来用，不需要去解析 skill 里的 markdown。
 */
export function sbtiBlurb(code: string | null | undefined): string | null {
  const p = findSbti(code);
  if (!p) return null;
  /* greeting + description：前者是那句点睛的短句，后者是完整解读 */
  const parts = [p.greeting?.trim(), p.description?.trim()].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

/** 取 SBTI 人格的中文名（僧人 / 拿捏者 …） */
export function sbtiTitle(code: string | null | undefined): string | null {
  return findSbti(code)?.title?.trim() ?? null;
}

/** 取 SBTI 人格的一句话开场白（"没有那种世俗的欲望。"） */
export function sbtiGreeting(code: string | null | undefined): string | null {
  return findSbti(code)?.greeting?.trim() ?? null;
}

/** 源的展示名（与人格卡上的六源命名保持一致） */
const SOURCE_LABEL: Record<string, string> = {
  zhihu: "知乎 · 公共表达",
  wechat: "微信 · 私域生活",
  qq: "QQ · 私域表达",
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
  sbti: "SBTI · 显性自评",
  profile: "公开资料",
  distill: "Agent 蒸馏",
};

/**
 * 展示顺序：先观察类源（按注入的常见顺序），再兜底六维，最后自评。
 * 自评放最后是有意的 —— 让人先看"观察到了什么"，再看"你自己怎么说"。
 */
const SOURCE_ORDER: Record<string, number> = {
  zhihu: 0,
  wechat: 1,
  qq: 2,
  feishu: 3,
  dingtalk: 4,
  profile: 5,
  sbti: 6,
};

export interface PersonaFacets {
  /**
   * 每个源各自解析出的 facet —— **含 SBTI**。
   * 产品要求 SBTI 也是人格数据，所以它在这份列表里占一席；
   * 它是不是"自报"由 `selfReportSources` 标明，不靠调用方猜。
   */
  sources: SourceFacet[];
  /** 其中属于**本人自报**的源（目前只有 sbti） */
  selfReportSources: string[];
  /** 其中属于**观察到的行为**的源（知乎/微信/QQ/飞书/钉钉…） */
  observedSources: string[];
  /** 参与融合的源里**只有自评**：此时综合画像约等于"把自评折算了一遍" */
  selfReportOnly: boolean;
  /** 多源融合出的六维 */
  fused: Partial<Record<ValueKey, number>>;
  /** 参与融合的源 */
  usedSources: string[];
  /** 由融合六维判定的人格倾向；数据不足时为 null（不硬猜） */
  type: TypeMatch | null;
  /** SBTI 自评那一面的展示信息（类型名 / 等级码 / 解读） */
  selfReport: {
    type: string | null;
    typeTitle: string | null;
    codes: string | null;
    /** 自评结果的一句话解读（来自 sbti-skill 的人格库） */
    blurb: string | null;
  } | null;
  /**
   * 体检结论。有两类"看着有数、其实没信息"的值会被挡在结论之外：
   *   · 自评维度零区分度（每题都答了同一档）
   *   · 跨源同值（几个源给出同一个数 = 这个信号根本没量到）
   */
  warnings: FacetWarning[];
  /** 因零区分度被排除在平均之外的源 */
  skippedSources: string[];
}

/** PersonaFeature 里存"分源解析结果"用的 key 前缀 */
const FACET_KEY_PREFIX = "facets:";

/**
 * 把一个源解析出的 facet **持久化**。
 *
 * ── 为什么必须写入时算、存下来，而不是读的时候再算 ────────────────────
 * `PersonaEvidence.note` 有长度限制，而且实际存进去的是**标题**
 * （实测 26 个真实用户的 note 平均只有 20 字，0 条 ≥120 字）。
 * 若读取时拿这些 note 反推"表达密度 / 长文比例 / 连接强度"，
 * 量到的其实是**标题长度**，不是这个人的特征。之前正是踩了这个坑：
 * 所有人的 learning 都是 0.03、creation 恒定，判定结果 19/24 挤在同一型。
 *
 * 正确做法：**写入时**算（那时手上有公开端点返回的完整正文与热度），
 * 之后读取只做组装，不再反推。
 */
export async function persistSourceFacet(personaId: string, facet: SourceFacet): Promise<void> {
  const key = `${FACET_KEY_PREFIX}${facet.source}`;
  await prisma.personaFeature.upsert({
    where: { personaId_key: { personaId, key } },
    update: { value: facet as never },
    create: { personaId, key, value: facet as never },
  });
}

/** 读回已持久化的分源解析结果 */
export async function loadSourceFacets(personaId: string): Promise<SourceFacet[]> {
  const rows = await prisma.personaFeature.findMany({
    where: { personaId, key: { startsWith: FACET_KEY_PREFIX } },
  });
  const out: SourceFacet[] = [];
  for (const r of rows) {
    const v = r.value as unknown as SourceFacet | null;
    if (v && typeof v === "object" && typeof v.source === "string" && v.values) out.push(v);
  }
  /* 顺序固定，避免每次刷新顺序乱跳 */
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * 读取一个人格的分源解析 + 综合画像。
 *
 * @param personaId 目标人格
 */
export async function buildPersonaFacets(personaId: string): Promise<PersonaFacets | null> {
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, personality: true, values: true },
  });
  if (!persona) return null;

  /**
   * 分源解析优先取**持久化的 facet**（写入时按完整原文算的，可信）。
   *
   * 没有持久化记录时的回退：用 `Persona.values` 当作一个整体源。
   * 演示人格的六维就是预置在那里的；真实用户若跑过整源蒸馏也会有。
   * **绝不拿被裁过的 note 硬算** —— 那只会产出假特征。
   */
  const loaded = await loadSourceFacets(personaId);
  /* SBTI 的 facet 一律**现算**：`personality.sbti` 是唯一事实来源，
     重测后会变；从库里读旧 facet 会拿到过期结论，故丢弃重算。 */
  const sources: SourceFacet[] = loaded.filter((f) => f.source !== "sbti");

  if (sources.length === 0) {
    const v = persona.values as Record<string, unknown> | null;
    const nums: Partial<Record<ValueKey, number>> = {};
    if (v && typeof v === "object") {
      for (const k of VALUE_KEYS) {
        const raw = v[k];
        if (typeof raw === "number" && Number.isFinite(raw)) nums[k] = raw;
      }
    }
    if (Object.keys(nums).length) {
      sources.push({
        source: "profile",
        label: "已有六维（无逐源明细）",
        values: nums,
        itemCount: 0,
        summary: "六个维度来自既有数据，暂无可展示的逐源解析。",
      });
    }
  }

  /* SBTI 自评的那一面（展示用）+ 折算成六维的 facet（参与融合用）。
     两者都来自同一条 `personality.sbti`，不会各说各话。 */
  const sbti = ((persona.personality ?? {}) as Record<string, unknown>).sbti as
    | {
        type?: string;
        typeTitle?: string;
        codes?: string;
        dimensions?: Record<string, { score?: number; level?: string }>;
      }
    | undefined;
  const selfReport = sbti?.type
    ? {
        type: sbti.type,
        typeTitle: sbti.typeTitle ?? null,
        codes: sbti.codes ?? null,
        blurb: sbtiBlurb(sbti.type),
      }
    : null;

  /**
   * ⭐ 产品要求：**SBTI 的结果也是人格数据，也要参与蒸馏。**
   *
   * 所以这里把 15 维折算成六维，作为一个和其它源同构的 facet 放进列表，
   * 一起交给 `fuseSourceFacets` —— 它会如实回报哪些源是自报。
   *
   * `facetFromSbti` 在**一个维度都提取不到**时返回 null。实测演示数据就是这种：
   * `personality.sbti` 里只有 `{type, codes}`，`codes` 还是占位串 ——
   * 从等级码反推分数会得到清一色 0.5，把 16 个演示人格的画像全拖向中间型。
   * 所以那种情况**宁可不出这一项**：SBTI 自评那面照常显示（上面的 `selfReport`），
   * 只是不假装自己有逐维数据。
   */
  const sbtiFacet = facetFromSbti(sbti?.dimensions, sbti?.codes, {
    typeTitle: sbti?.typeTitle,
    type: sbti?.type,
  });
  if (sbtiFacet) sources.push(sbtiFacet);

  /* 展示顺序固定，避免每次刷新顺序乱跳 */
  sources.sort(
    (a, b) =>
      (SOURCE_ORDER[a.source] ?? 99) - (SOURCE_ORDER[b.source] ?? 99) ||
      a.source.localeCompare(b.source),
  );

  const { fused, usedSources, selfReportSources, observedSources, warnings, skippedSources } =
    fuseSourceFacets(sources);

  /**
   * "是不是只有自评"要按**行为源**判，不能只看非自报源：
   * 一个只做过 SBTI 的用户会同时拿到 `profile`（上次蒸馏留下的六维，
   * 而那次蒸馏的证据本来就是 SBTI 自评），此时若按 `observedSources` 判，
   * 就会把"纯自评"说成"观察得出结论"。这里收窄到真正的行为源。
   */
  const behaviorSources = usedSources.filter(
    (s) => isObservedSource(s) && !selfReportSources.includes(s),
  );

  return {
    sources,
    selfReportSources,
    observedSources,
    selfReportOnly: behaviorSources.length === 0 && selfReportSources.length > 0,
    fused,
    usedSources,
    type: matchPersonaType(fused),
    selfReport,
    /** 体检结论（零区分度自评 / 跨源同值），界面据此解释"为什么少了一块" */
    warnings,
    skippedSources,
  };
}

/**
 * 取某个源解析出的兴趣方向（供展示"这个源里他关心什么"）。
 *
 * ⚠️ 这里用 note 是**可以的**：兴趣是"文本里出现了哪些领域词"，
 * 标题往往就足以判断（"金庸x苏轼" → 人文历史）。这与"用标题长度
 * 推断表达密度"完全不同 —— 后者是把长度当特征，前者只是关键词匹配。
 */
export async function sourceInterests(personaId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.personaEvidence.findMany({
    where: { personaId },
    select: { source: true, note: true },
  });
  const bySource = new Map<string, string[]>();
  for (const r of rows) {
    if (!isObservedSource(r.source)) continue;
    const note = (r.note ?? "").trim();
    if (note.length < 4) continue;
    const list = bySource.get(r.source) ?? [];
    list.push(note);
    bySource.set(r.source, list);
  }
  const out: Record<string, string[]> = {};
  for (const [source, texts] of bySource) {
    out[source] = interestFromContents(texts);
  }
  return out;
}
