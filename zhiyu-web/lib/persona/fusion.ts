/**
 * 「综合画像」——把多源数据融合后的结论。
 *
 * ── 必须区分的两个概念（这里曾经做错过）──────────────────────────────
 *   ① **SBTI 结果**：本人做 30 题自评得到的沙雕人格（如「僧人 MONK」）。
 *      它是**自评**，只是六源之一，**不是**综合画像。
 *   ② **综合画像**：把知乎/微信/QQ/飞书/钉钉等**观察到的**数据蒸馏融合后，
 *      判定这个人属于哪一种**人格倾向**。
 *
 * 之前的实现把 ① 直接当成 ② —— 页面上「综合画像 · 融合特征」里显示的
 * 类型徽章其实是 SBTI 的自评结果。后果：
 *   · 用户明明有知乎数据，综合画像却只反映一份自评问卷
 *   · 发现页的「人格倾向」筛选对真实用户几乎筛不出东西
 *
 * ── 六种人格倾向 ──────────────────────────────────────────────────────
 * 与发现页搜索栏的「人格倾向」筛选项**完全一致**（同一份定义，不要各写一份）：
 *   深度思考型 / 好奇探索型 / 温和共情型 / 理性辩手型 / 体验派 / 务实执行型
 *
 * 每一种都由一组「六维价值观原型」定义（learning/creation/career/social/
 * stability/autonomy）。判定方式 = 找与本人六维向量**最接近**的原型。
 * 这组原型值原先只存在于 `scripts/seed-demo.mjs`（给 16 个演示人格用的），
 * 现在提到这里作为**唯一来源**，演示数据与真实用户判定共用同一套基准。
 */

import { clampPercent } from "@/lib/score";
import { inspectFacets, type FacetWarning } from "./sanity";

/* 体检类型从 sanity 转出去，调用方不必知道它是哪个文件定义的 */
export type { FacetWarning };

/** 六维价值观的键（顺序固定，便于展示与比较） */
export const VALUE_KEYS = [
  "learning",
  "creation",
  "career",
  "social",
  "stability",
  "autonomy",
] as const;

export type ValueKey = (typeof VALUE_KEYS)[number];

/** 六维价值观的中文名 */
export const VALUE_LABEL: Record<string, string> = {
  learning: "学习成长",
  creation: "创造表达",
  career: "事业成就",
  social: "社交连接",
  stability: "稳定安全",
  autonomy: "独立自主",
};

export type PersonaType =
  | "深度思考型"
  | "好奇探索型"
  | "温和共情型"
  | "理性辩手型"
  | "体验派"
  | "务实执行型";

/** 每种倾向的原型六维（0~1）+ 一句话说明 */
export interface TypeArchetype {
  type: PersonaType;
  /** 该倾向的典型六维取值 */
  values: Record<ValueKey, number>;
  /** 一句话特征，用于卡片与提示 */
  blurb: string;
}

/**
 * 六型原型。数值即 `seed-demo.mjs` 里一直在用的那组，
 * 搬过来是为了让"演示人格"和"真实用户判定"用同一套基准 ——
 * 否则演示数据自洽、真实用户却按另一套标准判型，两边没法比。
 */
export const TYPE_ARCHETYPES: TypeArchetype[] = [
  {
    type: "深度思考型",
    values: { learning: 0.92, creation: 0.7, career: 0.5, social: 0.32, stability: 0.55, autonomy: 0.82 },
    blurb: "习惯先把事情想清楚再开口，重推理过程而非结论",
  },
  {
    type: "好奇探索型",
    values: { learning: 0.9, creation: 0.78, career: 0.52, social: 0.62, stability: 0.34, autonomy: 0.74 },
    blurb: "随时在收集新问题，喜欢把不同领域放在一起聊",
  },
  {
    type: "温和共情型",
    values: { learning: 0.6, creation: 0.52, career: 0.44, social: 0.9, stability: 0.7, autonomy: 0.42 },
    blurb: "对情绪与细节敏感，更愿意先接住对方再谈事",
  },
  {
    type: "理性辩手型",
    values: { learning: 0.8, creation: 0.58, career: 0.66, social: 0.5, stability: 0.46, autonomy: 0.78 },
    blurb: "享受观点被认真挑战，讨论时先立论再反驳",
  },
  {
    type: "体验派",
    values: { learning: 0.66, creation: 0.72, career: 0.48, social: 0.74, stability: 0.3, autonomy: 0.8 },
    blurb: "更相信亲历而不是想象，先做再说",
  },
  {
    type: "务实执行型",
    values: { learning: 0.56, creation: 0.6, career: 0.86, social: 0.46, stability: 0.8, autonomy: 0.6 },
    blurb: "先看能不能落地，讨厌把简单的事流程化",
  },
];

/** 供下拉/筛选用（顺序即展示顺序） */
export const PERSONA_TYPES: PersonaType[] = TYPE_ARCHETYPES.map((a) => a.type);

/** 判断一个字符串是不是合法的倾向型（用于校验外部输入） */
export function isPersonaType(v: unknown): v is PersonaType {
  return typeof v === "string" && (PERSONA_TYPES as string[]).includes(v);
}

export interface TypeMatch {
  type: PersonaType;
  /** 0~100，越接近该原型越高 */
  similarity: number;
  /** 该倾向的一句话特征 */
  blurb: string;
  /** 排名前几的候选，便于展示"为什么是这一型" */
  runnerUp: { type: PersonaType; similarity: number }[];
}

/**
 * 由六维价值观判定人格倾向。
 *
 * 距离用**归一化欧氏距离**：六个维度各差值的平方和开根，再除以最大可能距离
 * （六个维度全 0 vs 全 1 时为 √6），把结果压到 0~1，相似度 = (1 - 距离) × 100。
 *
 * 为什么不用"各维取最大"之类的简单规则：六个原型在个别维度上会交叉
 * （比如 深度思考型 与 理性辩手型 的 learning 都偏高），只有整体距离
 * 才能区分开。
 *
 * @param values 融合后的六维；缺失维度按 0.5（中性）处理 —— 不因缺数据就偏向某一型
 * @returns 最接近的倾向；**没有任何有效维度时返回 null**（不硬猜）
 */
export function matchPersonaType(
  values: Record<string, unknown> | null | undefined,
): TypeMatch | null {
  const src = (values ?? {}) as Record<string, unknown>;
  const nums = VALUE_KEYS.map((k) => {
    const v = src[k];
    return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
  });

  /* 一个有效维度都没有 → 明确返回 null，让界面显示"暂无数据"而不是编一个型 */
  if (nums.every((n) => n === null)) return null;

  const effective = nums.map((n) => n ?? 0.5);

  const scored = TYPE_ARCHETYPES.map((a) => {
    const sq = VALUE_KEYS.reduce((sum, k, i) => {
      const d = effective[i] - a.values[k];
      return sum + d * d;
    }, 0);
    const dist = Math.sqrt(sq) / Math.sqrt(VALUE_KEYS.length);
    return { type: a.type, arch: a, similarity: Math.round((1 - dist) * 100) };
  }).sort((x, y) => y.similarity - x.similarity);

  const best = scored[0];
  return {
    type: best.type,
    similarity: best.similarity,
    blurb: best.arch.blurb,
    runnerUp: scored.slice(1, 3).map((s) => ({ type: s.type, similarity: s.similarity })),
  };
}

/* ── 分源解析 ──────────────────────────────────────────────────────────── */

/**
 * SBTI 的 15 个维度 → 它的**六维价值观**。
 *
 * 为什么需要这一层：SBTI 的雷达轴（自我/情感/观念/行动/社交）与
 * "综合画像"用的六维价值观（learning/creation/career/social/stability/autonomy）
 * **不是同一套坐标系**，直接拿 SBTI 的类型名当综合画像，就是之前那个概念错误。
 * 只有把 15 维折算到六维，SBTI 才能作为**一个数据源**参与蒸馏与融合
 * （产品要求："SBTI 的结果也要列为人格数据，也要进行蒸馏"）。
 *
 * 映射依据是每个维度的中文语义，不是凑数：
 *   autonomy  独立自主 ← 自我清晰度 + 核心价值 + 动机导向 + 执行模式
 *                        （对自己要什么清楚、且按自己的动机行事）
 *   learning  学习成长 ← 世界观倾向 + 人生意义感 + 自我清晰度
 *                        （世界怎么运转、活着为什么、我是谁 —— 都是"想弄明白"）
 *   creation  创造表达 ← 规则与灵活度 + 表达与真实度
 *                        （不循规蹈矩、愿意真实表达）
 *   stability 稳定安全 ← 自尊自信 + 依恋安全感 + 人际边界感 + 执行模式
 *                        （内心稳、关系稳、有边界、能落地）
 *   social    社交连接 ← 情感投入度 + 边界与依赖 + 社交主动性 + 表达与真实度
 *   career    事业成就 ← **无对应维度**
 *                        （这份题库没有职业取向题，所以不给值、不编造）
 */
const SBTI_TO_VALUES: Record<ValueKey, string[]> = {
  autonomy: ["S2", "S3", "Ac1", "Ac3"],
  learning: ["A1", "A3", "S2"],
  creation: ["A2", "So3"],
  stability: ["S1", "E1", "So2", "Ac3"],
  social: ["E2", "E3", "So1", "So3"],
  career: [],
};

/** 把 0~1 的值收进 [0.01, 0.99]（展示层不许出现 0%/100%） */
const toDisplayUnit = (x: number) => Math.max(0.01, Math.min(0.99, x));

/**
 * 从 SBTI 的作答里提取"每个维度的归一化值（0~1）"。
 *
 * 兼容两种落库形态（都来自**真实提交**，`app/api/sbti/submit` 写的就是第一种）：
 *   · `{ S1: { score: 4, level: "M" } }` —— submit 路由写的
 *   · `{ S1: 4 }`                          —— 早期/精简形态
 *
 * ⚠️ **不从 `codes` 反推**（曾经这么干过，是错的）。
 * 等级码是 `score` 的函数，拿它反推分数属于把导数当原函数：
 *   · 演示数据里的 `codes` 是**占位串**（如 `MMM-MMM-MMM-MMM-MMM`），
 *     反推出来是清一色 0.5，于是 16 个演示人格的 SBTI 都成了"全面中性"，
 *     一进融合就把它们各自预置的画像拖向中间型（实测全变成"理性辩手型"）。
 *   · 真实的 `{score, level}` 本来就在库里，没有反推的必要。
 * 所以：**没有 dimensions 就没有 SBTI 分源解析** —— 缺就如实缺，不编。
 *
 * @returns 维度 key → 0~1；拿不到任何维度时返回空对象
 */
export function sbtiDimensionUnits(dimensions: unknown): Record<string, number> {
  const out: Record<string, number> = {};

  if (dimensions && typeof dimensions === "object" && !Array.isArray(dimensions)) {
    for (const [k, v] of Object.entries(dimensions as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = (v - 2) / 4; // DIM_MIN=2, DIM_MAX=6
      } else if (v && typeof v === "object") {
        const rec = v as { score?: unknown; level?: unknown };
        if (typeof rec.score === "number" && Number.isFinite(rec.score)) {
          out[k] = (rec.score - 2) / 4;
        } else if (typeof rec.level === "string") {
          out[k] = levelUnit(rec.level);
        }
      }
    }
  }

  /* 统一收到 [0.01, 0.99] */
  for (const k of Object.keys(out)) out[k] = toDisplayUnit(out[k]);
  return out;
}

/** 等级字母 → 0~1（L/M/H 取组中点，避免又出现 0 和 1） */
function levelUnit(level: string): number {
  const c = level.trim().toUpperCase()[0];
  if (c === "L") return 0.25;
  if (c === "H") return 0.75;
  return 0.5;
}

/**
 * 把 SBTI 的 15 维折算成**六维价值观**，产出一个和其它源同构的 facet。
 *
 * 这样 SBTI 就能像知乎/微信一样参与：分源解析展示、多源融合、以及
 * 交给 LLM 蒸馏时作为独立来源的权重。
 *
 * @param dimensions `personality.sbti.dimensions`（**必须来自真实提交**）
 * @param codesFormatted 15 位等级码，仅用于 summary 里展示依据
 * @param extra 展示补充信息（类型名等），只用于 label
 * @returns facet；**一个维度都提取不到时返回 null**（不编造、不从等级码反推）
 */
export function facetFromSbti(
  dimensions: unknown,
  codesFormatted?: string | null,
  extra?: { typeTitle?: string | null; type?: string | null; itemCount?: number },
): SourceFacet | null {
  const units = sbtiDimensionUnits(dimensions);
  const keys = Object.keys(units);
  if (keys.length === 0) return null;

  const values: Partial<Record<ValueKey, number>> = {};
  for (const [valueKey, sbtiKeys] of Object.entries(SBTI_TO_VALUES) as [
    ValueKey,
    string[],
  ][]) {
    const picked = sbtiKeys.map((k) => units[k]).filter((v): v is number => typeof v === "number");
    if (picked.length === 0) continue; // 该维无对应题目 → 留空，不用中性值凑
    values[valueKey] = toDisplayUnit(picked.reduce((s, x) => s + x, 0) / picked.length);
  }

  const label = extra?.typeTitle
    ? `SBTI · 显性自评（${extra.typeTitle}${extra.type ? ` / ${extra.type}` : ""}）`
    : "SBTI · 显性自评";

  return {
    source: "sbti",
    label,
    values,
    /* "依据条数"对问卷没有意义，用参与折算的维度数更诚实 */
    itemCount: keys.length,
    /* 纯文本，不要写 markdown 记号 —— 这段会原样渲染在卡片上
       （之前写了 `**本人自报**`，界面上就是一堆星号） */
    summary:
      `自评问卷 ${keys.length} 个维度折算而来（${codesFormatted ?? "无等级码"}）。` +
      `这是本人自报，与其它源的观察数据含义不同 —— 融合时会一并标注来源。`,    titleOnly: false,
  };
}

/**
 * 参与「综合画像」的源。
 *
 * ⚠️ SBTI **在列**（产品明确要求：SBTI 的结果也是人格数据，也要参与蒸馏）。
 * 但它与其它源的性质不同 —— 它是**本人自报**，其它是**观察到的行为**。
 * 所以融合结果里会带 `selfReportSources`，界面照实标注
 * "这版画像含自评成分"，不让自评冒充观察结论。
 */
export const OBSERVED_SOURCES = [
  "zhihu",
  "wechat",
  "qq",
  "feishu",
  "dingtalk",
  "sbti",
] as const;

/** 其中属于"本人自报"的源 */
export const SELF_REPORT_SOURCES: readonly string[] = ["sbti"];

export type ObservedSource = (typeof OBSERVED_SOURCES)[number];

export function isObservedSource(s: string): s is ObservedSource {
  return (OBSERVED_SOURCES as readonly string[]).includes(s);
}

/** 单个源解析出的结果 */
export interface SourceFacet {
  source: string;
  /** 该源的展示名 */
  label: string;
  /** 该源推断出的六维（只含算得出来的维度） */
  values: Partial<Record<ValueKey, number>>;
  /** 该源贡献了几条内容（展示"依据多少数据"） */
  itemCount: number;
  /** 该源的一句话结论 */
  summary: string;
  /**
   * 是否只有标题、没有正文。
   * 为 true 时 `values` 里不含依赖文本长度的那几维（学习/创造/稳定），
   * 因为标题长度不携带表达特征 —— 缺就如实缺着，不用噪声凑数。
   */
  titleOnly?: boolean;
  /**
   * 缺维的**人话原因**（展示在「未覆盖」旁边）。
   *
   * 为什么单独一个字段：缺维的原因不止"只有标题"一种。
   * 手动导入的聊天/文档走 `profile: "im"`，缺的是"学习成长"与"社交连接"，
   * 原因和标题无关。把原因写成数据，界面照原样念出来，
   * 比在组件里按 `titleOnly` 猜一句话要诚实。
   */
  partialReason?: string;
}

/** 某个源的一条内容（正文 + 互动量），用于按源解析 */
export interface SourceContent {
  text: string;
  /** 点赞等热度，用于估算连接强度 */
  heat?: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * 把画像维度值收进 [0.01, 0.99]。
 *
 * 界面上不许出现 0% / 100%（最多 99%、最少 1%），所以在**算出来的那一刻**
 * 就收边界，而不是让每个展示处各自记得处理 —— 展示路径有雷达、进度条、
 * 分源卡、匹配度好几条，靠"每处都记得"必然漏。
 *
 * 与 `clamp01` 的区别：`clamp01` 是数学上的 0~1，这个再向内收 1%。
 */
const clampDisplay = (x: number) => Math.max(0.01, Math.min(0.99, clamp01(x)));

/**
 * 领域词典：命中即认为与该领域相关（与 `scripts/backfill-real-zhihu.mjs`、
 * `distill-real-people.mjs` 用的是同一套，改这里要三处一起改，
 * 否则"按源解析"与"回填脚本"算出的兴趣会不一致）。
 */
export const DOMAIN_LEXICON: Record<string, string[]> = {
  人工智能: ["AI", "人工智能", "大模型", "模型", "算法", "智能体", "agent", "Agent", "机器学习"],
  产品设计: ["产品", "体验", "交互", "设计", "用户反馈", "功能", "界面"],
  编程开发: ["代码", "编程", "开发", "程序员", "开源", "写代码", "架构", "调试"],
  创业商业: ["创业", "商业", "增长", "运营", "市场", "融资", "变现"],
  职场成长: ["职场", "工作", "效率", "成长", "管理", "协作"],
  知识科普: ["科普", "原理", "为什么", "解释", "研究", "论文", "科学"],
  人文历史: ["历史", "文化", "文学", "哲学", "思想", "社会"],
  生活日常: ["生活", "日常", "周末", "吃饭", "旅行", "开心", "心情"],
};

/** 命中词典的兴趣方向（按命中次数降序） */
export function interestsFromTexts(texts: string[]): string[] {
  return [...interestCountsFromTexts(texts)]
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);
}

/**
 * 命中词典的兴趣方向 → **次数**。
 *
 * 为什么要次数：集中度不能只看"命中几个领域"，还要看分布是否均匀。
 * 八个领域各命中一次，和一个领域命中八次，是完全不同的两种人。
 * 之前用 `1-(领域数-1)/8` 把这两者算成同一个值，还顺手造出 99% 这种极端值。
 */
export function interestCountsFromTexts(texts: string[]): Map<string, number> {
  const hits = new Map<string, number>();
  for (const t of texts) {
    for (const [domain, words] of Object.entries(DOMAIN_LEXICON)) {
      if (words.some((w) => t.includes(w))) hits.set(domain, (hits.get(domain) ?? 0) + 1);
    }
  }
  return hits;
}

/**
 * 话题集中度（0~1）：HHI 归一化，1 = 只聊一个方向，0 = 各方向完全均分。
 *
 * 公式：`p_d = 该领域命中次数 / 总命中次数`，`HHI = Σ p_d²`，
 * 再按**观测到的领域数 D** 归一化：`(HHI - 1/D) / (1 - 1/D)`。
 * 这样"均匀分布"永远落在 0，"独占"永远落在 1，与 D 的大小无关 ——
 * 而旧公式 `1-(D-1)/8` 里那个 8 是词典长度，纯属拍脑袋，
 * 并且只要命中 1 个领域就直接顶到 1.0（界面上就是 99%）。
 *
 * @returns 0~1；**命中领域数 < 2 时返回 null** —— 一个领域谈不上"集中"还是"分散"，
 *          这种情况该留空，而不是报 99%。
 */
export function topicConcentration(counts: Map<string, number>): number | null {
  const vals = [...counts.values()].filter((v) => v > 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (vals.length < 2 || total <= 0) return null;
  const hhi = vals.reduce((s, c) => s + (c / total) ** 2, 0);
  const d = vals.length;
  return clamp01((hhi - 1 / d) / (1 - 1 / d));
}

/**
 * 互动强度是否真的量到了。
 *
 * `heat` 全是 0 有两种可能：① 这个源确实没人点赞；② 这个源根本没有互动量字段。
 * 两者从数据上分不开，但都不该输出"社交连接 1%"这种断言 ——
 * 把"没量到"说成"量出来很低"是这个项目反复踩的同一个坑。
 * 判据：**非零热度的条目占比 ≥ 10%** 才算有信号。
 */
export function hasHeatSignal(heats: number[], minRatio = 0.1): boolean {
  if (heats.length === 0) return false;
  const nonZero = heats.filter((h) => h > 0).length;
  return nonZero / heats.length >= minRatio;
}

/** `interestsFromTexts` 的别名：调用处读作"从这批内容里取兴趣"更顺 */
export const interestFromContents = interestsFromTexts;

/**
 * 从**一批内容**按源解析出该源的六维与结论。
 *
 * 每一维都由可观测信号推断：
 *   learning   ← 平均字数（表达密度）　　　※ 仅标题时**不可用**
 *   creation   ← 长文比例　　　　　　　　　※ 仅标题时**不可用**
 *   social     ← 平均互动（连接强度）　　　※ **没有互动量的源不可用**
 *   stability  ← **内容一致性**（篇幅是否稳定）※ 仅标题时**不可用**
 *   autonomy   ← 领域集中度（聚焦 vs 泛化）
 *   career     ← 不推断（公开内容看不出职业取向）
 *
 * ⚠️ `titleOnly` 的意义（知乎源必须传 true）：
 *   开放平台的 `contents` 只返回标题，**没有正文**。若拿标题长度去算
 *   "表达密度/长文比例/内容一致性"，量到的是标题长度（几乎恒定），
 *   等于用噪声当特征 —— 实测就出过这个事故：所有人的 learning 都是 0.03、
 *   creation 恒定，最终 24 个判型里 19 个挤在同一型。
 *   所以标记为仅标题时，这三维**留空**，由别的源去补，而不是编一个值。
 *
 * ⚠️ `noHeat` 的意义（手动导入的微信/QQ/飞书/钉钉必须传 true）：
 *   私域聊天与工作文档**没有公开互动量**。不标记的话 `heat` 全按 0 算，
 *   于是所有人的 `social` 都是 1%（"社交连接极弱"）——
 *   这跟"用标题长度冒充正文"是同一类错误：把"量不到"当成了"量出来很低"。
 *   标记后该维留空，由知乎（有点赞数）或 SBTI 去补。
 *
 * ⚠️ `profile` 的意义（聊天/文档必须传 `"im"`）：
 *   默认 `"long-form"` 是按**知乎长文**校准的：`learning = 平均字数/600`、
 *   `creation = 长文(≥120字)比例`。直接套到聊天记录上会出两类问题：
 *     ① 中文聊天消息天然十几到几十字，`shortRatio` 恒 ≥0.8，
 *        触发"只有标题"的自动判定 → 三维被整组丢掉（实测就是这么丢的）；
 *     ② 就算不丢，`平均字数/600` 量到的是"聊天习惯"而不是"学习倾向"。
 *   所以聊天/文档改用 `"im"`：口径与 distilly 一致（长消息 = >50 字），
 *   并且**只算量得准的维度**：
 *     creation  = 1 - 内容重复率（"在说新东西"还是"复读"，无阈值、可比）
 *     stability = 篇幅一致性（CV，尺度无关）
 *     autonomy  = 领域集中度
 *     learning  **留空** —— 需要长文才量得准，聊天里没有这个信号
 *     social    **留空** —— 见 noHeat
 *
 * @param contents 该源的内容；条数为 0 时返回 null（**不编造**）
 * @param opts.titleOnly 是否只有标题（缺正文）
 * @param opts.noHeat 该源是否没有互动量这类连接强度信号
 * @param opts.profile 内容形态：`long-form`（长文，默认）| `im`（聊天/文档）
 */
export function facetFromContents(
  source: string,
  label: string,
  contents: SourceContent[],
  opts: { titleOnly?: boolean; noHeat?: boolean; profile?: "long-form" | "im" } = {},
): SourceFacet | null {
  if (contents.length === 0) return null;

  const lens = contents.map((c) => c.text.length);
  const n = lens.length;
  const avgChars = lens.reduce((s, x) => s + x, 0) / n;
  const shortRatio = lens.filter((x) => x < 120).length / n;
  const heat = contents.map((c) => c.heat ?? 0);
  const avgHeat = heat.reduce((s, x) => s + x, 0) / n;
  /* 领域命中**次数**（不是"命中几个领域"）——集中度要用分布算，见 topicConcentration */
  const domainCounts = interestCountsFromTexts(contents.map((c) => c.text));
  const domains = [...domainCounts].sort((a, b) => b[1] - a[1]).map(([d]) => d);

  /**
   * 是否"实际上只有标题"。
   *
   * 除了调用方显式声明（`titleOnly`），这里还做一次**自动判定**：
   * 若绝大多数内容都很短，那它就不可能是正文 —— 要么数据源只给标题
   * （知乎开放平台），要么上层把正文换成了标题写库。
   * 两种情况下拿长度当特征都是错的，所以一并不算那三维。
   *
   * 自动判定的必要性：这个函数有两个调用方（应用内同步 + 离线回填脚本），
   * 只靠"调用方记得传 flag"守不住 —— 实测就是脚本忘了传，
   * 于是又用标题长度算出了 learning=0.03 这种噪声值。
   */
  const looksLikeTitlesOnly = opts.titleOnly === true || shortRatio >= 0.8;
  /** 调用方声明这个源**有**互动量字段（没声明就当作没有） */
  const heatDeclared = opts.noHeat !== true;
  const isIm = opts.profile === "im";
  /**
   * 对外回报的 `titleOnly`。
   *
   * im 口径下恒为 false：聊天消息天然短，`shortRatio` 必然很高，
   * 那是**正常的聊天习惯**，不是"只拿到了标题"。若照实回报 true，
   * 界面会念出"该源只提供标题、没有正文"这种错话。
   */
  const titleOnlyOut = isIm ? false : looksLikeTitlesOnly;

  /* 内容重复率：聊天/文档里"复读"占比。无阈值、尺度无关，比"平均字数"可靠 */
  const repeatRatio =
    1 - new Set(contents.map((c) => c.text.trim())).size / Math.max(1, n);

  /**
   * 各维取值。
   *
   * ⚠️ 三条"无信号就留空"的纪律（用户反复投诉的 1%/99% 就出在这三处）：
   *   · `social`   —— 只有**真的量到互动**才算（`hasHeatSignal`），
   *                   否则留空。以前热度全 0 时会算成 `0/300 = 0` → 界面 1%。
   *   · `stability`—— CV（篇幅变异系数）≥1 时留空。CV≥1 意味着篇幅混乱到
   *                   "稳定输出"这个说法不成立，`1-min(CV,1)` 会恒定输出 0 → 界面 1%。
   *                   实测一份真实私聊（平均 8.9 字、标准差 56.7）就是这样顶到 1% 的。
   *   · `autonomy` —— 改为 HHI 归一化（见 `topicConcentration`），命中领域 <2 时留空。
   *                   旧公式只要命中 1 个领域就 = 1.0 → 界面 99%。
   */
  const concentrations = topicConcentration(domainCounts);
  const consistency = contentConsistency(lens, avgChars);
  const heatOk = hasHeatSignal(heat);

  const values: Partial<Record<ValueKey, number>> = isIm
    ? {
        /* 说新东西 vs 复读 —— "创造表达"在聊天场景下唯一量得准的代理 */
        creation: clampDisplay(1 - repeatRatio),
        ...(consistency == null ? {} : { stability: consistency }),
        ...(heatOk ? { social: clampDisplay(avgHeat / 300) } : {}),
        ...(concentrations == null ? {} : { autonomy: clampDisplay(concentrations) }),
      }
    : {
        /* 与"文本长度"有关的三维：只有确认拿到正文才算，否则留空 */
        ...(looksLikeTitlesOnly
          ? {}
          : {
              learning: clampDisplay(avgChars / 600),
              creation: clampDisplay(1 - shortRatio),
              ...(consistency == null ? {} : { stability: consistency }),
            }),
        /* 没互动量的源（聊天记录 / 工作文档）留空，而不是按 0 算成"社交极弱" */
        ...(heatOk ? { social: clampDisplay(avgHeat / 300) } : {}),
        ...(concentrations == null ? {} : { autonomy: clampDisplay(concentrations) }),
      };

  const top = domains.slice(0, 3);
  /* 结论里出现的百分比同样要收进 [1,99]（产品要求界面不出现 0% / 100%）。
     这里 `shortRatio < 0.8` 才走这一支，所以新数据本来就不会到 100%，
     但**旧数据里存着按老逻辑算出的 "100% 为短内容"** —— 加上收口后，
     即使将来阈值调整也不会再写出越界文案。 */
  const shortPct = clampPercent(Math.round(shortRatio * 100)) ?? 50;
  const repeatPct = clampPercent(Math.round(repeatRatio * 100)) ?? 50;

  let summary: string;
  let partialReason: string | undefined;

  if (isIm) {
    /* 聊天/文档：把**实际量了什么**写清楚，而不是只给一个维度名 */
    summary =
      `${n} 条内容，平均 ${Math.round(avgChars)} 字；` +
      `其中 ${shortPct}% 是短消息，内容重复率 ${repeatPct}%。` +
      `主要涉及${top.length ? top.join("、") : "暂无明确领域"}。`;
    partialReason =
      "聊天与工作文档天然是短文本：'学习成长'需要长文才量得准，" +
      "'社交连接'需要互动量（点赞/转发）—— 这两维在私域数据里没有可靠信号，" +
      "故留空，由知乎或 SBTI 补充。";
  } else {
    /* ⚠️ 文案只讲**算出了什么**，不讲"我们算不出什么"。
       以前这里会写「（只有标题、无正文）… 表达密度与长文比例需要正文，该源无法提供」，
       用户的原话是："你写这么多文字还是展示自己不足的文字，第一用户懒得看，
       第二降低产品吸引力" —— 所以删掉。
       缺维这件事本身，由"算不出来就不画那根条"来表达就够了（partialReason 仍留在数据层，
       只给诊断脚本与解析层用，不再上屏）。 */
    summary = looksLikeTitlesOnly
      ? `${n} 条内容，平均互动 ${Math.round(avgHeat)}；` +
        `主要涉及${top.length ? top.join("、") : "暂无明确领域"}。`
      : `${n} 条内容，平均 ${Math.round(avgChars)} 字（${shortPct}% 为短内容）；` +
        `主要涉及${top.length ? top.join("、") : "暂无明确领域"}。` +
        /* 只在"调用方声明有互动量、但实际没量到"时才提一句；
           本来就声明了 noHeat 的源不必赘述（那行也属于"讲自己做不到什么"） */
        (heatDeclared && !heatOk ? "该源没有互动量，社交连接强度由其它源补充。" : "");
    if (looksLikeTitlesOnly && !isIm) {
      partialReason =
        "该源只提供标题、没有正文，表达密度 / 长文比例 / 稳定输出需要正文才能算。";
    }
  }

  return {
    source,
    label,
    values,
    itemCount: n,
    summary,
    titleOnly: titleOnlyOut,
    ...(partialReason ? { partialReason } : {}),
  };
}

/**
 * 内容一致性：篇幅变异系数 CV = 标准差 / 均值，越小越稳定。
 *
 * 为什么不用"条数"：条数受抓取上限影响（实测 26 人里 22 人都取满 30 条，
 * 于是 stability 恒为 1.00，这一维完全没有信息量，还把判型整体推向
 * 原型里 stability 最高的那一型）。CV 才是"输出是否稳定"的可观测代理。
 *
 * @returns 0~1；**CV ≥ 1 时返回 null（留空）** —— 篇幅乱到 CV≥1 时，
 *          "稳定输出"这个说法本身不成立，硬算只会得到恒定 0（界面 1%）。
 *          实测一份真实私聊：平均 8.9 字、标准差 56.7（几条长文混着短句）→ CV≈6.4，
 *          旧逻辑每次都输出 1%，被用户当成"假数据"。
 */
function contentConsistency(lens: number[], avgChars: number): number | null {
  if (lens.length < 2 || avgChars <= 0) return null; // 单条无从谈波动 → 留空
  const variance = lens.reduce((s, x) => s + (x - avgChars) ** 2, 0) / lens.length;
  const cv = Math.sqrt(variance) / avgChars;
  if (!Number.isFinite(cv) || cv >= 1) return null;
  return clampDisplay(1 - cv);
}

/**
 * 把多个源的解析结果**融合**成综合画像的六维。
 *
 * 融合方式：每个维度取**有该维度数据的源**的算术平均。
 * 为什么是平均而不是加权求和：各源地位平等（都是同一批观察数据），
 * 加权需要先验可信度，而我们没有可靠依据去定"知乎比微信更可信"这种事 ——
 * 与其编一个权重，不如老实用等权平均，并在返回里如实给出 `usedSources`，
 * 让界面能说明"这份结论由哪几个源支撑"。
 *
 * **自评与观察分开记账**：SBTI 是本人自报，其余源是观察到的行为。
 * 平均时一视同仁（产品要求 SBTI 参与蒸馏），但会单独回传
 * `selfReportSources` / `observedSources`，让界面必须把"这版画像里有多少自评成分"
 * 说出来，不能让自评冒充观察结论。
 *
 * @returns fused 六维（只含至少一个源提供的维度）；usedSources 参与的源
 *          selfReportSources 其中的自报源；observedSources 其中的非自报源
 *          （`profile`「已有六维」这类蒸馏产物也归入非自报 —— 它不是本人自评；
 *            判断"是不是只有自评"请用 `isObservedSource` 收窄到行为源）
 */
export function fuseSourceFacets(facets: SourceFacet[]): {
  fused: Partial<Record<ValueKey, number>>;
  usedSources: string[];
  selfReportSources: string[];
  observedSources: string[];
  /** 体检发现的问题（零区分度自评 / 跨源同值），界面要如实说 */
  warnings: FacetWarning[];
  /** 因"零区分度"被排除在平均之外的源 */
  skippedSources: string[];
} {
  /* 先体检再平均：把"看着有数、其实没信息"的值挡在结论之外。
     两类问题都不该靠人记得检查 —— 详见 lib/persona/sanity.ts 的说明。 */
  const { skipFromFusion, warnings, blankDimensions } = inspectFacets(facets);

  const contributing = facets.filter((f) => !skipFromFusion.includes(f.source));
  const usedSources = contributing.map((f) => f.source);
  const selfReportSources = usedSources.filter((s) => SELF_REPORT_SOURCES.includes(s));
  const observedSources = usedSources.filter((s) => !SELF_REPORT_SOURCES.includes(s));
  const fused: Partial<Record<ValueKey, number>> = {};

  for (const key of VALUE_KEYS) {
    /* 跨源同值 → 这个信号根本没量到，整维留空 */
    if (blankDimensions.includes(key)) continue;
    const vals = contributing
      .map((f) => f.values[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length) {
      fused[key] = clamp01(vals.reduce((s, n) => s + n, 0) / vals.length);
    }
  }

  return { fused, usedSources, selfReportSources, observedSources, warnings, skippedSources: skipFromFusion };
}

