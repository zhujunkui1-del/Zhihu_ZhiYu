/**
 * **五维画像** —— 写死的五个词，全站唯一的雷达坐标系。
 *
 * ── 为什么是这五个词 ──────────────────────────────────────────────────────
 * 上一版用的是七个"行为变量"（主动发起率/回应速度/活跃天占比/深夜活跃/
 * 表达丰富度/提问求知/话题集中）。它们没错，但**只适用于有对话、有时间戳的数据**：
 *   · 主动发起率、回应速度需要"对话双方"—— 知乎没有对话对象，SBTI 是问卷；
 *   · 其余五个需要"有时间戳的文本流"—— 知乎要看有没有发布时间，SBTI 完全没有。
 * 结果那张"综合画像"雷达实际上**只由微信/QQ 一个源支撑**，
 * 又犯了"把单一数据源当综合画像"的错（这个错之前因为 SBTI 被投诉过一次）。
 *
 * 改成五个**能表示程度高低、且每个源都喂得动**的词：
 *   思考深度 / 表达力 / 共情力 / 执行力 / 主动性
 * （深浅、强弱、高低都能说 —— 挂进度条不会让人不知道在看什么。）
 *
 * ── 纪律（沿用 ③ 的方针）────────────────────────────────────────────────
 *   · 某个源喂不出某一维 → **留空**（界面 `—`），不给 0、不给 0.5、不给 1；
 *   · 不引入新的"拍的常数"：能数出来的才用（词频、占比、用词多样性）；
 *   · 每个值都带上依据文案，用户能问"这个数怎么来的"。
 */

export const DIM_KEYS = ["thinking", "expression", "empathy", "execution", "initiative"] as const;
export type DimKey = (typeof DIM_KEYS)[number];

export const DIM_LABEL: Record<DimKey, string> = {
  thinking: "思考深度",
  expression: "表达力",
  empathy: "共情力",
  execution: "执行力",
  initiative: "主动性",
};

/** 每个词在问什么（界面上要能一句话说清） */
export const DIM_HOWTO: Record<DimKey, string> = {
  thinking: "有多少内容在做解释、推理、追问，而不是只下结论",
  expression: "用词丰不丰富、表达完不完整（越高越不单调）",
  empathy: "对他人情绪与处境的关注程度（情绪词、关系词的占比）",
  execution: "输出是否持续稳定（有时间的源按「有输出的天数占比」算）",
  initiative: "是不是主动开口/主动开启新话题的那一方",
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** 一条内容；时间与方向可缺 —— 缺了就少算几维，不硬凑 */
export interface DimItem {
  text: string;
  /** Unix 秒 */
  at?: number;
  /** true = 我发的 */
  mine?: boolean;
}

export interface DimSet {
  source: string;
  values: Partial<Record<DimKey, number>>;
  /** 每一维的依据文案（给用户看"这个数怎么来的"） */
  evidence: Partial<Record<DimKey, string>>;
  /** 量不到的维度及原因（只给诊断看，不上屏） */
  unavailable: { key: DimKey; reason: string }[];
}

/* ── 词表（与其它模块共用同一套口径，改这里要想清楚） ─────────────────── */

/** 解释/推理/追问的信号：出现即认为这条内容在"想事情" */
const THINKING_WORDS = [
  "为什么", "怎么", "如何", "因为", "所以", "其实", "本质", "原理", "区别", "意味着",
  "说明", "推论", "逻辑", "前提", "假设", "反过来", "也就是说", "换句话说", "请问", "求教",
];
/** 情绪与关系信号 */
const EMPATHY_WORDS = [
  "谢谢", "感谢", "抱歉", "对不起", "辛苦", "开心", "高兴", "难过", "委屈", "不容易",
  "担心", "压力", "焦虑", "累", "抱抱", "陪", "想你", "在乎", "感受", "理解你", "别急",
  /* 口语里真正表达"关心对方"的说法。补这几个是因为实测：一份 3988 条的私聊
     用上面的词表只命中 19 条（<1%），但两个人其实在互相照应 ——
     词表偏书面语会把"共情力"系统性压低。 */
  "加油", "心疼", "注意身体", "早点睡", "早点休息", "别累", "照顾好", "没事吧",
  "还好吗", "要不要", "保重", "注意安全", "别熬夜", "休息一下",
];

/** 用词多样性 TTR（与 behavior.lexicalDiversity 同一算法，避免两处口径不同） */
function ttr(texts: string[]): number | null {
  const grams: string[] = [];
  for (const t of texts) {
    const clean = t.replace(/[\s\p{P}\p{S}]/gu, "");
    for (let i = 0; i + 1 < clean.length; i += 1) grams.push(clean.slice(i, i + 2));
  }
  if (grams.length < 40) return null;
  return clamp01(new Set(grams).size / grams.length);
}

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const SESSION_GAP_SEC = 30 * 60;

/**
 * 从一批内容算出五维。**每个源都走这一个函数** —— 差别只在"这批内容里有没有
 * 时间与方向"，所以知乎（只有标题）、聊天（有双方与时间）、文档（只有正文）
 * 用的是同一套口径，不会出现"两处算法不同"。
 */
export function dimsFromItems(source: string, items: DimItem[]): DimSet | null {
  const list = items.filter((it) => it.text.trim().length > 0);
  if (list.length === 0) return null;

  const values: Partial<Record<DimKey, number>> = {};
  const evidence: Partial<Record<DimKey, string>> = {};
  const unavailable: { key: DimKey; reason: string }[] = [];

  /* 思考深度：解释/推理/追问的占比（长短都算，所以标题也喂得动） */
  const thinkingHits = list.filter((it) => {
    const t = it.text;
    return /[?？]/.test(t) || t.length >= 80 || THINKING_WORDS.some((w) => t.includes(w));
  }).length;
  values.thinking = clamp01(thinkingHits / list.length);
  evidence.thinking = `${thinkingHits}/${list.length} 条在解释、推理或追问`;

  /* 表达力：用词多样性 */
  const t = ttr(list.map((it) => it.text));
  if (t == null) unavailable.push({ key: "expression", reason: "内容太少，算不出用词多样性" });
  else {
    values.expression = t;
    evidence.expression = `${list.length} 条内容的二字组合去重率`;
  }

  /* 共情力：情绪与关系词占比 */
  const emp = list.filter((it) => EMPATHY_WORDS.some((w) => it.text.includes(w))).length;
  values.empathy = clamp01(emp / list.length);
  evidence.empathy = `${emp}/${list.length} 条出现情绪或关系表达`;

  /* 执行力：需要时间戳。有交流的天数 / 观察期天数 */
  const dated = list
    .filter((it) => typeof it.at === "number" && it.at > 0)
    .sort((a, b) => (a.at as number) - (b.at as number));
  if (dated.length >= 2) {
    const dayOf = (s: number) => new Date(s * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const days = new Set(dated.map((it) => dayOf(it.at as number)));
    const span = Math.round(((dated.at(-1)!.at as number) - (dated[0].at as number)) / 86400) + 1;
    if (span >= 7) {
      values.execution = clamp01(days.size / span);
      evidence.execution = `${days.size}/${span} 天有输出`;
    } else {
      unavailable.push({ key: "execution", reason: "观察期不足 7 天" });
    }
  } else {
    unavailable.push({ key: "execution", reason: "没有时间戳" });
  }

  /* 主动性：需要发送方向。我发起的对话段 / 总段数 */
  const directed = dated.filter((it) => typeof it.mine === "boolean");
  if (directed.length >= 10) {
    const sessions: { end: number; first: DimItem }[] = [];
    for (const it of directed) {
      const cur = sessions.at(-1);
      if (!cur || (it.at as number) - cur.end > SESSION_GAP_SEC) {
        sessions.push({ end: it.at as number, first: it });
      } else {
        cur.end = it.at as number;
      }
    }
    if (sessions.length >= 5) {
      const mineStart = sessions.filter((s) => s.first.mine === true).length;
      values.initiative = clamp01(mineStart / sessions.length);
      evidence.initiative = `${mineStart}/${sessions.length} 段是我先开口`;
    } else {
      unavailable.push({ key: "initiative", reason: "对话段太少（<5 段）" });
    }
  } else {
    unavailable.push({ key: "initiative", reason: "没有发送方向信息" });
  }

  /* 主动性（无方向的源）：用"主动开启新话题"的密度代替 —— 只有单条内容流时，
     拿不出"谁先开口"，但能看出"是不是在同一件事上反复说"。用中位会话长度衡量：
     单段越长越像"持续投入"而不是"被动应答"。缺方向时**不编**，直接留空更诚实，
     所以这里不实现。 */

  return { source, values, evidence, unavailable };
}

/**
 * SBTI 的 15 维 → 五维。
 *
 * 每个映射都取语义最近的维度（与 `lib/sbti/axes.ts` 的分类一致），
 * 取算术平均；**没有对应题目的维度留空**，不用中性值凑。
 */
const SBTI_TO_DIM: Record<DimKey, string[]> = {
  thinking: ["A1", "A3", "S2"], // 世界观倾向 / 人生意义感 / 自我清晰度
  expression: ["So3", "A2"], // 表达与真实度 / 规则与灵活度
  empathy: ["E1", "E2", "E3"], // 依恋安全感 / 情感投入度 / 边界与依赖
  execution: ["Ac3", "Ac1", "S1"], // 执行模式 / 动机导向 / 自尊自信
  initiative: ["So1", "A2"], // 社交主动性 / 规则与灵活度
};

export function dimsFromSbti(
  dimensions: Record<string, { score?: number } | number> | null | undefined,
): DimSet | null {
  const src = dimensions ?? {};
  const unit = (v: { score?: number } | number | undefined): number | null => {
    const score = typeof v === "number" ? v : typeof v?.score === "number" ? v.score : null;
    if (score === null) return null;
    return Math.max(0.01, Math.min(0.99, (score - 2) / 4));
  };

  const values: Partial<Record<DimKey, number>> = {};
  const evidence: Partial<Record<DimKey, string>> = {};
  let any = false;
  for (const key of DIM_KEYS) {
    const picked = SBTI_TO_DIM[key]
      .map((k) => unit((src as Record<string, { score?: number } | number>)[k]))
      .filter((x): x is number => x !== null);
    if (!picked.length) continue;
    any = true;
    /* 自评用**均值**：不放大单题波动 */
    const avg = picked.reduce((s, x) => s + x, 0) / picked.length;
    values[key] = Math.max(0.01, Math.min(0.99, avg));
    evidence[key] = `SBTI ${SBTI_TO_DIM[key].join("/")} 折算`;
  }
  return any ? { source: "sbti", values, evidence, unavailable: [] } : null;
}

/**
 * 跨源合并：每一维取**有该维数据的源**的等权平均。
 *
 * 为什么等权：没有可靠依据去定"知乎比微信更可信"，编一个权重不如老实用平均。
 * 一个源喂不出某一维就不参与那一维（不是按 0 参与）。
 */
export function mergeDims(sets: DimSet[]): {
  values: Partial<Record<DimKey, number>>;
  evidence: Partial<Record<DimKey, string>>;
  usedSources: string[];
  /** 每一维由哪些源支撑 */
  contributors: Partial<Record<DimKey, string[]>>;
} {
  const values: Partial<Record<DimKey, number>> = {};
  const evidence: Partial<Record<DimKey, string>> = {};
  const contributors: Partial<Record<DimKey, string[]>> = {};
  const usedSources = sets.map((s) => s.source);

  for (const key of DIM_KEYS) {
    const parts = sets
      .map((s) => ({ source: s.source, v: s.values[key], how: s.evidence[key] }))
      .filter((x): x is { source: string; v: number; how: string | undefined } => typeof x.v === "number");
    if (!parts.length) continue;
    values[key] = clamp01(parts.reduce((s, x) => s + x.v, 0) / parts.length);
    contributors[key] = parts.map((x) => x.source);
    evidence[key] = parts.map((x) => `${x.source}：${x.how ?? "—"}`).join("；");
  }

  return { values, evidence, usedSources, contributors };
}

/** 0~1 → 展示文案（贴边写 <1% / >99%，与全站口径一致） */
export function dimPercentText(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (v < 0.005) return "<1%";
  if (v > 0.995) return ">99%";
  return `${Math.round(v * 100)}%`;
}
