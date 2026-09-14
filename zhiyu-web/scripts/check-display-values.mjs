#!/usr/bin/env node
/**
 * 走**弹窗同一条代码路径**（buildPersonaBoard）看最终展示值。
 *
 * 为什么不能只看库里的 `completeness` 字段：它是派生值，
 * `buildPersonaBoard()` 每次读取时会重算并回写；直接查库看到的可能是旧值
 * （实测出现过库里 45% 而真实只有 1 个来源类别）。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { buildPersonaBoard } from "../lib/persona-view.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const names = process.argv.slice(2);
const targets = names.length ? names : ["张佳玮", "毕导", "丁香医生", "梅启铭", "演示用户"];

console.log("buildPersonaBoard 计算出的展示值（= 弹窗/人格页看到的）");
console.log("=".repeat(80));

for (const n of targets) {
  const p = await prisma.persona.findFirst({ where: { displayName: n }, select: { id: true } });
  if (!p) {
    console.log(`\n${n}：不存在`);
    continue;
  }
  const b = await buildPersonaBoard(p.id);
  if (!b) {
    console.log(`\n${n}：装配失败`);
    continue;
  }
  const injected = b.sourceChips.filter((c) => c.injected).map((c) => c.type);
  console.log(`\n${n}`);
  console.log(`  完整度      = ${b.completeness}%   覆盖类别 ${b.coveredCategories}/4   阶段 ${b.stage}`);
  console.log(`  已注入源    = ${injected.join(", ") || "(无)"}`);
  console.log(`  五维（非空） = ${b.axes.filter((a) => a.value != null).map((a) => `${a.label}=${Math.round(a.value * 100)}%`).join(" ") || "(全部为空)"}`);
  console.log(`  SBTI        = ${b.sbti?.type ?? "(无)"}`);
}

await prisma.$disconnect();
