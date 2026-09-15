#!/usr/bin/env node
/**
 * 「SBTI 参与蒸馏」+「不许出现 0% / 100%」的纯逻辑测试。
 *
 * ── 两条需求（用户原话）──────────────────────────────────────────────
 *   ① 「现在，马上把 SBTI 的结果也列为人格数据里面，也要进行蒸馏」
 *      → SBTI 必须折算成六维、作为一个源进入融合与分源解析；
 *        但它是**本人自报**，必须与观察类源分开标注（不能冒充观察结论）。
 *   ② 「像里面这样 100% 还有 0% 的极端的数据不许出现，最多 99% 最少 1%」
 *      → 所有**推断出来的**百分比都收进 [1, 99]；
 *        但"没有数据"必须仍然是 null（不能把不知道伪装成 1%）。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-sbti-fusion.mjs
 */
import assert from "node:assert/strict";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/* ── ① 区间收口 ───────────────────────────────────────────────────────── */
console.log("\n== [1,99] 收口：0% / 100% 不许出现在展示值里 ==");
const { clampPercent, toDisplayPercent, toDisplayPercentText, clampUnit } = await import(
  "../lib/score.ts"
);

rec("0 → 1（下界）", clampPercent(0) === 1, `${clampPercent(0)}`);
rec("100 → 99（上界）", clampPercent(100) === 99, `${clampPercent(100)}`);
rec("51 → 51（区间内不动）", clampPercent(51) === 51, `${clampPercent(51)}`);
rec("150 → 99", clampPercent(150) === 99, `${clampPercent(150)}`);
rec("-20 → 1", clampPercent(-20) === 1, `${clampPercent(-20)}`);
rec("null → null（没数据不能变成 1%）", clampPercent(null) === null);
rec("NaN → null", clampPercent(NaN) === null);
rec("toDisplayPercent(0) → 1", toDisplayPercent(0) === 1, `${toDisplayPercent(0)}`);
rec("toDisplayPercent(1) → 99", toDisplayPercent(1) === 99, `${toDisplayPercent(1)}`);
rec("toDisplayPercent(0.82) → 82", toDisplayPercent(0.82) === 82);
rec("toDisplayPercentText(null) 仍是「—」", toDisplayPercentText(null) === "—");
rec("clampUnit(0) → 0.01", clampUnit(0) === 0.01, `${clampUnit(0)}`);
rec("clampUnit(1) → 0.99", clampUnit(1) === 0.99, `${clampUnit(1)}`);

/* ── ② SBTI 15 维 → 六维 ─────────────────────────────────────────────── */
console.log("\n== facetFromSbti：SBTI 折算成一个和其它源同构的 facet ==");
const { facetFromSbti, sbtiDimensionUnits, fuseSourceFacets, VALUE_KEYS } = await import(
  "../lib/persona/fusion.ts"
);

/* 造一份真实的 dimensionScores 形态（submit 路由写进库的就是这个：
   15 个维度，每个 { score: 2~6, level: L|M|H }） */
const DIMS = [
  "S1", "S2", "S3", "E1", "E2", "E3", "A1", "A2", "A3",
  "Ac1", "Ac2", "Ac3", "So1", "So2", "So3",
];
const scores = Object.fromEntries(
  DIMS.map((k, i) => [k, { score: 2 + (i % 5), level: ["L", "M", "H"][i % 3] }]),
);

const units = sbtiDimensionUnits(scores);
rec("15 个维度全部提取出来", Object.keys(units).length === 15, `${Object.keys(units).length}`);
rec(
  "归一化值都在 [0.01, 0.99]",
  Object.values(units).every((v) => v >= 0.01 && v <= 0.99),
  `范围 ${Math.min(...Object.values(units))} ~ ${Math.max(...Object.values(units))}`,
);

const codes = "HHL-LLH-LLM-MML-LHM";
rec(
  "⚠️ 只有等级码时**不给**六维（不许从 codes 反推分数）",
  Object.keys(sbtiDimensionUnits(null, codes)).length === 0 &&
    facetFromSbti(null, codes, { typeTitle: "僧人", type: "MONK" }) === null,
  "演示数据里的 codes 是占位串，反推会得到清一色 0.5，把画像拖向中间型",
);
rec(
  "带 level 但缺 score 时只按该维字母取值（有据可依的那部分）",
  (() => {
    const u = sbtiDimensionUnits({ S1: { level: "H" }, S2: { level: "L" } });
    return u.S1 === 0.75 && u.S2 === 0.25;
  })(),
);

const facet = facetFromSbti(scores, codes, { typeTitle: "僧人", type: "MONK" });
rec("facet 非空", facet !== null);
rec("source 是 sbti", facet?.source === "sbti", `${facet?.source}`);
rec(
  "label 明确写了「自评」",
  typeof facet?.label === "string" && facet.label.includes("自评"),
  facet?.label,
);
rec(
  "summary 明确写了「本人自报」",
  typeof facet?.summary === "string" && facet.summary.includes("本人自报"),
);
const facetDims = VALUE_KEYS.filter((k) => typeof facet?.values[k] === "number");
rec(
  "六维里有 5 维算得出（career 无对应题目，如实留空）",
  facetDims.length === 5 && typeof facet?.values.career !== "number",
  `算出的：${facetDims.join("、")}`,
);
rec(
  "折算出的每个值都在 [0.01, 0.99]",
  facetDims.every((k) => facet.values[k] >= 0.01 && facet.values[k] <= 0.99),
  facetDims.map((k) => `${k}=${facet.values[k]}`).join(" "),
);

/* 拿不到任何维度时**不许编** */
rec(
  "没有任何维度数据时返回 null（不硬凑六维）",
  facetFromSbti(undefined, null) === null,
);
rec(
  "只给了类型名（没有 dimensions / codes）也返回 null",
  facetFromSbti({}, null, { typeTitle: "僧人", type: "MONK" }) === null,
);

/* ── ③ 融合：自评与观察要分开记账 ────────────────────────────────────── */
console.log("\n== fuseSourceFacets：SBTI 参与融合，但必须标出自评成分 ==");
const zhihuFacet = {
  source: "zhihu",
  label: "知乎 · 公共表达",
  values: { autonomy: 0.8, social: 0.2, learning: 0.7 },
  itemCount: 12,
  summary: "x",
  titleOnly: true,
};

const mixed = fuseSourceFacets([zhihuFacet, facet]);
rec(
  "两个源都算参与了",
  mixed.usedSources.length === 2 && mixed.usedSources.includes("sbti"),
  mixed.usedSources.join("+"),
);
rec(
  "sbti 被认成自报源",
  mixed.selfReportSources.length === 1 && mixed.selfReportSources[0] === "sbti",
  mixed.selfReportSources.join("+"),
);
rec(
  "知乎被认成非自报源",
  mixed.observedSources.length === 1 && mixed.observedSources[0] === "zhihu",
  mixed.observedSources.join("+"),
);
rec(
  "融合值是两源平均（SBTI 真的参与了，不是摆设）",
  (() => {
    const want = (zhihuFacet.values.autonomy + facet.values.autonomy) / 2;
    return Math.abs(mixed.fused.autonomy - want) < 1e-9;
  })(),
  `fused.autonomy=${mixed.fused.autonomy}`,
);
rec(
  "融合值全部落在 [0,1]",
  Object.values(mixed.fused).every((v) => v >= 0 && v <= 1),
);

const onlySelf = fuseSourceFacets([facet]);
rec(
  "只有自评时 usedSources 里只有 sbti",
  onlySelf.usedSources.length === 1 && onlySelf.usedSources[0] === "sbti",
);
rec(
  "「只有自评」可被调用方识别（observedSources 为空）",
  onlySelf.observedSources.length === 0 && onlySelf.selfReportSources.length === 1,
);
rec(
  "但 career 依然缺失（缺就是缺，不补中性值）",
  typeof onlySelf.fused.career !== "number",
  `fused keys=${Object.keys(onlySelf.fused).join("、")}`,
);

/* ── ④ 判定出来的倾向型不出现 0 / 100 分 ─────────────────────────────── */
console.log("\n== matchPersonaType：相似度经展示换算后不会出现 0% / 100% ==");
const { matchPersonaType } = await import("../lib/persona/fusion.ts");

const perfect = matchPersonaType({
  autonomy: 1, learning: 1, creation: 1, career: 1, social: 1, stability: 1,
});
rec("全 1 也能判出一个型", perfect !== null, perfect?.type);
rec(
  "相似度原值在 0~100 之间",
  perfect.similarity >= 0 && perfect.similarity <= 100,
  `${perfect.similarity}`,
);
rec(
  "经 toDisplayPercentText 后不会是 100%（最高 99%）",
  toDisplayPercentText(perfect.similarity / 100) !== "100%" &&
    toDisplayPercentText(perfect.similarity / 100) !== "0%",
  toDisplayPercentText(perfect.similarity / 100),
);

const nothing = matchPersonaType({});
rec("一个维度都没有 → null（不硬猜）", nothing === null);
const zeroes = matchPersonaType({ autonomy: 0, learning: 0, creation: 0, career: 0, social: 0, stability: 0 });
rec(
  "全 0 也会给出一个型，但展示值不是 0%",
  zeroes !== null && toDisplayPercentText(zeroes.similarity / 100) !== "0%",
  toDisplayPercentText(zeroes.similarity / 100),
);

/* ── ⑤ Agent 对话（规则兜底）不再产出 100% ───────────────────────────── */
console.log("\n== Agent Judge：五项全满也不许出现「综合匹配度 100%」==");
const { runMockAgentDialogue } = await import("../lib/agent/dialogue.ts");

/* 造一对**完全一样**的人格：规则版会算出各维 100 分 —— 正是踩过的坑 */
const twin = {
  id: "t1",
  displayName: "同一人",
  kind: "synthetic",
  interests: ["技术伦理", "写作", "播客", "长文阅读"],
  topics: ["技术 × 人文", "自我成长"],
  communicationStyle: ["先想清楚再说", "偏好书面"],
  values: { learning: 0.9, creation: 0.8, career: 0.6, social: 0.4, stability: 0.5, autonomy: 0.85 },
  personality: { sbti: { codes: "MHM-MHM-MMM-HMM-MHM", type: "僧人" } },
};
const twinB = { ...twin, id: "t2", displayName: "同一人 2" };
const { judge } = runMockAgentDialogue(twin, twinB);

rec(
  "overall 是 0~1 的小数（库约定不变）",
  judge.overall > 0 && judge.overall < 1,
  `overall=${judge.overall}`,
);
rec(
  "overall 不是 1（不会显示成 100%）",
  judge.overall !== 1,
  toDisplayPercentText(judge.overall),
);
rec(
  "五维都不是 0 或 1",
  Object.values(judge.dimensions).every((v) => v > 0 && v < 1),
  JSON.stringify(judge.dimensions),
);
rec(
  "summary 里的百分比不是 0% / 100%",
  !/综合匹配度\s*(0|100)%/.test(judge.summary),
  judge.summary.slice(0, 60),
);
rec(
  "推荐理由里也不出现 0% / 100%",
  judge.reasons.every((r) => !/\b(0|100)%/.test(r)),
  judge.reasons.join(" | ").slice(0, 100),
);

/* ── ⑥ 规则匹配评分也收进 [1,99] ─────────────────────────────────────── */
console.log("\n== scoreAll：发现页/快速匹配的相似度收进 [1,99] ==");
const { scoreAll } = await import("../lib/matching/quick.ts");
const scored = scoreAll(twin, [twinB]);
const r0 = scored[0];
rec("算出了结果", Boolean(r0));
rec("overall 在 [1,99]", r0.overall >= 1 && r0.overall <= 99, `${r0.overall}`);
rec(
  "每个有值的维度都在 [1,99]",
  Object.values(r0.dimensions).every((d) => d.score == null || (d.score >= 1 && d.score <= 99)),
  Object.entries(r0.dimensions)
    .map(([k, d]) => `${k}=${d.score}`)
    .join(" "),
);
rec(
  "理由里的百分比也都不是 0% / 100%",
  r0.reasons.every((r) => !/\b(0|100)%/.test(r)),
  r0.reasons.join(" | ").slice(0, 120),
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
