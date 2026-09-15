#!/usr/bin/env node
/**
 * 只读诊断：某人的**分源解析 + 数据体检 + 融合值**（人格页读的就是这些）。
 *
 * 排查"为什么这一维没有""为什么这个源没算进综合画像"时用它，
 * 不用开浏览器也不需要登录态。
 *
 * 用法：
 *   node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env \
 *        scripts/diag-facets-now.mjs [personaId] [--all]
 */
import { prisma } from "../lib/db.ts";
import { buildPersonaFacets } from "../lib/persona/source-facets.ts";
import { buildPersonaBoard } from "../lib/persona-view.ts";

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const id = args.find((a) => !a.startsWith("--"));

const targets = showAll
  ? (
      await prisma.persona.findMany({
        select: { id: true, displayName: true, _count: { select: { evidence: true } } },
        orderBy: { displayName: "asc" },
      })
    )
      .filter((p) => p._count.evidence > 0)
      .map((p) => p.id)
  : [id ?? "cmu0siad8000204l8z7dg9n92"];

for (const pid of targets) {
  const f = await buildPersonaFacets(pid);
  if (!f) {
    console.log(`${pid} → 找不到`);
    continue;
  }
  const view = await buildPersonaBoard(pid);
  console.log(`\n=== ${view?.displayName ?? pid} (${pid}) ===`);
  for (const s of f.sources) {
    console.log(
      `  ${s.source.padEnd(9)} items=${String(s.itemCount).padEnd(4)} ${JSON.stringify(s.values)}`,
    );
  }
  console.log("  fused:", JSON.stringify(f.fused));
  console.log("  判型:", f.type ? `${f.type.type} ${f.type.similarity}%` : "null");
  console.log("  自报源:", JSON.stringify(f.selfReportSources), " 跳过:", JSON.stringify(f.skippedSources));
  if (f.warnings.length) {
    console.log("  体检警告:");
    for (const w of f.warnings) console.log(`    · [${w.code}] ${w.text}`);
  }
  if (view) {
    console.log("  雷达五轴:", JSON.stringify(view.axes.map((a) => [a.label, a.value])));
    console.log("  轴来源:", view.axesSource, " 含自评:", view.axesIncludesSelfReport);
  }
}

await prisma.$disconnect();
