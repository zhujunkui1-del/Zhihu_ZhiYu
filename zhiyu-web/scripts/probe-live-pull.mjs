#!/usr/bin/env node
/**
 * **只读**探针：用库里已有的真实授权，打一次平台接口，看能拉到什么。
 * 不写数据库、不改任何状态 —— 纯粹为了"用真凭证验证接线"。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/probe-live-pull.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { decryptSecret } from "../lib/crypto.ts";
import { feishuPullDocs, feishuPullMessages, dingtalkPullDocs } from "../lib/oauth/clients.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const rows = await prisma.linkedAccount.findMany();
console.log(`已授权账号：${rows.length} 条\n`);

for (const r of rows) {
  const expired = r.expiresAt != null && r.expiresAt.getTime() < Date.now();
  console.log(`── ${r.provider} ──────────────────────────────`);
  console.log(
    `   externalId=${r.externalId ?? "-"} displayName=${r.displayName ?? "-"} expiresAt=${
      r.expiresAt ? r.expiresAt.toISOString() : "-"
    } ${expired ? "❌ 已过期" : "✅ 未过期"}`,
  );
  if (expired) {
    console.log("   （已过期，跳过拉取；重新授权后再试）\n");
    continue;
  }

  let token = "";
  try {
    token = decryptSecret(r.accessTokenEnc);
  } catch (e) {
    console.log(`   ❌ token 解密失败：${e.message}\n`);
    continue;
  }
  console.log(`   token 长度 ${token.length}（前 6 位 ${token.slice(0, 6)}…）`);

  const t0 = Date.now();
  try {
    if (r.provider === "feishu") {
      const msgs = await feishuPullMessages(token, r.externalId ?? "");
      console.log(
        `   群聊消息：会话 ${msgs.chats} 个、扫描 ${msgs.scanned} 条、**我发的 ${msgs.items.length} 条**`,
      );
      for (const s of msgs.items.slice(0, 3)) console.log(`      · [${s.trait}] ${s.text.slice(0, 40)}`);
      const docs = await feishuPullDocs(token, r.externalId ?? "", r.displayName ?? "");
      console.log(
        `   云文档：搜索到 ${docs.found} 篇、拉到正文 ${docs.docs} 篇、切出 ${docs.items.length} 段`,
      );
      for (const s of docs.items.slice(0, 3)) console.log(`      · [${s.trait}] ${s.text.slice(0, 40)}`);
    } else {
      const r2 = await dingtalkPullDocs(token, { keyword: r.displayName ?? "" });
      console.log(
        `   钉钉：空间 ${r2.workspaces} 个、文档 ${r2.docs} 篇、多维表格 ${r2.bitables} 张、证据 ${r2.items.length} 条`,
      );
      for (const s of r2.items.slice(0, 3)) console.log(`      · [${s.trait}] ${s.text.slice(0, 40)}`);
    }
  } catch (e) {
    console.log(`   ❌ 拉取失败：${e.message}`);
  }
  console.log(`   用时 ${Date.now() - t0}ms\n`);
}

await prisma.$disconnect();
