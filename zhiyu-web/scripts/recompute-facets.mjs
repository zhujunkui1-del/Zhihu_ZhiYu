#!/usr/bin/env node
/**
 * 用库里**已有的正文证据**重算分源解析（facet），不重新抓取。
 *
 * 为什么可以这么做：上一轮回填已经把真实正文写进 `PersonaEvidence.note`
 * （上限 2000 字，实测正文大多能放下），且带着真实点赞数。
 * 所以能直接从库重算，省掉一轮 26 人的抓取。
 *
 * 什么时候必须重新抓：note 被截断到 2000 字以下、或正文本身就超长的情况，
 * 那种要回到 `backfill-real-zhihu.mjs` 重跑。本脚本会在末尾报告这类行数。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/recompute-facets.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { facetFromContents } from "../lib/persona/fusion.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const SOURCE_LABEL = {
  zhihu: "知乎 · 公共表达",
  wechat: "微信 · 私域生活",
  qq: "QQ · 私域表达",
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
};

const personas = await prisma.persona.findMany({
  select: { id: true, displayName: true },
  orderBy: { displayName: "asc" },
});

let updated = 0;
let skipped = 0;
let truncatedHits = 0;

for (const p of personas) {
  const rows = await prisma.personaEvidence.findMany({
    where: { personaId: p.id, source: { in: Object.keys(SOURCE_LABEL) } },
    select: { source: true, note: true, value: true },
  });

  const bySource = new Map();
  for (const r of rows) {
    const note = (r.note ?? "").trim();
    if (note.length < 10) continue; // 占位/空证据不参与
    if (note.length >= 2000) truncatedHits += 1; // 可能被截断，提示需重抓
    const list = bySource.get(r.source) ?? [];
    list.push({ text: note, heat: typeof r.value === "number" ? r.value : undefined });
    bySource.set(r.source, list);
  }

  if (bySource.size === 0) {
    skipped += 1;
    continue;
  }

  const parts = [];
  for (const [source, contents] of bySource) {
    const facet = facetFromContents(source, SOURCE_LABEL[source] ?? source, contents);
    if (!facet) continue;
    const key = `facets:${source}`;
    await prisma.personaFeature.upsert({
      where: { personaId_key: { personaId: p.id, key } },
      update: { value: facet },
      create: { personaId: p.id, key, value: facet },
    });
    parts.push(
      `${source}(${facet.itemCount}条 ${Object.entries(facet.values)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(" ")})`,
    );
  }
  updated += 1;
  console.log(`  ✓ ${p.displayName.padEnd(14)} ${parts.join(" | ")}`);
}

console.log(`\n重算完成：更新 ${updated} 位，跳过 ${skipped} 位（无可用证据）`);
if (truncatedHits) {
  console.log(`⚠️ 有 ${truncatedHits} 条证据达到 2000 字上限（可能被截断）—— 若在意精度请重跑 backfill`);
}

await prisma.$disconnect();
