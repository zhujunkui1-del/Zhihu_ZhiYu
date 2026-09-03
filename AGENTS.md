# AGENTS.md — 知遇（ZhiYu）

产品定位、页面结构、数据模型、MVP 范围等需求细节以 `产品方案/` 目录为唯一事实来源。开始任何设计或开发前，先通读 `产品方案/知遇_AI_Agent_产品理解与开发规范_v2.0_Next.js_Vercel.md` 及与任务相关的其他方案文档。

## 部署硬约束（不可违反）

知遇是单体 Next.js 全栈应用，唯一线上部署平台是 **Vercel**：

- 前端页面、服务端 API（Route Handlers）、异步后台任务（Vercel Workflows）全部作为同一个 Next.js 项目交付并部署到 Vercel。
- 不得引入任何其他提供应用服务器/托管能力的平台或形态，包括但不限于 Render、Railway、独立 VPS/云主机、自建常驻 Node 服务、独立 Express/FastAPI 后端、frontend/backend 双项目。
- 持久化数据使用托管 PostgreSQL（经由 Vercel 环境变量接入），向量检索按产品文档预留 `persona.embedding` 与 pgvector 能力，MVP 阶段不搭建独立检索服务。
- 所有 Secret 只存放于 Vercel Environment Variables；`AI_API_KEY`、`DATABASE_URL`、知乎 OAuth Secret 等绝不进入浏览器端或 Git。
- 验收标准：仓库代码在文档指引下能直接部署到 Vercel（含数据库迁移），并跑通“Persona → 快速匹配 → Agent 匹配 → Match Report”闭环，不依赖任何 Vercel 之外的服务器。
