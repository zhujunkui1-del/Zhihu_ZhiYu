# zhiyu-web

知遇（ZhiYu）的单体 Next.js 应用——**这是唯一的部署目标**。

产品定位与开发规范见上一级目录的 `产品方案/`；部署硬约束见上一级目录的 `AGENTS.md`。

## 技术栈

Next.js 16（App Router）· React 19 · TypeScript · Prisma 7 · PostgreSQL（Neon）· 部署 Vercel

## 本地运行

```bash
npm install
cp .env.example .env        # 至少填 DATABASE_URL
npx prisma migrate deploy   # 建表
npx prisma generate         # 生成客户端

# 演示数据（可选，但不跑的话页面是空的）
node --env-file=.env scripts/seed-demo.mjs         # 16 位示例人物 + 演示用户人设
node --env-file=.env scripts/seed-agent-match.mjs  # 演示用的 Agent 匹配与报告

npm run dev                 # http://localhost:3000
```

打开首页点「**演示登录**」即可完整体验，**不需要任何知乎凭证**。

## 常用命令

```bash
npm run dev         # 开发服务器
npm run build       # 生产构建
npm run typecheck   # tsc --noEmit
npx prisma studio   # 可视化查看数据
```

## 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串 |
| `AUTH_ENC_KEY` | 生产必需 | 32 字节 base64；会话与 OAuth Token 的加密主密钥 |
| `USER_LLM_KEY_ENC` | 可选 | BYOK 密钥加密；未设时用 `AUTH_ENC_KEY` 派生 |
| `ZHIHU_APP_ID` / `ZHIHU_OAUTH_APP_KEY` | 可选 | 知乎 OAuth；未配置时 `/api/auth/zhihu` 回退演示登录 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 可选 | **必须与知乎开放平台登记值逐字一致**，且为公网 HTTPS |
| `ZHIHU_ACCESS_SECRET` | 可选 | 读用户创作 / 关注 / 收藏夹 |
| `ZHIHU_COMMUNITY_*` | 可选 | 知乎社区 API（见 `lib/zhihu/community-api.ts`） |

> 生产环境不配 `AUTH_ENC_KEY` 会直接报错（这是有意为之）；开发环境自动回落，保证开箱可用。

## 目录

```
app/
  (auth)/page.tsx          登录页（知乎授权 / 演示登录）
  (app)/                   带侧栏壳的六个页面
    home/ find/ persona/ agent-match/ notify/ settings/
  api/                     20 个 Route Handler
components/
  AppShell.tsx             侧栏 + 顶栏 + 木牌
  radar/                   相遇雷达（layout.ts 纯函数 / Avatar / Radar）
  BoardRadar.tsx           首页五轴雷达
  PersonaRadar.tsx         人格卡雷达
lib/
  matching/quick.ts        快速匹配六维算法
  agent/dialogue.ts        Agent 结构化对话 + Judge（含确定性兜底）
  agent/dialogue-llm.ts    真 LLM 版（失败回落到 dialogue.ts）
  discover.ts home.ts persona-view.ts notify.ts agent-match.ts
  auth/                    OAuth 协议层 / 会话 / 当前身份解析
  zhihu/                   用户数据 API / 社区 API / 数据同步
prisma/                    schema + 迁移
scripts/                   seed 与验证脚本
```

## 部署

推送到 Vercel 即可（单体）。**必须绑定自有域名**——`*.vercel.app` 在中国大陆被 DNS 污染，
细节与实测数据见上一级 `AGENTS.md`。

部署后到知乎开放平台登记回调地址，并填入 `ZHIHU_OAUTH_REDIRECT_URI`。
填完之后 `/api/auth/zhihu` 会自动从「回退演示登录」切换到「跳转知乎授权页」，不需要改代码。

## 验证脚本

```bash
node --env-file=.env scripts/verify-auth-identity.mjs   # 身份解析与 HttpOnly 会话
node --env-file=.env scripts/verify-settings.mjs        # 设置 + 通知（含开关真落库）
node --env-file=.env scripts/verify-agent-match.mjs     # Agent 匹配两页签与弹窗
node --env-file=.env scripts/verify-zhihu-sync.mjs      # 知乎数据同步（打真实接口）
node --env-file=.env scripts/check-dialogue-variety.mjs # Agent 回答区分度回归
node --env-file=.env scripts/test-oauth-mock.mjs        # OAuth 协议层 Mock
node --env-file=.env scripts/test-crypto-box.mjs        # 加密与密钥域隔离
node --env-file=.env scripts/test-auth-routes.mjs       # 认证路由 HTTP 集成
node --env-file=.env scripts/test-community-sign.mjs    # 社区 API 签名
node --env-file=.env scripts/check-deploy-readiness.mjs # 上线就绪度自检
```

> ⚠️ `verify-web-persona.mjs`（在上一级 `RECON/`）会跑完 30 题 SBTI 并**覆盖演示用户的
> SBTI 结果**。演示或截图前请先跑 `scripts/seed-demo.mjs` 重置。

## 已知问题

- `RECON/verify-web-discover.mjs` 的「雷达里点头像跳到人格卡」偶发失败（约 1/3），
  重跑即过。判断是点击命中测试的时序问题，未修——放宽断言会掩盖潜在真 bug。
