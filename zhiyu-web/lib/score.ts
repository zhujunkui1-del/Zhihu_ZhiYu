/**
 * 匹配分值的**唯一换算处**。
 *
 * ── 背景（实际踩过的 bug）────────────────────────────────────────────
 * 库里 `MatchReport.overallScore` 的约定是 **0~1 的小数**：
 *   · LLM Judge：`clamp01(overall)` → 0~1
 *   · 规则 Mock：`overall / 100`   → 0~1
 * 但页面上到处出现 `Math.round(overallScore) + "%"`，于是 0.82 被显示成
 * **"1%"**（用户看到的就是"综合匹配度 1%"）。
 *
 * 还有历史包袱：早期数据里可能存的是 0~100 的整数（如 73）。
 * 所以换算必须同时兼容两种量级，并且**只在这里做一次** ——
 * 散在各处写 `<= 1 ? *100 : 不动` 迟早会有人漏写。
 */

/**
 * 把任意量级的分值换算成 0~100 的整数百分比。
 *
 * 判据用 `<= 1`：本项目里 0~1 是主约定，而"1%"作为真实匹配度没有意义，
 * 因此 <=1 一律当作小数处理。
 *
 * @returns 0~100 的整数；传入 null/undefined/NaN 时返回 null（调用方据此显示"—"）
 */
export function toPercent(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

/** 同 `toPercent`，但给一个兜底文案（用于直接拼字符串） */
export function toPercentText(raw: number | null | undefined, fallback = "—"): string {
  const p = toPercent(raw);
  return p == null ? fallback : `${p}%`;
}

/* ── 展示用百分比：不许出现 0% / 100% ──────────────────────────────────── */

/**
 * 展示用百分比的上下界。
 *
 * 产品要求：界面上**不允许出现 100% 和 0%** 这种绝对化数值，
 * 最多 99%、最少 1%。
 *
 * 为什么合理（不只是好看）：这些数字都是**从有限样本推断**出来的 ——
 * 例如"独立自主 100%"的真实含义只是"我抓到的这 4 条内容都集中在同一个领域"，
 * 一个 4 样本的观察不该宣称 100%。同理 SBTI 满分题也可能因为某题理解偏差
 * 而不是真的"满格"。留 1% 余量比宣称绝对更诚实。
 */
export const PCT_MIN = 1;
export const PCT_MAX = 99;

/**
 * 把 0~100 的百分比收进 [1, 99]。
 *
 * ⚠️ 只处理**有值**的情况；`null` 表示"没有数据"，必须原样返回，
 * 不能变成 1% —— 那会把"不知道"伪装成"很低"。
 */
export function clampPercent(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return Math.round(Math.max(PCT_MIN, Math.min(PCT_MAX, pct)));
}

/**
 * 把 0~1 的分值换算成**展示用**的 [1, 99] 百分比整数。
 * `null` 原样返回（表示无数据，界面显示「—」）。
 */
export function toDisplayPercent(raw: number | null | undefined): number | null {
  const p = toPercent(raw);
  return p == null ? null : clampPercent(p);
}

/** 同 `toDisplayPercent`，直接给文案 */
export function toDisplayPercentText(
  raw: number | null | undefined,
  fallback = "—",
): string {
  const p = toDisplayPercent(raw);
  return p == null ? fallback : `${p}%`;
}

/**
 * 把 0~1 的**画像维度值**收进 [0.01, 0.99]，用于落库与雷达。
 *
 * 与 `clampPercent` 的分工：这个作用在 0~1 的**存储值**上，
 * 让雷达、进度条、匹配度三条展示路径天然不会出现 0%/100%。
 */
export function clampUnit(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.max(PCT_MIN / 100, Math.min(PCT_MAX / 100, v));
}

/** 同 `clampUnit`，但不接受 null（缺省给中性值） */
export function clampUnitOr(v: number, fallback = 0.5): number {
  return clampUnit(Number.isFinite(v) ? v : fallback) ?? fallback;
}
