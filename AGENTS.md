# AGENTS.md — 知遇（ZhiYu）

产品定位、页面结构、数据模型、MVP 范围等需求细节以 `产品方案/` 目录为唯一事实来源。开始任何设计或开发前，先通读 `产品方案/知遇_AI_Agent_产品理解与开发规范_v2.0_Next.js_Vercel.md` 及与任务相关的其他方案文档。

## 部署硬约束（不可违反）

知遇是单体 Next.js 全栈应用，唯一线上部署平台是 **Vercel**：

- 前端页面、服务端 API（Route Handlers）、异步后台任务（Vercel Workflows）全部作为同一个 Next.js 项目交付并部署到 Vercel。
- 不得引入任何其他提供应用服务器/托管能力的平台或形态，包括但不限于 Render、Railway、独立 VPS/云主机、自建常驻 Node 服务、独立 Express/FastAPI 后端、frontend/backend 双项目。
- 持久化数据使用托管 PostgreSQL（经由 Vercel 环境变量接入），向量检索按产品文档预留 `persona.embedding` 与 pgvector 能力，MVP 阶段不搭建独立检索服务。
- 所有 Secret 只存放于 Vercel Environment Variables；`AI_API_KEY`、`DATABASE_URL`、知乎 OAuth Secret 等绝不进入浏览器端或 Git。
- 验收标准：仓库代码在文档指引下能直接部署到 Vercel（含数据库迁移），并跑通“Persona → 快速匹配 → Agent 匹配 → Match Report”闭环，不依赖任何 Vercel 之外的服务器。

### 上线可达性要求（2026-09 增补，已实测）

赛事评委明确：**上线的网站若在中国大陆无法访问会扣分。** 因此除上面五条外：

1. **必须绑定自有域名，禁止以 `*.vercel.app` 作为对外入口。**
   实测（中国大陆网络，本机）：`vercel.com` 与 Vercel 上的自定义域名（`nextjs.org`）
   HTTPS 可达 119–500 ms；而两个真实 `*.vercel.app` 子域**均被 DNS 污染**
   （解析到 `45.114.11.238` / `69.171.224.40` 等无关网段）并 **TCP 443 超时**。
   Vercel 官方文档亦确认：GFW 按域名屏蔽，`.vercel.app` 子域首当其冲，
   **建议改用自有域名**。
2. **自托管全部静态资源。** 不引入 Google Fonts、外部统计、境外 CDN 等
   可能在大陆被阻断的第三方资源；字体、图片、脚本一律随项目部署。
3. **不使用反向代理/CDN 套在 Vercel 前面。** Vercel 有明确的反代政策，
   「Vercel + Cloudflare 代理」不属于干净方案，已排除。
4. **不采用境内服务器**（需 ICP 备案，备案周期 7–20 天，团队不接受）。
   因此本项目的可达性方案是：**Vercel 单体 + 自有域名 + 全量自托管资源**，
   不引入第二套托管、不做静态镜像。
5. 知乎 OAuth 的 `redirect_uri` 因此**以自有域名为准**，且必须与赛事页面登记值
   逐字一致；域名未定前该值以环境变量 `ZHIHU_OAUTH_REDIRECT_URI` 占位，
   代码不得硬编码域名。
