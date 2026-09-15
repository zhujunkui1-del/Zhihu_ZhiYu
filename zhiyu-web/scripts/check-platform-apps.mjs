#!/usr/bin/env node
/* 确认站点级平台凭证（用户真实填的）没被测试误删 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});
const rows = await prisma.platformApp.findMany();
console.log(`PlatformApp：${rows.length} 条`);
for (const r of rows) console.log(`  ${r.provider} appId=${r.appId}`);
await prisma.$disconnect();
