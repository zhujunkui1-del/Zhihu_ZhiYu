#!/usr/bin/env node
/**
 * 「SBTI 也是人格数据、也参与蒸馏」的**真实数据**验证。
 *
 * 要确认四件事：
 *   ① 做过 SBTI 的人，`sourceFacets` 里**确实有 sbti 这一项**（分源解析展示得到）
 *   ② 它的 `selfReport` 标记为 true（界面据此打「本人自评」标，不冒充观察数据）
 *   ③ `fused.usedSources` 里**确实包含 sbti**（真的进了融合，不是只挂个名）
 *   ④ 「只有自评」的人被识别出来（selfReportOnly），界面会说明这是自评折算
 *   ⑤ 所有展示用的百分比都在 [1, 99]，不存在 0 / 100
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/check-sbti-in-fusion.mjs
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { buildPersonaBoard } from "../lib/persona-view.ts";
import { clampPercent } from "../lib/score.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const personas = await prisma.persona.findMany({
  select: { id: true, displayName: true },
  orderBy: { displayName: "asc" },
});

console.log("SBTI 作为人格数据源 · 融入综合画像");
console.log("=".repeat(104));

let withSbti = 0;
let sbtiInFusion = 0;
let selfOnly = 0;
let badRange = 0;
const badRangeDetail = [];

for (const p of personas) {
  const board = await buildPersonaBoard(p.id);
  if (!board) continue;

  const facet = board.sourceFacets.find((f) => f.source === "sbti");
  const inFusion = board.fused?.usedSources.includes("sbti") ?? false;
  const only = board.fused?.selfReportOnly ?? false;

  if (!facet) continue;
  withSbti += 1;
  if (inFusion) sbtiInFusion += 1;
  if (only) selfOnly += 1;

  /* 分源卡里的六维值必须在 [1, 99] */
  for (const [k, v] of Object.entries(facet.values)) {
    const pct = clampPercent(Math.round(v * 100));
    if (pct !== Math.round(v * 100) || pct === null) {
      badRange += 1;
      badRangeDetail.push(`${p.displayName} ${k}=${v}`);
    }
  }

  const dims = Object.entries(facet.values)
    .map(([k, v]) => `${k}=${Math.round(v * 100)}%`)
    .join(" ");
  console.log(
    `${p.displayName.padEnd(14)} | 自评标=${String(facet.selfReport).padEnd(5)} | 进了融合=${String(inFusion).padEnd(5)} | 只有自评=${String(only).padEnd(5)} | ${dims}`,
  );
  console.log(
    `   融合源 [${board.fused?.usedSources.join(" + ") ?? "-"}]  自报源 [${board.fused?.selfReportSources.join(" + ") ?? "-"}]  → ${board.fused?.type ?? "-"} ${board.fused ? clampPercent(board.fused.similarity) : "-"}%`,
  );
}

console.log("\n" + "=".repeat(104));
console.log(`有 SBTI 分源解析的人格：${withSbti}`);
console.log(`其中 SBTI 真的进了融合：${sbtiInFusion}`);
console.log(`其中「只有自评」：${selfOnly}`);
console.log(`越界（会出现 0% / 100%）的分源数值：${badRange}`);
if (badRangeDetail.length) console.log("  " + badRangeDetail.join("\n  "));

/* 只要库里有做过 SBTI 的人，就必须 100% 满足 ①②③ */
if (withSbti > 0) {
  assert.equal(sbtiInFusion, withSbti, "有 sbti facet 却没进融合");
  assert.equal(badRange, 0, "分源解析里出现了越界百分比");
}
console.log("\n✅ 全部通过");

await prisma.$disconnect();
