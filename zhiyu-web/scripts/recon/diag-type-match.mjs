#!/usr/bin/env node
/** 用真实融合向量算六型相似度（看判型到底有多"稳"） */
const { matchPersonaType, TYPE_ARCHETYPES, VALUE_KEYS } = await import(
  "../../lib/persona/fusion.ts"
);

const v = { learning: 0.5, creation: 0.5, social: 0.1325, stability: 0.5, autonomy: 0.7475 };
const eff = VALUE_KEYS.map((k) => (typeof v[k] === "number" ? v[k] : 0.5));

console.log("融合六维（career 无任何源提供 → 按 0.5 中性填）：");
console.log(" ", JSON.stringify(v), " career=0.5(填空)");

const t = matchPersonaType(v);
console.log(`\n判型：${t.type} ${t.similarity}%`);
console.log(`次优：${t.runnerUp.map((r) => `${r.type} ${r.similarity}%`).join(" / ")}`);

console.log("\n六型精确相似度（未取整）：");
const rows = TYPE_ARCHETYPES.map((a) => {
  const sq = VALUE_KEYS.reduce((s, k, i) => s + (eff[i] - a.values[k]) ** 2, 0);
  const d = Math.sqrt(sq) / Math.sqrt(VALUE_KEYS.length);
  return { type: a.type, sim: (1 - d) * 100 };
}).sort((x, y) => y.sim - x.sim);
for (const r of rows) console.log(`  ${r.type.padEnd(6)} ${r.sim.toFixed(4)}%`);
console.log(
  `\n第一名与第二名差距：${(rows[0].sim - rows[1].sim).toFixed(4)} 个百分点` +
    `（四舍五入到整数后：${Math.round(rows[0].sim)}% vs ${Math.round(rows[1].sim)}%）`,
);

/* 做一个扰动实验：career 从 0.5 挪一点，看判型会不会翻 */
console.log("\n扰动实验（只动 career，其它不变）：");
for (const c of [0.4, 0.5, 0.6, 0.7]) {
  const tt = matchPersonaType({ ...v, career: c });
  console.log(`  career=${c} → ${tt.type} ${tt.similarity}%`);
}
