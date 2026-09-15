/**
 * 「可数行为变量」——性格这一侧的新坐标系。
 *
 * ── 为什么要换掉原来的六维价值观 ──────────────────────────────────────────
 * 原来的 `learning/creation/career/social/stability/autonomy` 是用**文本形态**
 * 反推价值观：平均字数、长文比例、点赞数、篇幅波动、领域数。实测结论（食堂泼辣酱）：
 *   · 命中 1 个领域 → autonomy = 1.0 → 界面 99%
 *   · 没有互动量 → social = 0 → 界面 1%（三个源同为 1%）
 *   · 篇幅 CV≈6.4 → stability = 0 → 界面 1%
 *   · 去重后的证据集 → creation 恒为 0.99（微信/QQ 同值）
 * 把假数字一个一个挡掉之后，`fused` 直接变成**空的** —— 说明这套坐标本来
 * 就量不出这个人的价值观。用户的原话是「蒸馏得到的数据太假」，这是数据层面的证明。
 *
 * ── 换成的坐标系 ──────────────────────────────────────────────────────────
 * 只做**可数、可复现、能一句话讲清**的行为量。每一个都能指着原始数据说
 * "这个数是怎么来的"：
 *
 *   七个 0~1 刻度（可跨源合并的"个人属性"）
 *     initiative  主动发起率  = 我发起的对话段 / 总段数
 *     replySpeed  回应速度    = 1 - ln(1+中位回复秒)/ln(1+24h)
 *     activeDays  活跃天占比  = 有内容的天数 / 观察期天数
 *     lateNight   深夜占比    = 23:00–05:00 的内容 / 全部
 *     lexical     表达丰富度  = 字符 bigram 的 TTR（用词是否单调）
 *     inquiry     提问求知率  = 含疑问或求知词的内容 / 全部
 *     topicFocus  话题集中度  = HHI 归一化（1 = 只聊一个方向）
 *
 *   三个**事实行**（不做 0~1 换算 —— 一转就会贴边，实测"互动平衡"转百分比是 94%）
 *     depth       交流深度    = 单段消息数中位数
 *     streak      最长连续交流 = 连续有交流的最长天数
 *     balance     互动平衡    = 我 N 条 / 对方 M 条（直接给数字）
 *
 * 关系属性（initiative / replySpeed / depth / streak / balance）**不跨源合并** ——
 * "跟某人聊天的主动率"不等于"跟所有人聊天的主动率"；
 * 个人属性（activeDays / lateNight / lexical / inquiry / topicFocus）才合并。
 */

export type BehaviorKey =
  | "initiative"
  | "replySpeed"
  | "activeDays"
  | "lateNight"
  | "lexical"
  | "inquiry"
  | "topicFocus";

export type FactKey = "depth" | "streak" | "balance";

export const BEHAVIOR_KEYS: BehaviorKey[] = [
  "initiative",
  "replySpeed",
  "activeDays",
  "lateNight",
  "lexical",
  "inquiry",
  "topicFocus",
];

export const BEHAVIOR_LABEL: Record<BehaviorKey, string> = {
  initiative: "主动发起率",
  replySpeed: "回应速度",
  activeDays: "活跃天占比",
  lateNight: "深夜活跃",
  lexical: "表达丰富度",
  inquiry: "提问求知",
  topicFocus: "话题集中",
};

/** 每个变量"这个数是怎么来的"，界面上要能一句话说清 */
export const BEHAVIOR_HOWTO: Record<BehaviorKey, string> = {
  initiative: "我先开口的对话段 ÷ 总对话段（间隔超过 30 分钟算新的一段）",
  replySpeed: "对方发言后我回复的间隔中位数（按 24 小时对数归一）",
  activeDays: "有交流的天数 ÷ 观察期天数",
  lateNight: "23:00–05:00 的内容占比",
  lexical: "用词多样性（二字组合里新出现过的比例）",
  inquiry: "含疑问句或求知类词的内容占比",
  topicFocus: "话题分布集中度（1 = 只聊一个方向）",
};

/** 哪些是"个人属性"（可跨源合并），哪些是"关系属性"（必须按来源分开看） */
export const PERSONAL_KEYS: BehaviorKey[] = [
  "activeDays",
  "lateNight",
  "lexical",
  "inquiry",
  "topicFocus",
];
export const RELATIONAL_KEYS: BehaviorKey[] = ["initiative", "replySpeed"];

/** 一条内容。时间戳与方向可缺 —— 缺了就少算几项，不硬凑。 */
export interface BehaviorItem {
  text: string;
  /** Unix 秒；没有就少算时间类指标 */
  at?: number;
  /** 是不是我发的；undefined = 不知道方向 */
  mine?: boolean;
}

export interface BehaviorFact {
  key: FactKey;
  label: string;
  /** 直接给用户看的原文数字，如 "4 条（中位）" */
  display: string;
  value: number;
}

export interface BehaviorFacet {
  source: string;
  /** 0~1 刻度的变量（缺的键就是量不到） */
  variables: Partial<Record<BehaviorKey, number>>;
  /** 事实行 */
  facts: BehaviorFact[];
  /** 观察窗口内的原始规模，界面用它说明"依据多少数据" */
  coverage: {
    items: number;
    /** 有交流的天数 */
    days: number;
    /** 观察期天数（首条到最后一条） */
    spanDays: number;
    /** 时间跨度文案 */
    range: string | null;
  };
  /** 每个变量的依据原文，如 "262/476 段" */
  evidence: Partial<Record<BehaviorKey, string>>;
  /** 量不到的变量及原因（界面不显示，只在诊断里看） */
  unavailable: { key: BehaviorKey; reason: string }[];
}

/* ── 小工具 ─────────────────────────────────────────────────────────────── */

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  /* ⚠️ 是 `s.length >> 1`，不是 `s >> 1` —— 写成后者会得到 NaN，
     于是所有中位数都变成 NaN、回退成"量不到"（真实数据上踩过一次，
     靠 test-behavior 的断言才发现：620 个回复样本却算出"没有成对往来"）。 */
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 对话段切分阈值：30 分钟 */
const SESSION_GAP_SEC = 30 * 60;
/** 回复间隔超过 6 小时不算"回复" */
const REPLY_MAX_SEC = 6 * 3600;
/** 表达丰富度至少要有这么多条才算得准 */
const LEXICAL_MIN_ITEMS = 200;

/** 求知类词（与"提问"合并成 inquiry）—— 与词典一样，改这里要想清楚 */
const INQUIRY_WORDS = [
  "为什么", "怎么", "如何", "是不是", "能不能", "什么", "哪个", "多少",
  "原理", "区别", "求教", "请教", "指教", "请问",
];

/**
 * 用词多样性 TTR：字符 bigram 里"新出现过"的比例。
 *
 * 为什么不用"整句重复率"：证据表在导入时已经按前 120 字去重，
 * 所以整句重复率恒为 0、`1-重复率` 恒为 0.99（微信/QQ 同值，实测）。
 * TTR 看的是**用词是否单调**，不受去重影响，且天然落在中间区间
 * （实测真实私聊：整体 43.5%，我 53.1%，对方 46.6%）。
 */
export function lexicalDiversity(texts: string[]): number | null {
  const grams: string[] = [];
  for (const t of texts) {
    const clean = t.replace(/[\s\p{P}\p{S}]/gu, "");
    for (let i = 0; i + 1 < clean.length; i += 1) grams.push(clean.slice(i, i + 2));
  }
  if (grams.length < 40) return null;
  return clamp01(new Set(grams).size / grams.length);
}

/**
 * 回应速度：中位回复间隔 → 0~1。
 *
 * 用 **24 小时的对数刻度**，不是线性：
 *   48 秒 → 66%    5 分钟 → 50%    30 分钟 → 34%    2 小时 → 22%    24 小时 → 0
 * 线性刻度下"几秒钟回复"和"几分钟回复"挤在一起、且 1 小时以上全是 0（又是端点值）。
 * 中位间隔 > 6 小时 → 留空：那不构成对话，谈不上"快慢"。
 */
export function replySpeedScore(medianSeconds: number): number | null {
  if (!Number.isFinite(medianSeconds) || medianSeconds <= 0) return null;
  if (medianSeconds > REPLY_MAX_SEC) return null;
  const v = 1 - Math.log(1 + medianSeconds) / Math.log(1 + 86400);
  return clamp01(v);
}

/** 话题集中度：与 fusion.topicConcentration 同一套（HHI 归一化，<2 个方向留空） */
export function topicFocusScore(counts: Map<string, number>): number | null {
  const vals = [...counts.values()].filter((v) => v > 0);
  const total = vals.reduce((a, b) => a + b, 0);
  if (vals.length < 2 || total <= 0) return null;
  const hhi = vals.reduce((s, c) => s + (c / total) ** 2, 0);
  const d = vals.length;
  return clamp01((hhi - 1 / d) / (1 - 1 / d));
}

/* ── 主函数 ─────────────────────────────────────────────────────────────── */

/**
 * 从一批内容算出该源的可数行为变量。
 *
 * @param source 源名（只用于回填到结果里）
 * @param items  内容（时间戳/方向可选）
 * @param opts.domainCounts 该源的领域词频（由调用方用同一本词典算好传入，
 *        避免这个模块再依赖 fusion 的词典，保持纯函数、好测）
 */
export function behaviorFromItems(
  source: string,
  items: BehaviorItem[],
  opts: { domainCounts?: Map<string, number> } = {},
): BehaviorFacet | null {
  const list = items.filter((it) => it.text.trim().length > 0);
  if (list.length === 0) return null;

  const variables: Partial<Record<BehaviorKey, number>> = {};
  const evidence: Partial<Record<BehaviorKey, string>> = {};
  const facts: BehaviorFact[] = [];
  const unavailable: { key: BehaviorKey; reason: string }[] = [];

  const withTime = list
    .filter((it) => typeof it.at === "number" && it.at > 0)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const hasTime = withTime.length >= 2;
  const dated = hasTime ? withTime : [];

  /* 观察窗口 */
  const dayKey = (sec: number) => new Date(sec * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const hourOf = (sec: number) => new Date(sec * 1000 + 8 * 3600 * 1000).getUTCHours();
  const days = hasTime ? [...new Set(dated.map((it) => dayKey(it.at as number)))].sort() : [];
  const spanDays = hasTime
    ? Math.round(((dated.at(-1)!.at as number) - (dated[0].at as number)) / 86400) + 1
    : 0;

  /* ① 活跃天占比（个人属性） */
  if (hasTime && spanDays > 0) {
    /* 观察期不足 7 天时这个比率没有意义（聊两天就"100% 活跃"） */
    if (spanDays >= 7) {
      variables.activeDays = clamp01(days.length / spanDays);
      evidence.activeDays = `${days.length}/${spanDays} 天`;
    } else {
      unavailable.push({ key: "activeDays", reason: "观察期不足 7 天" });
    }
  } else {
    unavailable.push({ key: "activeDays", reason: "没有时间戳" });
  }

  /* ② 深夜活跃（个人属性） */
  if (hasTime) {
    const late = dated.filter((it) => {
      const h = hourOf(it.at as number);
      return h >= 23 || h < 5;
    }).length;
    variables.lateNight = clamp01(late / dated.length);
    evidence.lateNight = `${late}/${dated.length} 条在 23:00–05:00`;
  } else {
    unavailable.push({ key: "lateNight", reason: "没有时间戳" });
  }

  /* ③ 主动发起率 + ④ 回应速度（关系属性：需要方向） */
  const directed = dated.filter((it) => typeof it.mine === "boolean");
  if (directed.length >= 10) {
    const sessions: { end: number; first: BehaviorItem }[] = [];
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
      variables.initiative = clamp01(mineStart / sessions.length);
      evidence.initiative = `${mineStart}/${sessions.length} 段`;
    } else {
      unavailable.push({ key: "initiative", reason: "对话段太少（<5 段）" });
    }

    const mineReplies: number[] = [];
    const peerReplies: number[] = [];
    for (let i = 1; i < directed.length; i += 1) {
      const a = directed[i - 1];
      const b = directed[i];
      if (a.mine === b.mine) continue;
      const d = (b.at as number) - (a.at as number);
      if (d <= 0 || d > REPLY_MAX_SEC) continue;
      (b.mine === true ? mineReplies : peerReplies).push(d);
    }
    const med = median(mineReplies);
    const score = replySpeedScore(med);
    if (score == null) {
      unavailable.push({
        key: "replySpeed",
        reason: Number.isFinite(med) ? "中位回复间隔超过 6 小时" : "没有成对的往来记录",
      });
    } else {
      variables.replySpeed = score;
      evidence.replySpeed = `中位 ${(med / 60).toFixed(1)} 分钟（${mineReplies.length} 次）`;
    }
    if (peerReplies.length >= 5) {
      facts.push({
        key: "balance",
        label: "互动平衡",
        display: `我 ${directed.filter((x) => x.mine).length} 条 / 对方 ${directed.filter((x) => !x.mine).length} 条`,
        value: directed.filter((x) => x.mine).length / directed.length,
      });
      const peerMed = median(peerReplies);
      if (Number.isFinite(peerMed)) {
        facts.push({
          key: "streak",
          label: "对方回应中位",
          display: `${(peerMed / 60).toFixed(1)} 分钟`,
          value: peerMed,
        });
      }
    }
  } else {
    unavailable.push({ key: "initiative", reason: "没有发送方向信息" });
    unavailable.push({ key: "replySpeed", reason: "没有发送方向信息" });
  }

  /* ⑤ 表达丰富度（个人属性） */
  const lexical = lexicalDiversity(list.map((it) => it.text));
  if (lexical == null) {
    unavailable.push({ key: "lexical", reason: `内容太少（<${LEXICAL_MIN_ITEMS} 条或总词量不足）` });
  } else {
    variables.lexical = lexical;
    evidence.lexical = `${list.length} 条内容的二字组合去重率`;
  }

  /* ⑥ 提问求知率（个人属性） */
  const ask = list.filter(
    (it) => /[?？]/.test(it.text) || INQUIRY_WORDS.some((w) => it.text.includes(w)),
  ).length;
  variables.inquiry = clamp01(ask / list.length);
  evidence.inquiry = `${ask}/${list.length} 条`;

  /* ⑦ 话题集中度（个人属性） */
  const focus = topicFocusScore(opts.domainCounts ?? new Map());
  if (focus == null) {
    unavailable.push({ key: "topicFocus", reason: "命中领域少于 2 个" });
  } else {
    variables.topicFocus = focus;
    const top = [...(opts.domainCounts ?? new Map())].sort((a, b) => b[1] - a[1]).slice(0, 3);
    evidence.topicFocus = top.map(([d, c]) => `${d} ${c}`).join("、");
  }

  /* 事实行：交流深度 / 最长连续交流 */
  if (directed.length >= 10) {
    const lens: number[] = [];
    let cur = 1;
    for (let i = 1; i < directed.length; i += 1) {
      if ((directed[i].at as number) - (directed[i - 1].at as number) > SESSION_GAP_SEC) {
        lens.push(cur);
        cur = 1;
      } else cur += 1;
    }
    lens.push(cur);
    const m = median(lens);
    if (Number.isFinite(m)) {
      facts.push({ key: "depth", label: "单段消息数", display: `${m} 条（中位）`, value: m });
    }
  }
  if (days.length >= 2) {
    let best = 1;
    let run = 1;
    for (let i = 1; i < days.length; i += 1) {
      const prev = new Date(`${days[i - 1]}T00:00:00+08:00`).getTime();
      const cur = new Date(`${days[i]}T00:00:00+08:00`).getTime();
      run = cur - prev === 86400000 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    facts.push({ key: "streak", label: "最长连续交流", display: `${best} 天`, value: best });
  }

  return {
    source,
    variables,
    facts,
    coverage: {
      items: list.length,
      days: days.length,
      spanDays,
      range: hasTime ? `${dayKey(dated[0].at as number)} ~ ${dayKey(dated.at(-1)!.at as number)}` : null,
    },
    evidence,
    unavailable,
  };
}

/** 0~1 → 展示百分比（收进 [1,99]，用于进度条宽度） */
export function behaviorPercent(v: number | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(1, Math.min(99, Math.round(v * 100)));
}

/**
 * 0~1 → 展示文案。
 *
 * ⚠️ 贴边时**不要**写 "1%" / "99%" —— 那正是用户骂过的"你不让写 0/100，
 * 就整 99 和 1"。真实的 0.4% 就写 "<1%"，99.6% 就写 ">99%"：
 * 既不出现绝对化的 0%/100%，也不假装那 1 个百分点存在。
 */
export function behaviorPercentText(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  if (v < 0.005) return "<1%";
  if (v > 0.995) return ">99%";
  return `${Math.round(v * 100)}%`;
}

export interface MergedBehavior {
  /** 个人属性：跨源等权平均 */
  personal: Partial<Record<BehaviorKey, number>>;
  /** 参与合并的源（按个人属性） */
  sources: string[];
  /** 每个个人属性的依据，形如 `{"activeDays": "微信 212/759 天、知乎 30/60 天"}` */
  evidence: Partial<Record<BehaviorKey, string>>;
  /** 关系属性：**不合并**，按来源单列（跟谁聊天的主动率不是一回事） */
  relational: { source: string; key: BehaviorKey; value: number; evidence?: string }[];
  /** 样本量最大的那个关系源（雷达取它作为"主动/回应"两条轴） */
  primaryRelational: string | null;
  facts: { source: string; label: string; display: string }[];
  coverage: { items: number; days: number; spanDays: number; range: string | null };
}

/**
 * 把多个源的行为解析结果合并成"这个人"的画像。
 *
 * 规则只有一条，但很关键：**个人属性合并、关系属性不合并**。
 *   · 作息、表达丰富度、提问倾向、话题集中度 —— 这些是"这个人"的属性，
 *     微信测出来和知乎测出来应该一致，取等权平均更稳
 *   · 主动发起率、回应速度 —— 这些是"这段关系"的属性。
 *     把"跟 A 聊天的主动率"和"跟 B 聊天的主动率"平均成一个数，
 *     等于编了一个不存在的指标，所以按来源分开列。
 */
export function mergeBehavior(facets: BehaviorFacet[]): MergedBehavior {
  const personal: Partial<Record<BehaviorKey, number>> = {};
  const evidence: Partial<Record<BehaviorKey, string>> = {};
  const sources: string[] = [];
  const relational: MergedBehavior["relational"] = [];
  const facts: MergedBehavior["facts"] = [];
  const coverage = { items: 0, days: 0, spanDays: 0, range: null as string | null };

  for (const f of facets) {
    sources.push(f.source);
    coverage.items += f.coverage.items;
    coverage.days = Math.max(coverage.days, f.coverage.days);
    coverage.spanDays = Math.max(coverage.spanDays, f.coverage.spanDays);
    for (const x of f.facts) {
      if (x.key === "balance" || x.key === "depth") {
        facts.push({ source: f.source, label: x.label, display: x.display });
      }
    }
  }

  for (const key of PERSONAL_KEYS) {
    const parts = facets
      .map((f) => ({ source: f.source, v: f.variables[key] }))
      .filter((x): x is { source: string; v: number } => typeof x.v === "number");
    if (!parts.length) continue;
    personal[key] = clamp01(parts.reduce((s, x) => s + x.v, 0) / parts.length);
    evidence[key] = parts.map((x) => `${x.source} ${facetEvidence(facets, x.source, key)}`).join("；");
  }

  for (const f of facets) {
    for (const key of RELATIONAL_KEYS) {
      const v = f.variables[key];
      if (typeof v === "number") {
        relational.push({ source: f.source, key, value: v, evidence: f.evidence[key] });
      }
    }
  }

  /* 主关系源：按内容量最大的那个（它最能代表"这个人平时怎么聊"） */
  const sorted = [...facets].sort((a, b) => b.coverage.items - a.coverage.items);
  const primaryRelational =
    sorted.find((f) => RELATIONAL_KEYS.some((k) => typeof f.variables[k] === "number"))?.source ??
    null;

  return { personal, sources, evidence, relational, primaryRelational, facts, coverage };
}

/** 取某个源某个变量的依据文案（用于合并后的 evidence） */
function facetEvidence(facets: BehaviorFacet[], source: string, key: BehaviorKey): string {
  const f = facets.find((x) => x.source === source);
  return f?.evidence[key] ?? "—";
}
