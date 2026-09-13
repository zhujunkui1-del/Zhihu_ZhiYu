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

/** 单维归一化到 0~1 */
export function normDim(score: number): number {
  return Math.max(0, Math.min(1, (score - DIM_MIN) / (DIM_MAX - DIM_MIN)));
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
