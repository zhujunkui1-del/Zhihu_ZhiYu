#!/usr/bin/env node
/**
 * 检查侧栏用户信息（#8）所需的数据是否齐全。
 *
 * 需求：侧栏「设置」上方显示知乎头像 + 名称；抓不到时用
 * `前端UI/…/assets/characters` 随机图 + 随机用户名 `zhiyu000000`。
 *
 * 所以先要看清"抓得到吗"：avatarUrl 是 OAuth 回调写入的，但开放平台的
 * `/user` 对 avatar_path 可能返回空串（无权限），此时必须能兜底。
 *
 * 用法：node --env-file=.env scripts/check-sidebar-user.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const users = await prisma.user.findMany({
  select: {
    id: true,
    username: true,
    displayName: true,
    avatarUrl: true,
    zhihuAuthorized: true,
    zhihuOpenId: true,
    zhihuHashId: true,
    createdAt: true,
  },
  orderBy: { createdAt: "asc" },
});

console.log(`共 ${users.length} 个用户\n`);
let withAvatar = 0;
for (const u of users) {
  const av = u.avatarUrl ? String(u.avatarUrl) : null;
  if (av) withAvatar += 1;
  console.log(
    [
      `username=${u.username ?? "(null)"}`,
      `displayName=${u.displayName ?? "(null)"}`,
      `avatar=${av ?? "(null)"}`,
      `zhihu=${u.zhihuAuthorized ? "已授权" : "未授权"}`,
      `openId=${u.zhihuOpenId ? String(u.zhihuOpenId).slice(0, 8) + "…" : "(null)"}`,
      `hashId=${u.zhihuHashId ?? "(null)"}`,
    ].join("  "),
  );
}
console.log(`\n有头像的：${withAvatar}/${users.length}`);
console.log(`有用户名的：${users.filter((u) => u.username).length}/${users.length}`);

await prisma.$disconnect();
