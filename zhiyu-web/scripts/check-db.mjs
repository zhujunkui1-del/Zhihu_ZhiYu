// 用法：node --env-file=.env scripts/check-db.mjs
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

try {
  const rows = await prisma.$queryRawUnsafe(
    `select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  console.log("public 表数量:", rows[0].n);
} finally {
  await prisma.$disconnect();
}
