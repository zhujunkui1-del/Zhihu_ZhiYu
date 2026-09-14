#!/usr/bin/env node
/**
 * 细看几个人格：证据、六源、完整度为什么是 45%。
 *
 * 疑点：补完数据后多数人完整度仍是 45%，而完整度 = 已覆盖来源类别/4。
 * 需要确认这是"只有知乎一个源"的正常结果，还是有源没被算进去。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const NAMES = process.argv.slice(2);
const targets = NAMES.length ? NAMES : ["梅启铭", "毕导", "铁木君", "张佳玮", "丁香医生"];

for (const name of targets) {
  const p = await prisma.persona.findFirst({
    where: { displayName: name },
    include: { sources: true, _count: { select: { evidence: true } } },
  });
  if (!p) {
    console.log(`${name}：不存在`);
    continue;
  }
  console.log(`\n=== ${name} ===`);
  console.log(`  publicRef   = ${p.publicRef ?? "(空)"}`);
  console.log(`  completeness= ${p.completeness}%`);
  console.log(`  evidence    = ${p._count.evidence} 条`);
  console.log(`  sources     = ${p.sources.map((s) => `${s.type}:${s.status}`).join(", ") || "(无)"}`);
  console.log(`  interests   = ${JSON.stringify(p.interests)?.slice(0, 130) ?? "null"}`);
  console.log(`  topics      = ${JSON.stringify(p.topics)?.slice(0, 100) ?? "null"}`);
  console.log(`  comm        = ${JSON.stringify(p.communicationStyle)?.slice(0, 100) ?? "null"}`);
  console.log(`  values      = ${JSON.stringify(p.values)?.slice(0, 130) ?? "null"}`);
  console.log(`  bio         = ${p.bio ? p.bio.slice(0, 90) : "(空)"}`);
  const conf = p.confidence;
  console.log(`  confidence  = method=${conf?.method ?? "-"} evidenceCount=${conf?.evidenceCount ?? "-"}`);
}

await prisma.$disconnect();
