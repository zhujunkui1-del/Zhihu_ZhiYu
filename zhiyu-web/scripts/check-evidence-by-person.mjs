#!/usr/bin/env node
/**
 * 604 条知乎证据到底属于谁？内容是什么？
 *
 * 之前的排查把所有人的证据混在一起看，结果被"某个人的异常数据"带偏
 * （看到 604 条全是同一句 35 字文案）。必须**按人**看。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

/* 按 persona 分组统计知乎证据 */
const groups = await prisma.personaEvidence.groupBy({
  by: ["personaId", "trait"],
  where: { source: "zhihu" },
  _count: { _all: true },
});

const personaIds = [...new Set(groups.map((g) => g.personaId))];
const personas = await prisma.persona.findMany({
  where: { id: { in: personaIds } },
  select: { id: true, displayName: true },
});
const nameOf = new Map(personas.map((p) => [p.id, p.displayName]));

const byPersona = new Map();
for (const g of groups) {
  const cur = byPersona.get(g.personaId) ?? { total: 0, traits: [] };
  cur.total += g._count._all;
  cur.traits.push(`${g.trait}×${g._count._all}`);
  byPersona.set(g.personaId, cur);
}

console.log("按人统计知乎证据：");
console.log("=".repeat(80));
const sorted = [...byPersona.entries()].sort((a, b) => b[1].total - a[1].total);
for (const [pid, v] of sorted) {
  console.log(`  ${(nameOf.get(pid) ?? pid).padEnd(16)} ${String(v.total).padStart(3)} 条  [${v.traits.join(", ")}]`);
}

/* 看几个人的真实 note 内容与长度 */
console.log("\n抽样看 note 实际内容（每人前 2 条）：");
for (const [pid] of sorted.slice(0, 5)) {
  const rows = await prisma.personaEvidence.findMany({
    where: { personaId: pid, source: "zhihu" },
    select: { note: true, trait: true, value: true },
    take: 2,
  });
  console.log(`\n  ── ${nameOf.get(pid) ?? pid} ──`);
  for (const r of rows) {
    const n = r.note ?? "";
    console.log(`    trait=${r.trait} value=${r.value} [${n.length} 字] ${JSON.stringify(n.slice(0, 80))}`);
  }
}

/* 长度分布（按人分开） */
console.log("\n每人 note 平均长度：");
for (const [pid, v] of sorted) {
  const rows = await prisma.personaEvidence.findMany({
    where: { personaId: pid, source: "zhihu" },
    select: { note: true },
  });
  const lens = rows.map((r) => (r.note ?? "").length);
  const avg = lens.reduce((s, n) => s + n, 0) / lens.length;
  const longOnes = lens.filter((n) => n >= 120).length;
  console.log(
    `  ${(nameOf.get(pid) ?? pid).padEnd(16)} 平均 ${avg.toFixed(0).padStart(4)} 字 · >=120字 ${String(longOnes).padStart(3)}/${lens.length}`,
  );
}

await prisma.$disconnect();
