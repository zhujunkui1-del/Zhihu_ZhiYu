<p align="center">
  <img src="产品方案/assets/logo-zhiyu.png" alt="知遇 ZhiYu" width="220">
</p>

<h1 align="center">知遇 ZhiYu</h1>

<p align="center">
  <b>让 Agent 先替你认识一个人。</b>
</p>

<p align="center">
  知乎黑客松 2026 · 赛道「灵魂匹配局：社区连接与兴趣社交」
</p>

---

## 这是什么

从「看到一个人」到「真正认识一个人」，中间的成本极高：简介写不下，动态看不出，一次试探性的对话又太贵。于是大量本来有价值的连接，**还没开始就结束了**。

这不是界面问题，是**信息量问题**——判断「我和这个人合不合得来」，需要的信息远超一个人能主动表达的量。

我们的做法是把

```
人 → 人
```

变成

```
人 → Agent → Agent → 人
```

让一个真正了解你的 Agent，先去和对方的 Agent 聊一次。聊完你觉得值得，再由你们本人认识。

---

## 三个设计判断

**① 目标不是「最像」，而是「最值得认识」**

社区里最可惜的错过，往往是「观点不同但能相互启发」的两个人。所以我们不按单一相似度排序，而是五维加权——其中**「互补程度」是反向的**：越不像，这一维越高。

> 真正适合认识的人，不一定是最像你的人。

**② Agent 对话不能是自由聊天**

自由聊天无法比较、无法解释、无法复现。所以每次匹配只跑**固定轮次的定向提问**，双方 Agent 各自作答，最后交给 Judge Agent 给出五维评分与理由。

**③ 关系需要「看得见的地图」**

「相似度 87%」人脑理解不了。所以我们做了**相遇雷达**：以你为中心，每个候选人的头像落在轨道上，**离你越近就越同频**，一次看到几十个人的相对位置。

---

## 产品流程

| 步骤 | 做什么 |
|---|---|
| **1. 把「我」交给 Agent** | 六源人格输入，任选其一：知乎（表达的我）、微信/QQ（真实的我）、飞书/钉钉（工作中的我）、SBTI（认识的我） |
| **2. 生成我的 Agent** | 不是贴标签，而是理解你为什么喜欢、怎么思考、和谁聊得来 |
| **3. 两级匹配** | 先规则算分（秒级、零成本），再让 Agent 真实对话（只对少数候选） |
| **4. 后台进行** | 点「让我的 Agent 先聊聊」后**不跳页不阻塞**，侧栏小圆点提示进度 |
| **5. 拿到报告** | 五维评分 + 综合分 + **为什么推荐你们认识** |

### 七个页面

```
/               登录页（知乎授权 / 演示登录）
/home           首页：人格总览 + 进行中的 Agent 匹配 + 发现预览
/find           发现页：卡片视图 / 相遇雷达
/persona        我的人格：人格卡 + 六源注入 + SBTI 测试
/agent-match    Agent 匹配：认识中 / 匹配报告
/notify         通知中心
/settings       设置：身份与数据源 / 沟通偏好 / BYOK 大模型接入
```

---

## 技术方案

```
┌─────────────────────────────────────────────────┐
│  Next.js（App Router）· 单体 · Vercel            │
│                                                 │
│  Server Component ── 取数与鉴权（首屏带数据）      │
│  Client 岛屿 ────── 交互（雷达 / 筛选 / 弹窗）     │
│  Route Handlers ─── 20 个 API                    │
└──────────────────┬──────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │  PostgreSQL (Neon)  │
        │  14 个模型 / 4 个迁移 │
        └─────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
 知乎开放平台   用户 BYOK       平台默认
 OAuth + 用户API  大模型 Key     大模型
```

7 个页面中 **6 个是 Server Component**（取数与鉴权在服务端完成，首屏即带完整数据），只有登录页与各页的交互部分是 Client Component。

**技术栈**：Next.js 16 · React 19 · TypeScript · Prisma 7 · PostgreSQL (Neon) · 部署在 Vercel。

### 最关键的一个架构判断：Agent 不常驻

不能让上亿 Agent 互相寻找（O(N²)）。正确做法是**检索，而不是全连接**：

```
海量 Persona Index → 向量召回 1000 → 规则精排 100 → 推荐 10 → Agent 对话 1~3
```

**LLM 只在最后一公里调用。**

因此我们不会说「我们拥有上亿个 Agent」，正确的表述是：构建大规模 Persona Index，把海量人格信息结构化、向量化；**Agent 不常驻**，而是在用户触发深度匹配时按需实例化。

### 知乎数据接入

| 能力 | 接口 | 状态 |
|---|---|---|
| OAuth 登录 | `openapi.zhihu.com/authorize` → `/access_token` → `/user` | 代码完成，待部署后联调 |
| 用户数据 | `developer.zhihu.com/api/v1/user/*`（创作 / 关注 / 收藏夹 / 收藏夹内容 / 近期收藏） | **已用真实凭证跑通** |

**工程要点**（都是实测踩出来的）：`uid` 是 18~19 位十进制数，超过 JavaScript 安全整数范围，直接 `JSON.parse` 会**静默舍入**（`904491330657081871` → `904491330657081900`，无任何报错），必须做文本预处理；回调参数是 `authorization_code` 而非标准 OAuth 的 `code`，但换 token 的表单字段仍用 `code`；成功判定看 `access_token` 是否存在，不把业务码 `20000` 当错误。

### 身份与安全

- 会话是**服务端 `AuthSession` 表 + HttpOnly Cookie**（Vercel 多实例，进程内存储不可用）
- `access_token` 用 AES-256-GCM 加密落库，**浏览器永远拿不到**
- 所有密钥只存在于环境变量；源码中零明文（有断言）
- 页面身份统一由 `resolveIdentity()` 解析：优先会话；**生产环境忽略 `?userId=`**，否则带上别人的 id 就能读到对方数据

---

## 快速开始

```bash
cd zhiyu-web
npm install
cp .env.example .env        # 填入 DATABASE_URL 等（见下）
npx prisma migrate deploy   # 建表
node --env-file=.env scripts/seed-demo.mjs         # 16 位示例人物
node --env-file=.env scripts/seed-agent-match.mjs  # 演示用的 Agent 匹配
npm run dev
```

打开 http://localhost:3000，点「演示登录」即可完整体验（不需要知乎凭证）。

### 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串（Neon 池化连接） |
| `AUTH_ENC_KEY` | 生产必需 | 32 字节 base64，会话与 OAuth Token 加密主密钥 |
| `ZHIHU_APP_ID` / `ZHIHU_OAUTH_APP_KEY` | 可选 | 知乎 OAuth；未配置时自动回退演示登录 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 可选 | 必须与知乎开放平台登记值**逐字一致** |
| `ZHIHU_ACCESS_SECRET` | 可选 | 读用户创作 / 关注 / 收藏 |
| `USER_LLM_KEY_ENC` | 可选 | BYOK 密钥加密（未设时用 `AUTH_ENC_KEY` 派生） |

> 生产环境**必须**配置 `AUTH_ENC_KEY`，否则启动即报错；开发环境会自动回落，方便本地开箱可用。

---

## 部署

**唯一目标平台是 Vercel（单体）**，硬约束：

1. **必须绑定自有域名，不能以 `*.vercel.app` 作为对外入口。** 实测（中国大陆网络）`*.vercel.app` 子域被 DNS 污染并 TCP 443 超时，而 Vercel 上的自定义域名可达 119–500 ms。
2. **自托管全部静态资源**——不引入 Google Fonts、境外 CDN、外部统计。
3. **不使用反向代理 / CDN 套在 Vercel 前面**（Vercel 有明确反代政策）。
4. **不采用境内服务器**（需 ICP 备案）。

部署后到知乎开放平台登记 `https://<你的域名>/api/auth/zhihu/callback`，并填入 `ZHIHU_OAUTH_REDIRECT_URI`。`/api/auth/zhihu` 会自动从「回退演示登录」切换到「跳转知乎授权页」，**不需要改代码**。

---

## 验证

不是「写完就算」——每个关键行为都有自动化断言：

```bash
# 页面与组件（根目录）
node RECON/verify-web-foundation.mjs     # 6 路由结构 / 主题 / 侧栏
node RECON/verify-web-login.mjs          # 登录页
node RECON/verify-web-home.mjs           # 首页
node RECON/verify-web-discover.mjs       # 发现页 + 雷达
node RECON/verify-web-persona.mjs        # 我的人格（含完整 SBTI 流程）
node RECON/test-radar-layout.mjs         # 雷达布局（穷举 1~40 人零重叠）

# 接口与安全（zhiyu-web）
cd zhiyu-web
node --env-file=.env scripts/verify-auth-identity.mjs   # 身份与 HttpOnly 会话
node --env-file=.env scripts/verify-settings.mjs        # 设置 + 通知
node --env-file=.env scripts/verify-agent-match.mjs     # Agent 匹配
node --env-file=.env scripts/verify-zhihu-sync.mjs      # 知乎数据同步（真实接口）
node --env-file=.env scripts/test-oauth-mock.mjs        # OAuth 协议层 Mock
node --env-file=.env scripts/test-crypto-box.mjs        # 加密与密钥域隔离
```

其中一些断言是把踩过的坑固化下来的，例如：雷达布局零重叠（早期算法在 16 人时有 7 组重叠）、缩放时光标下世界坐标零漂移、沟通偏好开关**服务端真的落库**、响应体不含任何凭证。

> ⚠️ 注意：`verify-web-persona.mjs` 会跑完 30 题 SBTI（全选 A 得到「死者/DEAD」），
> **它会覆盖演示用户的 SBTI 结果**。演示或截图前请先跑一次 `scripts/seed-demo.mjs` 重置。

---

## 目录结构

```
├── zhiyu-web/                单体 Next.js 应用（部署目标）
│   ├── app/                  7 个页面 + 20 个 API
│   ├── components/           AppShell / 相遇雷达 / 头像 / 人格雷达
│   ├── lib/                  匹配算法 / 人格装配 / 知乎接入 / 会话
│   ├── prisma/               schema + 4 个迁移
│   └── scripts/              seed 与验证脚本
├── 产品方案/                 产品与开发规范（唯一事实来源）
│   ├── 知遇_AI_Agent_产品理解与开发规范_v2.0_Next.js_Vercel.md
│   ├── 知遇_产品说明与计划书.md
│   └── 知遇_产品计划书_简版.md
├── 前端UI/                   静态视觉原型（视觉唯一事实来源）
├── RECON/                    页面验证脚本与踩坑记录（RESKIN.md）
└── AGENTS.md                 部署硬约束
```

---

## 当前状态

**已完成**：7 个页面 · 六源人格框架 · 两级匹配 · 相遇雷达 · Agent 对话 + Judge · 知乎五个用户数据接口真实接入 · 知乎 OAuth 完整代码 · 300+ 项验证

**待完成**：知乎 OAuth 实网联调（需部署并登记公网回调）· 微信/QQ/飞书/钉钉接入 · 人格蒸馏管线 · 向量检索召回

---

<p align="center">
  <b>知遇 ZhiYu｜让 Agent 先替你认识一个人。</b>
</p>
