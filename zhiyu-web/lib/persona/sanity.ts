/**
 * 数据体检：在把一堆源**融合**成结论之前，先查两类"看着有数、其实没信息"的情况。
 *
 * ── 为什么要单独一个模块 ──────────────────────────────────────────────────
 * 用户的原话是「你这蒸馏得到的数据太假」。复盘下来有两类假：
 *
 * ① **一组过多重复的数值**（零区分度）
 *    实测：SBTI 那份 OJBK 自评，15 个维度原始分**全是 4** → 折算出的五个
 *    价值观维度**全是 50%**，标准差 0。它不是"测得准"，是"每题都给了同一档"。
 *    但旧实现照样把这组恒定值平均进综合画像 —— 等于给每个人身上加了一个
 *    恒定的 0.5，把判型往中间型拖。
 *
 * ② **跨源同值**（同一个数字从所有源冒出来）
 *    实测：知乎/微信/QQ 的社交连接**全是 1%**，因为三边都没有互动量字段，
 *    `heat/300` 一律算成 0。三个源给出同一个数，不构成"三方印证"，
 *    恰恰证明这个信号**根本没量到**。
 *
 * 这两类都不该靠"人记得检查"，所以做成纯函数，接进 `fuseSourceFacets`。
 */

import type { SourceFacet } from "./fusion";

export interface FacetWarning {
  /** 机器可读的原因 */
  code: "self-report-no-spread" | "cross-source-identical";
  /** 给用户看的一句话（不带 markdown 记号） */
  text: string;
  sources: string[];
  /**
   * 受影响的**维度键**（如 `["social"]`）。
   * 调用方要靠它把对应维度整维置空，所以必须是结构化字段 ——
   * 从 `text` 里正则抠名字是脆的，改一次文案就断了。
   */
  keys?: string[];
}

/**
 * 零区分度判定：这一组值是不是"约等于同一个数"。
 *
 * @param values 已算出的维度值
 * @param min 最小标准差（0~1）。低于它认为没有区分度。
 * @returns 有值维度 <2 时返回 false（样本太少不判定）；否则返回"是否无区分度"
 */
export function hasNoSpread(values: number[], min = 0.05): boolean {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return false;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length);
  return sd < min;
}

/**
 * 跨源同值判定：同一个维度上，是不是**所有给出该维的源都给了同一个数**。
 *
 * 判据刻意严格：至少要 2 个源、且它们的值两两相等（容差 0.005）。
 * 只有"完全一模一样"才算 —— 那在真实数据里几乎只可能是同一个退化公式算出来的。
 */
export function crossSourceIdentical(
  facets: SourceFacet[],
  key: string,
  tolerance = 0.005,
): boolean {
  const vals = facets
    .map((f) => f.values[key as keyof typeof f.values])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length < 2) return false;
  return vals.every((v) => Math.abs(v - vals[0]) <= tolerance);
}

/**
 * 体检一组分源解析结果，产出给界面看的警告 + 供融合使用的排除名单。
 *
 * @returns `skipFromFusion` 是不该进加权平均的源（目前只有"零区分度的自评"）；
 *          `warnings` 会一路带到人格页，如实告诉用户"这份结论为什么少了一块"。
 */
export function inspectFacets(facets: SourceFacet[]): {
  skipFromFusion: string[];
  warnings: FacetWarning[];
  /** 因跨源同值而应当留空的维度 */
  blankDimensions: string[];
} {
  const skipFromFusion: string[] = [];
  const warnings: FacetWarning[] = [];
  const blankDimensions: string[] = [];

  /* ① 零区分度的自评：不进融合（但仍会展示 —— 用户有权看到自己那份问卷） */
  for (const f of facets) {
    if (f.source !== "sbti") continue;
    const vals = Object.values(f.values).filter((v): v is number => typeof v === "number");
    if (hasNoSpread(vals)) {
      skipFromFusion.push(f.source);
      warnings.push({
        code: "self-report-no-spread",
        text:
          "这份 SBTI 自评的各个维度落在了同一档（没有区分度），" +
          "所以它只作为自评展示，没有计入综合画像。",
        sources: [f.source],
      });
    }
  }

  /* ② 跨源同值：该维全部留空，并说明原因。
     ⚠️ 只在**真正参与融合**的源之间比 —— 被 ① 排除掉的源（零区分度自评）
     手里那个恒定值会污染这条检查：实测微信/QQ 的创造表达都是 0.99，
     但 SBTI 的 0.5 一掺进来就"不全相等"了，于是漏判。 */
  const contributorsPool = facets.filter((f) => !skipFromFusion.includes(f.source));
  const keys = new Set<string>();
  for (const f of contributorsPool) for (const k of Object.keys(f.values)) keys.add(k);
  for (const key of keys) {
    const contributors = contributorsPool.filter(
      (f) => typeof f.values[key as keyof typeof f.values] === "number",
    );
    if (contributors.length < 2) continue;
    if (!crossSourceIdentical(contributorsPool, key)) continue;
    blankDimensions.push(key);
    warnings.push({
      code: "cross-source-identical",
      text: `「${key}」在所有来源里都是同一个数，说明这个信号没有真正量到，已按"无数据"处理。`,
      sources: contributors.map((f) => f.source),
      keys: [key],
    });
  }

  return { skipFromFusion, warnings, blankDimensions };
}
