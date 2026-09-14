#!/usr/bin/env node
/**
 * 综合画像（多源融合）判定验证。
 *
 * 要确认三件事：
 *   ① 真实知乎用户**能**判出倾向型（此前他们永远是空的）
 *   ② 判定结果来自**观察数据**，不是 SBTI 自评
 *   ③ 六型原型之间的区分度正常（不是所有人都被判成同一型）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/check-fused-type.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { buildPersonaFacets } from "../lib/persona/source-facets.ts";
import { matchPersonaType, PERSONA_TYPES } from "../lib/persona/fusion.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const isDemo = (n) => /^演示人格\s*\d+$/.test(n);
const personas = await prisma.persona.findMany({
  select: { id: true, displayName: true, values: true, _count: { select: { evidence: true } } },
  orderBy: { displayName: "asc" },
});

console.log("综合画像（多源融合 → 六型倾向）");
console.log("=".repeat(96));

let judged = 0;
const typeCount = new Map();

for (const p of personas) {
  const f = await buildPersonaFacets(p.id);
  if (!f) continue;

  const label = isDemo(p.displayName) ? "演示" : "真实";
  const srcText = f.usedSources.length ? f.usedSources.join("+") : "(无观察源)";
  const selfText = f.selfReport ? `SBTI=${f.selfReport.type}` : "无SBTI";

  const fusedText = f.type
    ? `${f.type.type} ${f.type.similarity}%`
    : "(数据不足，不判型)";

  if (f.type) {
    judged += 1;
    typeCount.set(f.type.type, (typeCount.get(f.type.type) ?? 0) + 1);
  }

  console.log(
    `${label} ${p.displayName.padEnd(14)} 证据${String(p._count.evidence).padStart(3)} | 源 ${srcText.padEnd(12)} | ${selfText.padEnd(12)} | 综合画像 → ${fusedText}`,
  );
}

console.log("\n" + "=".repeat(96));
console.log(`判出倾向型：${judged}/${personas.length}`);
console.log("\n六型分布（看区分度，不应该全挤在一型）：");
for (const t of PERSONA_TYPES) {
  const n = typeCount.get(t) ?? 0;
  console.log(`  ${t.padEnd(8)} ${"█".repeat(n)} ${n}`);
}

/* 原型自身应各自判定为对应型（自洽性检查） */
console.log("\n原型自洽性（每个原型喂给自己，应判回自己）：");
const { TYPE_ARCHETYPES } = await import("../lib/persona/fusion.ts");
let selfOk = 0;
for (const a of TYPE_ARCHETYPES) {
  const m = matchPersonaType(a.values);
  const ok = m?.type === a.type;
  if (ok) selfOk += 1;
  console.log(`  ${a.type.padEnd(8)} → ${m?.type ?? "null"} ${m?.similarity ?? 0}%  ${ok ? "✅" : "❌"}`);
}
console.log(`  自洽 ${selfOk}/${TYPE_ARCHETYPES.length}`);

await prisma.$disconnect();
