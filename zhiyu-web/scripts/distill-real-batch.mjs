#!/usr/bin/env node
/**
 * 对真实知乎用户批量跑 **LLM 蒸馏**，把证据归纳成真人格数据。
 *
 * 为什么要单独批量跑：
 *   页面上那个「开始蒸馏」只能蒸**自己**的 persona（接口有越权保护，
 *   这是对的）。而这 26 位公开创作者根本没有知遇账号，没人能替他们点按钮。
 *   所以用一个离线脚本，走**与应用完全相同的蒸馏实现**（直接 import
 *   `distillPersona`），保证结论格式、溯源、回退行为都一致 ——
 *   绝不另写一套"批量版"逻辑，否则两处产出会不一样。
 *
 * 用法：
 *   node --env-file=.env scripts/distill-real-batch.mjs              # 全部
 *   node --env-file=.env scripts/distill-real-batch.mjs --only=张佳玮
 *   node --env-file=.env scripts/distill-real-batch.mjs --dry        # 只看谁会被蒸
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { distillPersona } from "../lib/persona/distill.ts";
import { platformProvider } from "../lib/llm/platform.ts";

const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith("--only="));
  return a ? new Set(a.slice("--only=".length).split(",").map((s) => s.trim())) : null;
})();
const DRY = process.argv.includes("--dry");

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const provider = platformProvider();
if (!provider) {
  console.error("✗ 未配置平台大模型（AI_API_KEY），无法蒸馏");
  process.exit(1);
}
console.log(`平台模型：${provider.model} @ ${provider.baseUrl}\n`);

const isBuiltin = (n) => /^演示人格\s*\d+$/.test(n);

const personas = await prisma.persona.findMany({
  select: {
    id: true,
    displayName: true,
    _count: { select: { evidence: true } },
  },
  orderBy: { displayName: "asc" },
});

/* 只蒸"真实用户 + 有证据"的；内置演示人格已在 seed 里备好人设，不必重蒸 */
const targets = personas
  .filter((p) => !isBuiltin(p.displayName))
  .filter((p) => p._count.evidence > 0)
  .filter((p) => (ONLY ? ONLY.has(p.displayName) : true));

console.log(`待蒸馏 ${targets.length} 位（有证据的真实用户）`);
if (DRY) {
  for (const t of targets) console.log(`  ${t.displayName.padEnd(16)} 证据 ${t._count.evidence} 条`);
  await prisma.$disconnect();
  process.exit(0);
}

const t0 = Date.now();
let ok = 0;
let failed = 0;
const failures = [];

for (const [i, t] of targets.entries()) {
  const idx = `[${String(i + 1).padStart(2)}/${targets.length}]`;
  const s0 = Date.now();
  try {
    /* 走应用同一套实现：证据先行 → LLM 归纳 → 写回 + 溯源 */
    const r = await distillPersona(t.id, provider);
    const ms = Date.now() - s0;

    if (!r.ok) {
      failed += 1;
      failures.push(`${t.displayName}: ${r.llmError ?? "未知原因"}`);
      console.log(`${idx} ${t.displayName.padEnd(16)} ✗ ${r.llmError ?? "失败"}`);
      continue;
    }

    ok += 1;
    const g = r.distilled;
    console.log(
      `${idx} ${t.displayName.padEnd(16)} ✓ ${r.method === "llm" ? "LLM" : "规则"} · 证据 ${r.evidenceCount} 条 · 写入 ${r.written} 字段 · ${(ms / 1000).toFixed(1)}s`,
    );
    if (g.interests?.length) console.log(`      兴趣：${g.interests.join(" / ")}`);
    if (g.types?.length) console.log(`      倾向：${g.types.join(" / ")}`);
    if (g.summary) console.log(`      摘要：${g.summary.slice(0, 100)}`);
  } catch (e) {
    failed += 1;
    failures.push(`${t.displayName}: ${String(e.message).slice(0, 90)}`);
    console.log(`${idx} ${t.displayName.padEnd(16)} ✗ 异常：${String(e.message).slice(0, 90)}`);
  }

  /* 温柔一点，别把网关打爆 */
  await new Promise((r) => setTimeout(r, 400));
}

const total = Date.now() - t0;
console.log(`\n${"=".repeat(86)}`);
console.log(`蒸馏完成：成功 ${ok}，失败 ${failed}，总耗时 ${(total / 1000).toFixed(1)}s`);
console.log(`  平均 ${Math.round(total / Math.max(1, targets.length))} ms/人`);
if (failures.length) {
  console.log("\n失败明细：");
  for (const f of failures) console.log(`  · ${f}`);
}

await prisma.$disconnect();
