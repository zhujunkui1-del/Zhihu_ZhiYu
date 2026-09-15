#!/usr/bin/env node
/**
 * 诊断：注入数据后「未注入」状态为什么不更新。
 * 只读，不改任何东西。
 *
 * 打印每个真实用户的人格当前状态：
 *   · PersonaSource 行（status / importedAt）—— 界面徽章读的就是它
 *   · 各源证据条数 —— 数据到底有没有落库
 *   · 已授权账号（provider / open_id / 昵称 / 是否过期）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/diag-source-status.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const personas = await prisma.persona.findMany({
  where: { kind: "human" },
  select: { id: true, displayName: true, user: { select: { username: true, displayName: true } } },
});

console.log(`真实用户人格：${personas.length} 个\n`);

const SOURCES = ["zhihu", "wechat", "qq", "feishu", "dingtalk", "sbti"];

for (const p of personas) {
  const [sources, counts, features] = await Promise.all([
    prisma.personaSource.findMany({ where: { personaId: p.id } }),
    prisma.personaEvidence.groupBy({
      by: ["source"],
      where: { personaId: p.id },
      _count: { _all: true },
    }),
    prisma.personaFeature.findMany({
      where: { personaId: p.id, key: { startsWith: "facets:" } },
      select: { key: true },
    }),
  ]);
  const bySource = new Map(counts.map((c) => [c.source, c._count._all]));

  console.log(`── ${p.displayName}（user=${p.user?.username ?? "-"}）${p.id}`);
  for (const s of SOURCES) {
    const row = sources.find((x) => x.type === s);
    const meta = row?.meta ? JSON.stringify(row.meta).slice(0, 70) : "";
    console.log(
      `   ${s.padEnd(9)} status=${(row?.status ?? "（无行）").padEnd(14)} 证据=${String(
        bySource.get(s) ?? 0,
      ).padStart(4)}  导入时间=${row?.importedAt ? row.importedAt.toISOString().slice(0, 16) : "-"}  ${meta}`,
    );
  }
  console.log(`   分源解析：${features.map((f) => f.key).join("、") || "（无）"}\n`);
}

const linked = await prisma.linkedAccount.findMany();
console.log("已授权账号：");
for (const l of linked) {
  console.log(
    `  ${l.provider} userId=${l.userId} openId=${l.externalId ?? "-"} 昵称=${l.displayName ?? "-"} 过期=${
      l.expiresAt ? l.expiresAt.toISOString().slice(0, 16) : "-"
    } meta=${JSON.stringify(l.meta ?? {})}`,
  );
}

await prisma.$disconnect();
