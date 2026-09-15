#!/usr/bin/env node
/**
 * 为什么重新蒸馏后雷达图没数据了？
 *
 * 假设：雷达现在优先画「融合值」（facet 的六维并集），而某个账号的
 * facet 只有 2 维（知乎源只给标题 → 依赖文本长度的三维留空），
 * 于是雷达只剩 2 条轴；而蒸馏写进 Persona.values 的六维**没被用上**。
 *
 * 要验证：
 *   ① 该 persona 的 facet 有哪几维
 *   ② Persona.values（蒸馏产物）有哪几维
 *   ③ buildPersonaBoard 最终交给雷达的是哪几维
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { buildPersonaBoard } from "../lib/persona-view.ts";
import { buildPersonaFacets } from "../lib/persona/source-facets.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

/* 找带 facet 的 OAuth 真人账号（截图里那个是 MALO 自评 + 4 条知乎证据） */
const candidates = await prisma.persona.findMany({
  where: { kind: "human", userId: { not: null } },
  select: {
    id: true,
    displayName: true,
    values: true,
    personality: true,
    _count: { select: { evidence: true } },
    features: { select: { key: true, value: true } },
  },
  orderBy: { updatedAt: "desc" },
  take: 6,
});

console.log("=== 真人账号的六维来源 ===");
for (const p of candidates) {
  const facetKeys = p.features.filter((f) => f.key.startsWith("facets:"));
  const vals = p.values;
  const sbti = (p.personality ?? {}).sbti;

  console.log(`\n── ${p.displayName} (证据 ${p._count.evidence} 条) ──`);
  console.log(`  Persona.values（蒸馏产物）：${vals ? JSON.stringify(vals) : "null"}`);
  console.log(`  SBTI：${sbti?.type ?? "(无)"}`);
  for (const f of facetKeys) {
    const v = f.value;
    console.log(
      `  ${f.key}：itemCount=${v?.itemCount} titleOnly=${v?.titleOnly} values=${JSON.stringify(v?.values)}`,
    );
  }
  if (!facetKeys.length) console.log("  （无 facet）");

  const facets = await buildPersonaFacets(p.id);
  const board = await buildPersonaBoard(p.id);
  const dims = (o) => (o ? Object.keys(o).join(",") : "(空)");
  console.log(`  buildPersonaFacets.fused 维度：${dims(facets?.fused)}`);
  console.log(
    `  → 雷达实际拿到的轴：${board?.axes.map((a) => `${a.label}:${a.value == null ? "—" : Math.round(a.value * 100) + "%"}`).join(" ")}`,
  );
  console.log(`  → axesSource=${board?.axesSource}`);
}

await prisma.$disconnect();
