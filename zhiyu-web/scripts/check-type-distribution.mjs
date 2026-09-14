#!/usr/bin/env node
/**
 * 为什么 24 个判型里有 19 个是「务实执行型」？
 *
 * 假设：判型用了**六个维度的完整距离**，而公开内容其实只能观察到其中几个
 * （career「事业成就」几乎无法从内容里看出来）。缺的维度被当成 0.5 中性值，
 * 于是所有人的向量都朝中心收缩，而"最中间"的那个原型就会通吃。
 *
 * 量出来验证：
 *   ① 真实用户实际能算出哪几个维度、取值分布如何
 *   ② 六个原型两两之间的区分度
 *   ③ 每个原型离"均值点"多远（越近越容易通吃）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { buildPersonaFacets } from "../lib/persona/source-facets.ts";
import { TYPE_ARCHETYPES, VALUE_KEYS } from "../lib/persona/fusion.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

/* ① 真实用户实际拿到的维度 */
const personas = await prisma.persona.findMany({
  where: { id: { startsWith: "zhihu-" } },
  select: { id: true, displayName: true },
});

console.log("① 每个真实用户**实际算出来**的维度：");
console.log("=".repeat(96));
const dimHits = new Map();
for (const p of personas) {
  const f = await buildPersonaFacets(p.id);
  if (!f || !f.type) continue;
  const keys = VALUE_KEYS.filter((k) => typeof f.fused[k] === "number");
  for (const k of keys) dimHits.set(k, (dimHits.get(k) ?? 0) + 1);
  const shown = VALUE_KEYS.map((k) =>
    typeof f.fused[k] === "number" ? `${k}=${f.fused[k].toFixed(2)}` : `${k}=--`,
  ).join(" ");
  console.log(`  ${p.displayName.padEnd(12)} ${shown}`);
}

console.log("\n各维度**有数据**的用户数（共 " + personas.length + "）：");
for (const k of VALUE_KEYS) {
  const n = dimHits.get(k) ?? 0;
  console.log(`  ${k.padEnd(12)} ${"█".repeat(n)} ${n}`);
}

/* ② 原型两两最小距离（区分度） */
console.log("\n② 六个原型之间的最小距离（同一维度下差多少）：");
for (let i = 0; i < TYPE_ARCHETYPES.length; i++) {
  for (let j = i + 1; j < TYPE_ARCHETYPES.length; j++) {
    const a = TYPE_ARCHETYPES[i];
    const b = TYPE_ARCHETYPES[j];
    const diffs = VALUE_KEYS.map((k) => Math.abs(a.values[k] - b.values[k]));
    const maxDim = VALUE_KEYS[diffs.indexOf(Math.max(...diffs))];
    const mean = diffs.reduce((s, n) => s + n, 0) / diffs.length;
    if (mean < 0.12) {
      console.log(
        `  ⚠️ ${a.type} vs ${b.type}：平均差仅 ${mean.toFixed(3)}（最大差在 ${maxDim}=${Math.max(...diffs).toFixed(2)}）`,
      );
    }
  }
}

/* ③ 各原型离"全维均值"的距离 —— 越近越容易通吃 */
const grand = VALUE_KEYS.map(
  (k) => TYPE_ARCHETYPES.reduce((s, a) => s + a.values[k], 0) / TYPE_ARCHETYPES.length,
);
console.log("\n③ 各原型与本组均值点的距离（越小越'平庸'、越容易通吃）：");
const ranked = TYPE_ARCHETYPES.map((a) => {
  const sq = VALUE_KEYS.reduce((s, k, i) => s + (a.values[k] - grand[i]) ** 2, 0);
  return { type: a.type, dist: Math.sqrt(sq) };
}).sort((x, y) => x.dist - y.dist);
for (const r of ranked) console.log(`  ${r.type.padEnd(8)} ${r.dist.toFixed(4)}`);

console.log("\n④ 均值点本身最像谁：");
const sqAll = TYPE_ARCHETYPES.map((a) => {
  const sq = VALUE_KEYS.reduce((s, k, i) => s + (grand[i] - a.values[k]) ** 2, 0);
  return { type: a.type, dist: Math.sqrt(sq) };
}).sort((x, y) => x.dist - y.dist);
for (const r of sqAll) console.log(`  ${r.type.padEnd(8)} ${r.dist.toFixed(4)}`);

await prisma.$disconnect();
