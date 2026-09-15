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
 * ⚠️ 口径必须走 `facetOptionsFor(source)`（与导入/同步/蒸馏三条路径同一张表）。
 * 这里以前不传 opts，于是微信/QQ 被按知乎长文口径算：短消息占比 ≥0.8 →
 * 判定"只有标题" → 三维整组丢掉、social 按 0/300 算成 1%（用户看到的那个 1%）。
 *
 * 用法：
 *   node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/recompute-facets.mjs --dry-run
 *   （去掉 --dry-run 才真正写库）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { facetFromContents } from "../lib/persona/fusion.ts";
import { facetOptionsForStored } from "../lib/persona/facet-opts.ts";

const DRY = process.argv.includes("--dry-run");

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
let changed = 0;

const fmt = (v) =>
  Object.entries(v ?? {})
    .map(([k, x]) => `${k}=${typeof x === "number" ? x.toFixed(2) : x}`)
    .join(" ") || "（无维度）";

for (const p of personas) {
  const rows = await prisma.personaEvidence.findMany({
    where: { personaId: p.id, source: { in: Object.keys(SOURCE_LABEL) } },
    select: { source: true, note: true, value: true },
  });

  const bySource = new Map();
  for (const r of rows) {
    const note = (r.note ?? "").trim();
    /* ⚠️ 只跳过**空**证据，不要按长度过滤。
       以前这里是 `note.length < 10` —— 对聊天记录是错的：微信/QQ 里大量
       「？」「byd」「爷」这种短消息恰恰是风格与重复率的来源（实测「？」×103），
       按 10 字过滤会把 200 条聊天砍到 90 条，跟导入路径的口径又不一致了
       （导入路径只滤空串）。修完两边的 itemCount 才对得上。 */
    if (!note) continue;
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
    const facet = facetFromContents(source, SOURCE_LABEL[source] ?? source, contents, {
      ...facetOptionsForStored(source),
    });
    if (!facet) continue;
    const key = `facets:${source}`;

    /* dry-run：只打印新旧差异，不写库 */
    if (DRY) {
      const old = await prisma.personaFeature.findUnique({
        where: { personaId_key: { personaId: p.id, key } },
      });
      const before = old?.value?.values;
      const after = facet.values;
      /* 比较要**与键顺序无关**：facetFromContents 里键的插入顺序会随分支变化，
         否则 dry-run 会把"只是顺序不同"也算成一次改动，噪声淹没真差异。 */
      const norm = (v) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(v ?? {}).sort(([a], [b]) => a.localeCompare(b)),
          ),
        );
      const diff = norm(before) !== norm(after) || old?.value?.summary !== facet.summary;
      if (diff) {
        changed += 1;
        parts.push(`\n      ${source}\n        旧 ${fmt(before)}\n        新 ${fmt(after)}`);
      }
      continue;
    }

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
  if (parts.length) console.log(`  ${DRY ? "·" : "✓"} ${p.displayName.padEnd(14)} ${parts.join(" | ")}`);
}

console.log(
  `\n${DRY ? "【dry-run，未写库】" : "重算完成"}：${DRY ? `将影响 ${changed} 份 facet` : `更新 ${updated} 位`}` +
    `，跳过 ${skipped} 位（无可用证据）`,
);
if (truncatedHits) {
  console.log(`⚠️ 有 ${truncatedHits} 条证据达到 2000 字上限（可能被截断）—— 若在意精度请重跑 backfill`);
}

await prisma.$disconnect();

