#!/usr/bin/env node
/**
 * 分值量级的纯逻辑测试。
 *
 * ── 为什么单独测 ──────────────────────────────────────────────────────
 * 这里出过两个真实 bug，而且都只在"特定路径"上可见：
 *   ① `/api/agent/meet` 把库里的 `overallScore = 0.82` 显示成 **"1%"**
 *      （漏了 ×100）—— 只有真跑一次 LLM 对话才会看到。
 *   ② 规则兜底（mock）的推荐理由写成 `if (dimensions.interest >= 0.6)` 配
 *      `Math.round(dimensions.interest * 100)`，而 dimensions 是 **0~100**，
 *      于是阈值恒真、文案变成 **"兴趣同频 6000%"**。
 *      LLM 路径正常，所以只看 LLM 的测试发现不了。
 *
 * 本文件把两条路径的量级都钉住，不依赖数据库与网络。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-score-scale.mjs
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

/* ── ① 换算函数 ──────────────────────────────────────────────────────── */
console.log("\n== toPercent：0~1 与 0~100 两种量级都要正确 ==");
const { toPercent, toPercentText } = await import("../lib/score.ts");

rec("0.82 → 82（库里的小数）", toPercent(0.82) === 82, `${toPercent(0.82)}`);
rec("0 → 0", toPercent(0) === 0, `${toPercent(0)}`);
rec("1 → 100（边界：1 当作 100%，不是 1%）", toPercent(1) === 100, `${toPercent(1)}`);
rec("1.0 的整型写法", toPercent(1.0) === 100, `${toPercent(1.0)}`);
rec("0.005 → 1（四舍五入）", toPercent(0.005) === 1, `${toPercent(0.005)}`);
rec("73 → 73（历史数据是 0~100 的整数）", toPercent(73) === 73, `${toPercent(73)}`);
rec("100 → 100", toPercent(100) === 100, `${toPercent(100)}`);
rec("超过 100 会被夹住", toPercent(150) === 100, `${toPercent(150)}`);
rec("负数会被夹到 0", toPercent(-5) === 0, `${toPercent(-5)}`);
rec("null → null（调用方显示「—」）", toPercent(null) === null);
rec("undefined → null", toPercent(undefined) === null);
rec("NaN → null", toPercent(NaN) === null);
rec("toPercentText 带百分号", toPercentText(0.82) === "82%", toPercentText(0.82));
rec("toPercentText 空值给兜底", toPercentText(null) === "—", toPercentText(null));

/* ── ② 规则兜底路径的分值与理由文案 ─────────────────────────────────── */
console.log("\n== runMockAgentDialogue：分值与理由都在合理量级 ==");
const { runMockAgentDialogue } = await import("../lib/agent/dialogue.ts");

/** 造两个有真实字段的人格，确保各维度都能算出来（而不是走 ?? 兜底） */
const personaA = {
  id: "a",
  displayName: "甲",
  kind: "synthetic",
  interests: ["技术伦理", "长文阅读", "写作", "效率工具"],
  topics: ["技术 × 人文", "自我成长"],
  communicationStyle: ["先想清楚再说", "偏好书面"],
  values: { learning: 0.9, creation: 0.8, career: 0.6, social: 0.4, stability: 0.5, autonomy: 0.85 },
  personality: { sbti: { codes: "MHM-MHM-MMM-HMM-MHM", type: "深度思考型" } },
};
const personaB = {
  id: "b",
  displayName: "乙",
  kind: "synthetic",
  interests: ["技术伦理", "播客", "写作"],
  topics: ["技术 × 人文", "系统思维"],
  communicationStyle: ["结论后置", "偏好书面"],
  values: { learning: 0.8, creation: 0.7, career: 0.7, social: 0.5, stability: 0.6, autonomy: 0.6 },
  personality: { sbti: { codes: "HHM-MHM-MMM-HMM-MHM", type: "深度思考型" } },
};

const { rounds, judge } = runMockAgentDialogue(personaA, personaB);

rec("产出了 5 轮对话", rounds.length === 5, `${rounds.length} 轮`);
rec(
  "overall 是 0~1 的小数（与库约定一致）",
  judge.overall > 0 && judge.overall <= 1,
  `overall=${judge.overall}`,
);
rec(
  "overall 换算成百分数是合理值",
  (() => {
    const p = toPercent(judge.overall);
    return p !== null && p >= 0 && p <= 100;
  })(),
  `${toPercentText(judge.overall)}`,
);
rec(
  "五个维度都在 0~1 量级（经 round1 归一，与 LLM 路径一致）",
  Object.values(judge.dimensions).every((v) => typeof v === "number" && v >= 0 && v <= 1),
  JSON.stringify(judge.dimensions),
);
/* 这条断言是"防呆"：dimensions 一旦被改成 0~100，阈值判断与文案就会一起错。
   之前我正是误判了量级，差点把正确的理由逻辑改坏。 */
rec(
  "阈值判断真的在起作用（不是恒真）",
  judge.dimensions.interest < 0.6 || judge.reasons.some((r) => r.includes("兴趣同频")),
  `interest=${judge.dimensions.interest} → ${judge.reasons.length} 条理由`,
);

console.log("\n  推荐理由：");
for (const r of judge.reasons) console.log(`    · ${r}`);
rec(
  "理由里的百分比没有 4 位以上的畸形值（曾经出现 6000%）",
  judge.reasons.every((r) => !/\d{4,}%/.test(r)),
  judge.reasons.filter((r) => /\d{4,}%/.test(r)).join(" | ") || "全部正常",
);
/* 相似度高的那一对应当**确实命中**若干条理由 —— 否则说明阈值被改错了
   （维度若被当成 0~100，`>= 0.6` 会恒真、五条全出；反之若多除一次 100，
   会一条都不出）。这里要求"至少一条"，把量级钉住。 */
rec(
  "高度相似的一对至少命中一条理由（量级正确才会命中）",
  judge.reasons.some((r) => /兴趣同频|思维共振|价值观适配|沟通适配|互补度/.test(r)),
  judge.reasons.join(" | "),
);
rec(
  "summary 里的综合匹配度是 0~100",
  (() => {
    const m = /综合匹配度\s*(\d+)%/.exec(judge.summary);
    if (!m) return false;
    const v = Number(m[1]);
    return v >= 0 && v <= 100;
  })(),
  judge.summary.slice(0, 70),
);
/* 阈值判断要真的在起作用：不相似的一对不该五条理由全出 */
const far = runMockAgentDialogue(
  { ...personaA, interests: ["云南咖啡"], topics: ["咖啡"], communicationStyle: ["直接"], values: {}, personality: {} },
  { ...personaB, interests: ["量子物理"], topics: ["物理"], communicationStyle: ["幽默"], values: {}, personality: {} },
);
rec(
  "差异大的一对不会五条理由全出（阈值真的生效）",
  far.judge.reasons.length < 5 || far.judge.reasons[0].includes("信息有限"),
  `${far.judge.reasons.length} 条：${far.judge.reasons.join(" | ").slice(0, 90)}`,
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
