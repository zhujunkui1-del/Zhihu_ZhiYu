#!/usr/bin/env node
/**
 * 真实用户人格数据到底注入了没有？
 *
 * 用户的疑问："为什么显示对方的『知乎数据未注入』，对方怎么什么数据都没有？"
 * 先把每个真实用户的**数据实况**打出来：
 *   · sources 里 zhihu 是否 injected
 *   · 五维/兴趣/话题/沟通风格/价值观有没有内容
 *   · evidence 有多少条（蒸馏的输入）
 *   · 是否蒸馏过（confidence / bio）
 *
 * 用法：node --env-file=.env scripts/audit-real-persona-data.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const personas = await prisma.persona.findMany({
  include: { sources: true, user: true, _count: { select: { evidence: true } } },
  orderBy: { displayName: "asc" },
});

/** 演示人格的名字形如「演示人格 01」。
    不能用 id 前缀判断：公开创作者的 kind 也是 synthetic。 */
const isBuiltin = (n) => /^演示人格\s*\d+$/.test(n);

const real = personas.filter((p) => !isBuiltin(p.displayName));
const builtin = personas.filter((p) => isBuiltin(p.displayName));

const nonEmpty = (v) => {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
};

const describe = (p) => {
  const zhihu = p.sources.find((s) => s.type === "zhihu");
  const filled = {
    兴趣: nonEmpty(p.interests),
    话题: nonEmpty(p.topics),
    沟通: nonEmpty(p.communicationStyle),
    思维: nonEmpty(p.thinkingStyle),
    价值: nonEmpty(p.values),
    社交: nonEmpty(p.socialStyle),
    SBTI: nonEmpty(p.personality?.sbti),
    bio: nonEmpty(p.bio),
  };
  const filledCount = Object.values(filled).filter(Boolean).length;
  return {
    name: p.displayName,
    kind: p.kind,
    zhihuInjected: zhihu?.status ?? "(无 source 行)",
    evidence: p._count.evidence,
    filledCount,
    filled: Object.entries(filled)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join("/"),
    completeness: Math.round(p.completeness ?? 0),
    hasUser: Boolean(p.userId),
  };
};

console.log(`共 ${personas.length} 个人格：真实 ${real.length} 个，内置演示 ${builtin.length} 个\n`);

console.log("== 真实用户：数据实况 ==");
console.log(
  ["名字".padEnd(16), "身份".padEnd(14), "知乎源".padEnd(12), "证据", "已填维度", "完整度"].join(" "),
);
for (const p of real) {
  const d = describe(p);
  console.log(
    [
      d.name.padEnd(16),
      (d.kind + (d.hasUser ? "" : "·无账号")).padEnd(14),
      d.zhihuInjected.padEnd(12),
      String(d.evidence).padStart(4),
      `${d.filledCount}/8 ${d.filled}`.padEnd(30),
      `${d.completeness}%`.padStart(5),
    ].join(" "),
  );
}

/* 汇总：这决定了"点开别人的人格卡为什么是空的" */
const zhihuInjected = real.filter((p) =>
  p.sources.some((s) => s.type === "zhihu" && s.status === "injected"),
).length;
const anyEvidence = real.filter((p) => p._count.evidence > 0).length;
const anyFilled = real.filter((p) => describe(p).filledCount >= 3).length;

console.log("\n== 汇总 ==");
console.log(`  知乎源 injected：${zhihuInjected}/${real.length}`);
console.log(`  有 evidence（蒸馏输入）：${anyEvidence}/${real.length}`);
console.log(`  已填 >=3 个维度（看起来"有人格"）：${anyFilled}/${real.length}`);

const totalEvidence = await prisma.personaEvidence.count();
console.log(`  全库 evidence 总数：${totalEvidence}`);

await prisma.$disconnect();
