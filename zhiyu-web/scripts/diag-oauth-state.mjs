#!/usr/bin/env node
/**
 * 诊断：手机端 OAuth 报「授权状态校验失败」到底是哪一种。
 * 只读，不改任何东西。
 *
 * 三种失败在库里的特征完全不同：
 *   · state_expired  —— expiresAt 已过、consumedAt 为空（用户授权花了 >10 分钟）
 *   · state_consumed —— consumedAt 有值（回调被触发了第二次：预取/前进后退/重复加载）
 *   · state_mismatch —— 库里根本没有这行（state 被截断或写到别的库）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/diag-oauth-state.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const rows = await prisma.oAuthState.findMany({
  orderBy: { createdAt: "desc" },
  take: 60,
});

const now = Date.now();
console.log(`最近 ${rows.length} 条 OAuth state（现在是 ${new Date(now).toISOString()}）\n`);
console.log("createdAt            存活(s)  consumed?  过期?  判定");
console.log("-".repeat(78));

let consumed = 0;
let expiredUnused = 0;
let neverReturned = 0;
let okReturned = 0;

for (const r of rows) {
  const ageS = Math.round((now - r.createdAt.getTime()) / 1000);
  const isConsumed = r.consumedAt != null;
  const isExpired = r.expiresAt.getTime() <= now;
  const lifetimeS = Math.round((r.expiresAt.getTime() - r.createdAt.getTime()) / 1000);

  let verdict = "正常完成（被消费）";
  if (isConsumed) {
    consumed += 1;
    const usedAfterS = Math.round((r.consumedAt.getTime() - r.createdAt.getTime()) / 1000);
    verdict = `✅ 完成，从发起到回调用了 ${usedAfterS}s（state 寿命 ${lifetimeS}s）`;
    okReturned += 1;
  } else if (isExpired) {
    expiredUnused += 1;
    verdict = `⏰ 过期未回（用户授权超过 ${lifetimeS}s 才回来 → state_expired）`;
  } else {
    neverReturned += 1;
    verdict = "… 还没回来（进行中，或用户中途放弃）";
  }

  console.log(
    `${r.createdAt.toISOString()}  ${String(ageS).padStart(6)}  ${String(isConsumed).padEnd(9)}  ${String(
      isExpired,
    ).padEnd(5)}  ${verdict}`,
  );
}

console.log("\n汇总：");
console.log(`  ✅ 正常完成（被消费）：${okReturned}`);
console.log(`  ⏰ 过期未回（state_expired 嫌疑）：${expiredUnused}`);
console.log(`  … 尚未回来：${neverReturned}`);
console.log(`  合计：${rows.length}`);

/* 关键判据：有没有"发起到回调"耗时接近或超过 10 分钟的 —— 那就是超时高发 */
const longOnes = rows
  .filter((r) => r.consumedAt)
  .map((r) => Math.round((r.consumedAt.getTime() - r.createdAt.getTime()) / 1000))
  .filter((s) => s > 60);
console.log(
  `\n回调耗时超过 60 秒的：${longOnes.length} 次${longOnes.length ? ` → ${longOnes.join("s, ")}s` : ""}`,
);
void consumed;

await prisma.$disconnect();
