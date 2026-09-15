#!/usr/bin/env node
/**
 * 清掉端到端测试在**演示用户**身上留下的合成数据。
 *
 * 为什么需要：本地 e2e 与线上用的是**同一个 Neon 库**，测试会真实写入证据。
 * 其中大文件那一节灌了 200 条合成消息（"第 N 条：好"）到 QQ 源 ——
 * 演示时点开 QQ 会看到这堆垃圾。这里把它清掉，
 * 并把该源恢复成"未注入"（正好方便演示首次导入的单按钮形态）。
 *
 * 只动指定的源，不碰其它数据。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/cleanup-demo-testdata.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const user = await prisma.user.findFirst({
  where: { username: "demo" },
  select: { persona: { select: { id: true, displayName: true } } },
});
const personaId = user?.persona?.id;
if (!personaId) {
  console.log("找不到演示用户的 persona，什么都没做。");
  process.exit(0);
}
console.log(`演示用户：${user.persona.displayName}（${personaId}）\n`);

/* 1) QQ：删掉合成的大文件测试数据（只删"第 N 条"这种明显是造出来的） */
const qqBefore = await prisma.personaEvidence.count({ where: { personaId, source: "qq" } });
const delQq = await prisma.personaEvidence.deleteMany({
  where: { personaId, source: "qq", note: { startsWith: "第 " } },
});
console.log(`QQ：删除合成证据 ${delQq.count} 条（原有 ${qqBefore} 条）`);

const qqLeft = await prisma.personaEvidence.count({ where: { personaId, source: "qq" } });
if (qqLeft === 0) {
  /* 证据清空后把源标记回"未注入"，并删掉过期的分源解析 —— 
     否则会出现"未注入却有解析结论"的矛盾状态 */
  await prisma.personaSource.updateMany({
    where: { personaId, type: "qq" },
    data: { status: "not_injected", meta: undefined },
  });
  await prisma.personaFeature.deleteMany({ where: { personaId, key: "facets:qq" } });
  console.log("QQ：证据已清空 → 恢复为「未注入」并删除过期分源解析");
}

/* 2) 钉钉：e2e 把它清成未注入了，这里确认状态一致（证据与解析都不残留） */
const dtEv = await prisma.personaEvidence.count({ where: { personaId, source: "dingtalk" } });
if (dtEv === 0) {
  await prisma.personaSource.updateMany({
    where: { personaId, type: "dingtalk" },
    data: { status: "not_injected", meta: undefined },
  });
  await prisma.personaFeature.deleteMany({ where: { personaId, key: "facets:dingtalk" } });
  console.log("钉钉：证据为空 → 恢复为「未注入」并删除过期分源解析");
} else {
  console.log(`钉钉：仍有 ${dtEv} 条证据，保持不变`);
}

/* 3) 打印最终状态，便于肉眼确认 */
const chips = await prisma.personaSource.findMany({ where: { personaId } });
const counts = await prisma.personaEvidence.groupBy({
  by: ["source"],
  where: { personaId },
  _count: { _all: true },
});
const bySource = new Map(counts.map((c) => [c.source, c._count._all]));
console.log("\n最终六源状态：");
for (const t of ["zhihu", "wechat", "qq", "feishu", "dingtalk", "sbti"]) {
  const row = chips.find((c) => c.type === t);
  console.log(
    `  ${t.padEnd(9)} ${(row?.status ?? "not_injected").padEnd(14)} 证据 ${bySource.get(t) ?? 0} 条`,
  );
}

await prisma.$disconnect();
