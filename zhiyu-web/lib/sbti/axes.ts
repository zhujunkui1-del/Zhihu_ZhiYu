/**
 * SBTI 维度 → 五轴画像。
 *
 * 题库实测有 **15 个维度**（每类 3 个），不是 5 个：
 *   S  自我         S1 自尊自信 / S2 自我清晰度 / S3 核心价值
 *   E  情感         E1 依恋安全感 / E2 情感投入度 / E3 边界与依赖
 *   A  观念         A1 世界观倾向 / A2 规则与灵活度 / A3 人生意义感
 *   Ac 行动         Ac1 动机导向 / Ac2 决策风格 / Ac3 执行模式
 *   So 社交         So1 社交主动性 / So2 人际边界感 / So3 表达与真实度
 *
 * 雷达只有 5 根轴，所以按**类目前缀聚合成 5 轴**——这是真实数据的聚合，
 * 不是编出来的分数。每轴取该组 3 个维度的归一化均值。
 *
 * 归一化：每题 1~3 分、每维 2 题 → 维度原始分 2~6，映射到 0~1。
 */

export const DIM_MIN = 2;
export const DIM_MAX = 6;

export interface RawDimScore {
  score: number;
  level: string;
}

/** 五个类目：前缀 → 轴标签 */
export const AXIS_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "S", label: "自我" },
  { prefix: "E", label: "情感" },
  { prefix: "A", label: "观念" },
  { prefix: "Ac", label: "行动" },
  { prefix: "So", label: "社交" },
];

/**
 * 单维归一化到 **[0.01, 0.99]**（不是 0~1）。
 *
 * 为什么留余量：全 L 会算出 0、全 H 会算出 1，界面上就是「0%」和「100%」。
 * 产品要求不许出现这种绝对化数值（最多 99%、最少 1%）。
 * 而且从道理上讲，15 道自评题不该得出"100% 自主"这种断言 ——
 * 留 1% 余量比宣称绝对更诚实。
 */
export function normDim(score: number): number {
  const raw = (score - DIM_MIN) / (DIM_MAX - DIM_MIN);
  return Math.max(0.01, Math.min(0.99, raw));
}

/** 前缀匹配要小心：Ac 与 A 都以 A 开头，必须先匹配更长的前缀 */
function groupOf(key: string): string | null {
  /* 先长后短，避免 "Ac1" 被 "A" 抢走 */
  const sorted = [...AXIS_GROUPS].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const g of sorted) {
    if (key.startsWith(g.prefix)) return g.prefix;
  }
  return null;
}

export interface Axis {
  key: string;
  label: string;
  /** 0~1；该组无有效维度时为 null */
  value: number | null;
  /** 参与聚合的维度原始分，便于调试与展示 */
  parts: { key: string; normalized: number }[];
}

/**
 * 把 `personality.sbti.dimensions` 聚合成 5 轴。
 *
 * @param dims 形如 { S1: { score, level }, ... }；缺失或为空时所有轴 value 为 null
 */
export function axesFromDimensions(
  dims: Record<string, RawDimScore> | null | undefined,
): Axis[] {
  const src = dims ?? {};
  return AXIS_GROUPS.map((g) => {
    const parts: { key: string; normalized: number }[] = [];
    for (const [k, v] of Object.entries(src)) {
      if (groupOf(k) !== g.prefix) continue;
      if (typeof v?.score !== "number") continue;
      parts.push({ key: k, normalized: normDim(v.score) });
    }
    const value = parts.length
      ? parts.reduce((s, p) => s + p.normalized, 0) / parts.length
      : null;
    return { key: g.prefix, label: g.label, value, parts: parts.sort((a, b) => a.key.localeCompare(b.key)) };
  });
}

/**
 * 公开创作者的五轴来源：由**内容观察**到的六维价值观聚合。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * 上面那个函数只吃 `personality.sbti.dimensions`（15 维自评题）。
 * 但知乎公开创作者**根本没有知遇账号、也不可能做 SBTI**，
 * 于是他们的雷达永远是空的 —— 用户点开别人的卡只会看到"等待蒸馏"，
 * 观感就是"对方什么数据都没有"。实测 27 位真实用户全部为空。
 *
 * 而他们其实**有**数据：`Persona.values` 的六维是由公开内容真实统计出来的
 * （learning ← 平均字数、creation ← 长文比例、social ← 平均互动、
 *  stability ← 发布量、autonomy ← 领域集中度），完全可溯源。
 * 这里把这六维按语义映射到雷达的五轴，让公开创作者也有画像。
 *
 * ⚠️ **必须在界面上区分来源**：这是 Observed（观察推断），
 * 不是 Self-reported（本人自评）。两者含义不同，混在一起展示等于骗人。
 *
 * 映射（每一轴都取自语义相近的观察维度，不做无依据的加权）：
 *   自我 ← 独立自主（autonomy）
 *   情感 ← 社交连接（social）
 *   观念 ← 学习成长（learning）
 *   行动 ← 创造表达（creation）
 *   社交 ← 稳定输出（stability）
 */
const OBSERVED_AXIS_MAP: { key: string; label: string; from: string }[] = [
  { key: "S", label: "自我", from: "autonomy" },
  { key: "E", label: "情感", from: "social" },
  { key: "A", label: "观念", from: "learning" },
  { key: "Ac", label: "行动", from: "creation" },
  { key: "So", label: "社交", from: "stability" },
];

/**
 * 由观察到的六维价值观聚合出五轴。
 *
 * @param values `Persona.values`，形如 `{ learning: 0.9, creation: 0.7, ... }`
 * @returns 五轴；某轴对应的观察维度缺失时该轴 `value` 为 null（不编造中位值）
 */
export function axesFromObservedValues(
  values: Record<string, unknown> | null | undefined,
): Axis[] {
  const src = (values ?? {}) as Record<string, unknown>;
  return OBSERVED_AXIS_MAP.map((m) => {
    const raw = src[m.from];
    const num = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    return {
      key: m.key,
      label: m.label,
      value: num,
      parts: num == null ? [] : [{ key: m.from, normalized: num }],
    };
  });
}

/** 这个五轴集合里有没有可用值 */
export function axesHaveValue(axes: Axis[]): boolean {
  return axes.some((a) => a.value != null);
}
