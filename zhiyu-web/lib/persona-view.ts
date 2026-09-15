/**
 * 「人格视图」装配：把 Persona 记录整理成页面可直接渲染的形态。
 *
 * 为什么抽成共享模块：`/api/persona/[id]`、「我的人格」页与首页的人格总览
 * 都要用这套逻辑（完整度、六源注入状态、阶段、SBTI）。分散实现容易算出不一致的数字。
 */

import { prisma } from "@/lib/db";
import type { Persona, PersonaSource } from "@prisma/client";
import { computeCompleteness, type PersonaSourceType } from "@/lib/persona/completeness";
import { axesFromDimensions, axesFromObservedValues, axesHaveValue, type Axis, type RawDimScore } from "@/lib/sbti/axes";
import {
  BEHAVIOR_LABEL,
  type BehaviorFacet,
  type BehaviorKey,
  type MergedBehavior,
} from "@/lib/persona/behavior";
import { resolvePersonaType, type ResolvedPersonaType } from "@/lib/persona/type-source";
import { DIM_KEYS, DIM_LABEL, DIM_HOWTO, type DimSet } from "@/lib/persona/five-dims";

/** 雷达轴的固定顺序（七条，都由行为变量直接数出来） */
const RADAR_ORDER: BehaviorKey[] = [
  "initiative",
  "replySpeed",
  "activeDays",
  "lateNight",
  "lexical",
  "inquiry",
  "topicFocus",
];
import { buildPersonaFacets } from "@/lib/persona/source-facets";

/** 六个数据源与展示顺序（首页的「人格数据源」行、我的人格页都用它） */
export const SOURCE_TYPES: PersonaSourceType[] = [
  "wechat",
  "qq",
  "feishu",
  "dingtalk",
  "zhihu",
  "sbti",
];

export const SOURCE_LABELS: Record<PersonaSourceType, string> = {
  wechat: "微信",
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
  zhihu: "知乎",
  sbti: "SBTI",
};

export interface SbtiView {
  codes?: string;
  type?: string;
  typeTitle?: string;
  similarity?: number;
  fallback?: boolean;
  /** 15 个维度的原始分（SBTI 提交时写入） */
  dimensions?: Record<string, RawDimScore>;
}

export interface SourceChip {
  type: PersonaSourceType;
  label: string;
  status: string;
  /** 是否已注入（chip 上点亮圆点） */
  injected: boolean;
  importedAt: Date | null;
  /** 该源当前的证据条数（「覆盖」按钮用它告诉用户会删掉多少） */
  evidenceCount: number;
}

export interface PersonaBoard {
  id: string;
  displayName: string;
  kind: string;
  bio: string | null;
  completeness: number;
  coveredCategories: number;
  categories: Record<string, { covered: boolean; label: string; injected: PersonaSourceType[] }>;
  /** collecting | ready_for_distill */
  stage: string;
  sbti: SbtiView | null;
  /** 六个数据源按固定顺序列出（缺的也列，显示为未注入） */
  sourceChips: SourceChip[];
  injectedCount: number;
  /**
   * 五轴画像（逐维补全：多源融合值 → 蒸馏产物 → SBTI 自评聚合）。
   * 未做 SBTI 且没有任何数据时各轴 value 为 null —— 调用方据此显示"等待蒸馏"。
   */
  axes: Axis[];
  /**
   * 五轴的来源，**必须如实展示**：
   *   self-report = 本人做 SBTI 自评（"你眼中的自己"）
   *   observed    = 由公开内容观察推断（"公开内容里的你"）
   *   none        = 没有依据，不画
   * 两者含义不同，混着展示等于骗人。
   */
  axesSource: "self-report" | "observed" | "none";
  /**
   * 五轴里是否**含自评折算**成分。
   *
   * SBTI 现在参与融合（产品要求），所以"来自观察"不再等于"没有自评"。
   * `axesSource === "observed"` 且本字段为 true 时，界面要写成
   * "由公开内容观察推断（含 SBTI 自评折算）" —— 不能只说"非本人自评"。
   */
  axesIncludesSelfReport: boolean;
  /**
   * **综合画像**：把多源数据融合后判定的人格倾向。
   *
   * 与 `sbti` 是两件事，别混：
   *   · `sbti` 是本人自评问卷的结果（"僧人 MONK"，25 型沙雕人格之一）
   *   · `fused` 是多源融合出的倾向（六型之一：深度思考型 / 好奇探索型 …）
   * 之前页面把前者当成了综合画像，属于概念性错误。
   *
   * ⚠️ 2026-09 产品要求：**SBTI 也要算人格数据、也要参与融合**，
   * 所以 `usedSources` 里可能出现 `sbti`。但自评与观察性质不同，
   * 故另给 `selfReportSources` / `observedSources` / `selfReportOnly`：
   * 界面必须照实标注这份结论里有多少自评成分 —— 尤其 `selfReportOnly`
   * 为 true 时，等于"只听了你自己说的"，不能装作是观察结论。
   * 数据不足时为 null（不硬猜），界面显示"暂无数据"。
   */
  fused: {
    type: string;
    similarity: number;
    blurb: string;
    runnerUp: { type: string; similarity: number }[];
    /** 融合用了哪几个源 */
    usedSources: string[];
    /** 其中属于**本人自报**的源（SBTI） */
    selfReportSources: string[];
    /** 其中属于**非自报**的源 */
    observedSources: string[];
    /** 参与融合的源里**只有自评**：这份"综合画像"目前只反映自评 */
    selfReportOnly: boolean;
  } | null;
  /**
   * 蒸馏时由 LLM 判定的倾向型 + 原话依据（`fused` 为空时的展示来源）。
   * `type` 一定是六型之一；`evidence` 为空表示模型没给依据 → 界面不要显示型名。
   */
  judgedType: { type: string; evidence: string; judgedAt: string | null } | null;
  /**
   * ⭐ **倾向型的唯一取值口径**（判型 → 六维兜底 → SBTI → 无）。
   *
   * 首页 / 人格页 / 发现页 / 人格卡**必须**都读这个字段，不许各自决定优先级 ——
   * 实测事故：首页取 `fused`（务实执行型 60%）、人格页取 `judged`（深度思考型），
   * 同一个人在两处显示成两个型。见 lib/persona/type-source.ts。
   */
  resolvedType: ResolvedPersonaType;
  /**
   * **分源解析**：每个数据源各自解析出的特征与结论。**含 SBTI**。
   *
   * 产品要求："拿到某个源的数据后就该能解析出这个源里的人是什么样的"，
   * 并在「我的人格」页分别展示。facet 在**写入时**按完整原文算好并持久化
   * （见 lib/persona/source-facets.ts 的说明），这里只是取出来展示。
   */
  sourceFacets: {
    source: string;
    label: string;
    summary: string;
    itemCount: number;
    values: Record<string, number>;
    /** 该源只有标题、没有正文（依赖文本长度的维度因此缺失） */
    titleOnly: boolean;
    /** 缺维的**人话原因**（由解析层给出，界面照原样念，不自己猜） */
    partialReason: string | null;
    /** 该源是**本人自评**（SBTI），不是观察数据 —— 界面要标出来 */
    selfReport: boolean;
    /** 这份解析被体检判定"没有区分度"，因此**未计入**综合画像 */
    skippedFromFusion?: boolean;
  }[];
  /**
   * 数据体检结论。两类"看着有数、其实没信息"的值会被挡在结论之外：
   *   · 自评各维零区分度（每题都答了同一档）
   *   · 跨源同值（几个源给出同一个数 = 这个信号根本没量到）
   */
  facetWarnings: { code: string; text: string; sources: string[]; keys?: string[] }[];
  /** 因零区分度被排除在综合画像之外的源 */
  skippedSources: string[];
  /**
   * 可数行为变量（性格这一侧的新坐标系）。
   * `bySource` 按源列出，`merged` 是合并后的（个人属性平均、关系属性单列）。
   */
  behavior: {
    bySource: BehaviorFacet[];
    merged: MergedBehavior | null;
    /** @deprecated 雷达已改用五维；恒为 false，仅为兼容旧调用方 */
    radarIsBehavior: boolean;
  };
  /**
   * ⭐ **五维画像**（思考深度/表达力/共情力/执行力/主动性）——
   * 全站唯一的雷达坐标系：自己的人格页、首页模块、别人的人格卡都是这一组。
   * 某一维所有源都喂不出时 `values[key]` 不存在（界面显示 `—`）。
   */
  dims: {
    bySource: DimSet[];
    values: Partial<Record<string, number>>;
    evidence: Partial<Record<string, string>>;
    contributors: Partial<Record<string, string[]>>;
    /** 每一维"在问什么"，界面上要能一句话说清 */
    howto: Record<string, string>;
  };
  /** SBTI 自评那一面（与融合结论并列，不混为一谈） */
  selfReport: {
    type: string | null;
    typeTitle: string | null;
    codes: string | null;
    blurb: string | null;
  } | null;
}

/**
 * 读取并整理一个人设。
 *
 * 副作用：完整度与库中不一致时会顺带回写（沿用原有行为）。
 *
 * @param preloaded 调用方已查过的 persona（含 sources）。
 *   传进来可省一次数据库往返 —— Neon 在新加坡，单次往返约 100~200ms，
 *   而首页既要人格卡又要发现预览，不共享的话同一个 persona 会查两遍。
 */
export async function buildPersonaBoard(
  personaId: string,
  preloaded?: (Persona & { sources: PersonaSource[] }) | null,
): Promise<PersonaBoard | null> {
  const persona =
    preloaded !== undefined
      ? preloaded
      : await prisma.persona.findUnique({
          where: { id: personaId },
          include: { sources: true },
        });
  if (!persona) return null;

  const injected = persona.sources
    .filter((s) => s.status === "injected")
    .map((s) => s.type as PersonaSourceType);
  const completeness = computeCompleteness(injected);

  /* 完整度是派生值，与库中不一致时回写，保证列表页读到的是最新值 */
  if (Math.abs((persona.completeness ?? 0) - completeness.percent) > 0.001) {
    await prisma.persona.update({
      where: { id: persona.id },
      data: { completeness: completeness.percent },
    });
  }

  const byType = new Map(persona.sources.map((s) => [s.type as PersonaSourceType, s]));

  /**
   * 每个源当前有多少条证据。
   *
   * 为什么要：导入弹窗在「覆盖」模式下要如实告诉用户"会删掉上次的 N 条"，
   * 而不是笼统说"会删掉上次的全部数据" —— 数字能让人立刻确认自己按对了按钮。
   */
  const evidenceCounts = await prisma.personaEvidence.groupBy({
    by: ["source"],
    where: { personaId: persona.id },
    _count: { _all: true },
  });
  const evidenceBySource = new Map(
    evidenceCounts.map((r) => [r.source, r._count._all] as const),
  );

  const sourceChips: SourceChip[] = SOURCE_TYPES.map((type) => {
    const row = byType.get(type);
    return {
      type,
      label: SOURCE_LABELS[type],
      status: row?.status ?? "not_injected",
      injected: row?.status === "injected",
      importedAt: row?.importedAt ?? null,
      evidenceCount: evidenceBySource.get(type) ?? 0,
    };
  });

  const personality = (persona.personality ?? {}) as Record<string, unknown>;
  const sbti = (personality.sbti ?? null) as SbtiView | null;

  /* SBTI 自评的 15 维 → 五轴。它只作为**没有观察数据时**的画像来源，
     优先级低于多源融合（见下方 fusedAxes）。 */
  const axesFromSbti = axesFromDimensions(sbti?.dimensions);

  /* 综合画像：由**多源证据**融合后判定人格倾向。
     2026-09 产品要求把 SBTI 也纳入融合（自评也是人格数据），
     所以这里不再排除 sbti —— 但 `selfReportSources` / `selfReportOnly`
     会如实回报自评占比，页面据此标注，不让自评冒充观察结论。 */
  const facets = await buildPersonaFacets(persona.id);

  /**
   * **LLM 判定的倾向型**（蒸馏时读懂证据后给的结论 + 原话依据）。
   *
   * 为什么单独拿出来：六维融合已经量不出价值观（③ 之后 fused 常为空），
   * 而"人格倾向"这个产品概念还得有 —— 但不能没有理由地给一个。
   * 所以判定与依据成对出现：有依据才显示型名，没依据就显示"暂不判定"。
   */
  const judgedType = (() => {
    const p = personality as Record<string, unknown>;
    const t = typeof p.type === "string" ? p.type.trim() : "";
    const evidence = typeof p.typeEvidence === "string" ? p.typeEvidence.trim() : "";
    if (!t) return null;
    return { type: t, evidence, judgedAt: (p.typeJudgedAt as string) ?? null };
  })();
  const fused = facets?.type
    ? {
        type: facets.type.type,
        similarity: facets.type.similarity,
        blurb: facets.type.blurb,
        runnerUp: facets.type.runnerUp.map((r) => ({ type: r.type, similarity: r.similarity })),
        usedSources: facets.usedSources,
        selfReportSources: facets.selfReportSources,
        observedSources: facets.observedSources,
        selfReportOnly: facets.selfReportOnly,
      }
    : null;

  /**
   * ⭐ **倾向型的唯一口径**：判型 → 六维兜底 → SBTI → 无。
   *
   * 首页 / 人格页 / 发现页 / 人格卡全部读它。之前首页自己取 `fused`、
   * 人格页取 `judged`，同一个人在两处显示成两个型（实测被投诉）。
   */
  const resolvedType = resolvePersonaType({ personality, fused });

  /**
   * 雷达取值的优先级（逐维）：
   *   ① 多源融合值（`facets.fused`）
   *   ② 蒸馏产物 `Persona.values`（LLM 归纳）
   *   ③ SBTI 自评的 15 维聚合（前两者都给不出时才用）
   *
   * ⚠️ **被体检挡掉的维度不参与**：跨源同值的维（= 信号根本没量到）与
   * 零区分度自评的维，在 `buildPersonaFacets` 里已经被排除出 `fused`；
   * 这里再用 `Persona.values` 去补，就会把刚挡掉的那个假数字又请回来。
   * 所以下面多一道 `blanked` 过滤。
   */
  const blanked = new Set<string>();
  for (const w of facets?.warnings ?? []) {
    for (const k of w.keys ?? []) blanked.add(k);
  }
  const skipped = new Set(facets?.skippedSources ?? []);

  /**
   * 雷达画什么：**逐维补全**，而不是整组二选一。
   *
   * 每一维单独按优先级取值：
   *   ① 多源融合值（`facets.fused`，含 SBTI 折算 —— 产品要求它参与）
   *   ② 蒸馏产物 `Persona.values`（LLM 归纳，证据包里可能含自评）
   *   ③ SBTI 自评的 15 维聚合（前两者都给不出时才用）
   *
   * ⚠️ 为什么必须逐维补：曾经写成"整体优先融合值"，于是某个源只算出 2 维
   * （知乎只返回标题 → 依赖文本长度的三维如实留空）时，雷达就只剩 2 条轴、
   * 另外 3 条变 `—`。用户重新蒸馏后看到的就是"雷达图被干没了"（实际被投诉）。
   * 分源缺维是**正常情况**，不该拖垮整张图。
   */
  const mergedValues: Record<string, number> = {};
  const personaValues = (persona.values ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(personaValues)) {
    /* 被体检判定为"信号没量到"的维度，**不要**用 LLM 的旧值补回来 */
    if (blanked.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) mergedValues[k] = v;
  }
  /* 融合值覆盖同名的蒸馏值（逐维，融合值更接近原始观察） */
  for (const [k, v] of Object.entries(facets?.fused ?? {})) {
    if (blanked.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) mergedValues[k] = v;
  }

  const mergedAxes = axesFromObservedValues(mergedValues);

  /**
   * ⭐ 雷达画什么：**写死的五维**（思考深度/表达力/共情力/执行力/主动性）。
   *
   * 三次改动的终点：
   *   ① 最早画"价值观五轴"（自我/情感/观念/行动/社交）—— 由文本形态反推，
   *      实测在真实数据上量不出东西（③ 之后融合值为空）；
   *   ② 改成七个"行为变量"—— 只适用于有对话、有时间戳的数据，
   *      于是那张"综合画像"雷达实际上只由微信/QQ 一个源支撑，
   *      又犯了"把单一数据源当综合画像"的错；
   *   ③ 现在这五个词每个源都喂得动（知乎按标题、SBTI 按 15 维、聊天按对话），
   *      而且**自己的人格页 / 首页 / 别人的人格卡画的是同一组**。
   *
   * 某个源喂不出某一维就留空（`value = null`，界面 `—`），不给 0、不给 0.5。
   */
  const dimsMerged = facets?.dims?.merged;
  const fiveAxes: Axis[] = DIM_KEYS.map((k) => {
    const v = dimsMerged?.values?.[k];
    return {
      key: k,
      label: DIM_LABEL[k],
      value: typeof v === "number" ? v : null,
      parts: typeof v === "number" ? [{ key: k, normalized: v }] : [],
    };
  });
  /** 有几维有值（雷达组件少于 3 个点连不成面） */
  const dimsReady = fiveAxes.filter((a) => a.value != null).length >= 3;
  /**
   * 雷达用**五维**（上面已算好 `fiveAxes`）。
   *
   * 七个行为变量不再当雷达：它们只适用于"有对话、有时间戳"的源，
   * 拿它当综合画像等于让微信一个源代表整个人（而且别人的卡没有这些数据，
   * 于是又退回旧坐标系 —— 实测被投诉"只改了我自己，别人的没改"）。
   * 五个点凑不齐（<3 维有值）时才退回旧口径，别给一张空图。
   */
  const axes = dimsReady
    ? fiveAxes
    : axesHaveValue(mergedAxes)
      ? mergedAxes
      : axesFromSbti;
  /**
   * 五轴的来源必须如实标注。
   * SBTI 也进融合，所以"有值"不等于"来自观察" ——
   * 若五个词全部只由自评喂出来（没有任何行为源），要标成自评。
   */
  const observedDims = (facets?.dims?.bySource ?? []).filter((d) => d.source !== "sbti");
  const axesSource: "self-report" | "observed" | "none" = axesHaveValue(axes)
    ? dimsReady
      ? observedDims.length > 0
        ? "observed"
        : "self-report"
      : axesHaveValue(mergedAxes)
        ? facets?.selfReportOnly
          ? "self-report"
          : "observed"
        : "self-report"
    : "none";

  /* 图上到底有没有自评成分：只要 SBTI 的 facet 参与了融合，就有 */
  const axesIncludesSelfReport =
    axesHaveValue(mergedAxes) && (facets?.selfReportSources.length ?? 0) > 0;

  return {
    id: persona.id,
    displayName: persona.displayName,
    kind: persona.kind,
    bio: persona.bio,
    completeness: completeness.percent,
    coveredCategories: completeness.coveredCategories,
    categories: completeness.categories,
    stage: injected.length === 0 ? "collecting" : "ready_for_distill",
    sbti,
    sourceChips,
    injectedCount: injected.length,
    /* 五轴来自 SBTI 自评，或回退到公开内容的观察值 —— 都是真实数据，不是占位 */
    axes,
    axesSource,
    axesIncludesSelfReport,
    fused,
    /**
     * 蒸馏时判定的倾向型 + 依据。`fused` 为空时界面用它显示"人格倾向"，
     * 并**必须**把 `evidence` 一起显示出来（没有依据的型名等于编）。
     */
    judgedType,
    /* ⭐ 唯一口径：四处都读它（见上方字段说明） */
    resolvedType,
    /**
     * 数据体检结论（零区分度自评 / 跨源同值）。
     * 界面要如实说出来 —— "为什么这一维没有"比"编一个数"重要。
     */
    facetWarnings: facets?.warnings ?? [],
    /** 因零区分度被排除在综合画像之外的源（展示时标注"未计入综合画像"） */
    skippedSources: facets?.skippedSources ?? [],
    behavior: {
      bySource: facets?.behavior?.bySource ?? [],
      merged: facets?.behavior?.merged ?? null,
      /** @deprecated 雷达已改用五维；保留字段只为兼容旧调用方 */
      radarIsBehavior: false,
    },
    /**
     * ⭐ **五维画像**（写死的五个词）—— 全站唯一的雷达坐标系。
     * 自己的人格页 / 首页模块 / 别人的人格卡画的都是这一组。
     */
    dims: {
      bySource: facets?.dims?.bySource ?? [],
      values: facets?.dims?.merged?.values ?? {},
      evidence: facets?.dims?.merged?.evidence ?? {},
      contributors: facets?.dims?.merged?.contributors ?? {},
      howto: DIM_HOWTO,
    },
    sourceFacets: (facets?.sources ?? []).map((f) => ({
      source: f.source,
      label: f.label,
      summary: f.summary,
      itemCount: f.itemCount,
      /**
       * ⚠️ 被体检判定"跨源同值 / 零区分度"的维度**在卡片上也不显示**。
       * 只把融合结果置空是不够的：用户看到的是卡片上那根 99% 的条，
       * 而它恰恰是"所有源都给出同一个数"的那个假信号（实测微信/QQ 的
       * 创造表达都是 0.99 —— 因为证据在导入时已去重，这个指标恒为 1）。
       */
      values: Object.fromEntries(
        Object.entries(f.values).filter(
          ([k, v]) => typeof v === "number" && !blanked.has(k) && !skipped.has(f.source),
        ) as [string, number][],
      ),
      titleOnly: f.titleOnly === true,
      partialReason: f.partialReason ?? null,
      selfReport: (facets?.selfReportSources ?? []).includes(f.source),
      /** 这份 facet 有没有被排除在综合画像之外（零区分度自评） */
      skippedFromFusion: (facets?.skippedSources ?? []).includes(f.source),
    })),
    selfReport: facets?.selfReport ?? null,
  };
}
