// 数据库连通性与现状检查（只读）。用法：node --env-file=.env scripts/db-check.mjs
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const url = process.env.DATABASE_URL || "";
console.log("DATABASE_URL:", url.replace(/:\/\/[^@]*@/, "://***@").slice(0, 70));

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1 as ok`;
  console.log(`连通正常（${Date.now() - t0}ms）`);

  const users = await prisma.user.count();
  const personas = await prisma.persona.count();
  const byKind = await prisma.persona.groupBy({ by: ["kind"], _count: true });
  console.log(`\n用户 ${users} 个 / 人设 ${personas} 个`);
  for (const k of byKind) console.log(`  ${k.kind}: ${k._count}`);

  const list = await prisma.persona.findMany({
    select: {
      id: true, displayName: true, kind: true,
      interests: true, topics: true, communicationStyle: true, values: true, personality: true,
    },
    take: 12,
  });
  console.log("\n人设样本：");
  for (const p of list) {
    const sbti = p.personality?.sbti?.type ?? "(无)";
    const n = (v) => (Array.isArray(v) ? v.length : v ? "obj" : "null");
    console.log(
      `  ${String(p.displayName).padEnd(14)} kind=${String(p.kind).padEnd(16)} sbti=${String(sbti).padEnd(10)}` +
      ` interests=${n(p.interests)} topics=${n(p.topics)} comm=${n(p.communicationStyle)} values=${p.values ? "有" : "null"}`,
    );
  }

  const nullComm = await prisma.persona.count({ where: { communicationStyle: { equals: null } } });
  const nullValues = await prisma.persona.count({ where: { values: { equals: null } } });
  console.log(`\ncommunicationStyle 为空: ${nullComm} / values 为空: ${nullValues}`);
} catch (e) {
  console.error("失败:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
