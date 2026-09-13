import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

try {
  const [users, personas, matches, reports, evidence, sources, notifs] = await Promise.all([
    prisma.user.count(),
    prisma.persona.count(),
    prisma.match.count(),
    prisma.matchReport.count(),
    prisma.personaEvidence.count(),
    prisma.personaSource.count(),
    prisma.notification.count(),
  ]);
  console.log(
    `用户 ${users} / 人设 ${personas} / 匹配 ${matches} / 报告 ${reports} / 证据 ${evidence} / 数据源记录 ${sources} / 通知 ${notifs}`,
  );
  const byKind = await prisma.persona.groupBy({ by: ["kind"], _count: true });
  console.log("人设构成:", byKind.map((k) => `${k.kind}=${k._count}`).join(" "));
} finally {
  await prisma.$disconnect();
}
