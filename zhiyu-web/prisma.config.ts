import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // 迁移/CLI 使用直连地址（Neon unpooled）；运行时客户端使用 DATABASE_URL + Neon adapter
  datasource: {
    url: env("DIRECT_URL"),
  },
  migrations: {
    path: "prisma/migrations",
  },
});
