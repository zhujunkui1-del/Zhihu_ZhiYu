#!/usr/bin/env node
/**
 * 线上库/代码是否与 #7 的迁移一致？
 *
 * #7 给 `CommunicationPrefs` 加了 `usePlatformLlm` 列。如果**代码已部署但库没迁移**，
 * 任何读它/写它的地方都会在运行时炸（Prisma 报 Unknown argument / column does not exist）。
 * 所以必须实测，而不是假设 Vercel 会替我跑迁移。
 *
 * 手法：未登录时 /api/settings/prefs 会先返回 401（根本读不到库），
 * 因此改用**已登录的线上账号**不可行（我没有线上会话）。
 * 退而求其次：直接连线上库读 `_prisma_migrations`，确认迁移记录存在。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: url }) });

/* ① 迁移记录 */
const rows = await prisma.$queryRawUnsafe(
  `SELECT migration_name, finished_at, rolled_back_at
     FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 8`,
);
console.log("== 最近应用的迁移 ==");
for (const r of rows) {
  console.log(
    `  ${r.migration_name}  完成=${r.finished_at ? "是" : "否"}  回滚=${r.rolled_back_at ?? "-"}`,
  );
}

const has = rows.some((r) => r.migration_name.includes("add_use_platform_llm"));
console.log(`\nadd_use_platform_llm 已应用：${has ? "✅" : "❌ 需要迁移"}`);

/* ② 直接确认列存在（迁移记录与真实 schema 可能不一致，所以查 information_schema）。
   注意：`data_type` 在 PG 里是 `name` 类型，Prisma 的 neon 适配器无法反序列化，
   必须显式 cast 成 text，否则会报 UnsupportedNativeDataType。 */
const cols = await prisma.$queryRawUnsafe(
  `SELECT column_name::text AS column_name,
          data_type::text   AS data_type,
          column_default::text AS column_default,
          is_nullable::text AS is_nullable
     FROM information_schema.columns
    WHERE table_name = 'CommunicationPrefs'
    ORDER BY ordinal_position`,
);
console.log("\n== CommunicationPrefs 实际列 ==");
for (const c of cols) {
  console.log(`  ${c.column_name}  ${c.data_type}  default=${c.column_default ?? "-"}`);
}
const colOk = cols.some((c) => c.column_name === "usePlatformLlm");
console.log(`\nusePlatformLlm 列存在：${colOk ? "✅" : "❌ 代码会 500"}`);

await prisma.$disconnect();
process.exit(has && colOk ? 0 : 1);
