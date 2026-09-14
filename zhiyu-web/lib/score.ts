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
