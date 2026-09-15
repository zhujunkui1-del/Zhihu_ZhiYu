<p align="center">
  <img src="产品方案/assets/logo-zhiyu.png" alt="知遇 ZhiYu" width="220">
</p>

<h1 align="center">知遇 ZhiYu</h1>

<p align="center">
  <b>让 Agent 先替你认识一个人。</b>
</p>

<p align="center">
  知乎黑客松 2026 · 赛道「灵魂匹配局：社区连接与兴趣社交」<br>
  线上：<b>https://www.zhiyuapp.site</b>
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
| **1. 把「我」交给 Agent** | 六源人格输入：知乎（表达的我）、微信/QQ（真实的我）、飞书/钉钉（工作中的我）、SBTI（认识的我） |
| **2. 生成我的 Agent** | 分源解析 → 多源融合 → 判型（带原话依据），不是贴标签 |
| **3. 两级匹配** | 先规则算分（秒级、零成本），再让 Agent 真实对话（只对少数候选） |
| **4. 后台进行** | 点「让我的 Agent 先聊聊」后**不跳页不阻塞**，侧栏小圆点提示进度 |
| **5. 拿到报告** | 五维评分 + 综合分 + **为什么推荐你们认识**；可一键「给TA送去报告」 |

### 七个页面

```
/               登录页（知乎授权）
/home           首页：人格总览 + 进行中的 Agent 匹配 + 发现预览
/find           发现页：卡片视图 / 相遇雷达
/persona        我的人格：人格卡 + 六源注入 + SBTI 测试
/agent-match    Agent 匹配：认识中 / 匹配报告
/notify         通知中心（含「发来的报告」）
/settings       设置：身份与数据源 / 沟通偏好 / BYOK 大模型接入
```

---

## 人格数据管线（这一版的重点）

人格数据从「注入」到「上屏」要过四道工序，每一道都有可复现的口径：

```
六个数据源 ──► ① 分源解析 ──► ② 数据体检 ──► ③ 五维融合 ──► ④ 判型
              facet           sanity           five-dims       type-source
```

### ① 分源解析：口径只有一张表

`lib/persona/facet-opts.ts` 是**唯一事实来源**：知乎只有标题（`titleOnly`）、微信/QQ/飞书/钉钉是聊天与文档（`profile: "im"` + `noHeat`）、SBTI 不走内容解析（由 15 维问卷现算）。


### ② 数据体检：挡住"看着有数、其实没信息"的值

`lib/persona/sanity.ts` 两道闸门：

- **零区分度自评不进融合** —— 实测某份 SBTI 全 M 作答，15 维原始分全是 4，折算出的五个维度**全是 50%**（标准差 0）。它不是"测得准"，是"每题都给了同一档"。
- **跨源同值整维留空** —— 知乎/微信/QQ 的社交连接曾**全是 1%**（三边都没有互动量，`heat/300` 一律算成 0）。多个源给出同一个数不构成印证，恰恰证明这个信号没量到。

### ③ 五维画像：写死的五个词，全站同一个坐标系

**思考深度 · 表达力 · 共情力 · 执行力 · 主动性**

自己的人格页、首页模块、**别人的人格卡**画的都是这一组，每个源都喂得动：

| 维度 | 问什么 | 知乎 | 聊天 | SBTI |
|---|---|---|---|---|
| 思考深度 | 多少内容在解释、推理、追问 | 标题里的疑问/求知词 | 长消息 + 推理词 | A1/A3/S2 |
| 表达力 | 用词丰不丰富 | 标题用词多样性 | 全文用词多样性 | So3/A2 |
| 共情力 | 对他人情绪的注意力 | 情绪/关系词占比 | 同上 | E1/E2/E3 |
| 执行力 | 输出是否持续 | 发布时间（没存 → 留空） | 有输出的天数占比 | Ac3/Ac1/S1 |
| 主动性 | 是不是主动开口的一方 | 无方向 → 留空 | 我先开口的对话段占比 | So1/A2 |


**纪律：量不到就留空**（界面 `—`），不给 0、不给 0.5；真实的 0 写 `<1%` 而不是假装成 `1%`。

### ④ 判型：LLM 读懂证据后给结论，必须带依据

`lib/persona/type-source.ts` 是倾向型的**唯一取值口径**：判型 → 六维兜底 → SBTI → 无。


口径收敛之后，「首页说务实执行型、人格页说深度思考型」这类事故从结构上不会再发生。

### 顺带保留的：可数行为变量

`lib/persona/behavior.ts` 另算七个**聊天场景专有**的指标（主动发起率、回应速度、活跃天占比、深夜活跃、表达丰富度、提问求知、话题集中）+ 三个事实行（互动平衡、单段消息数、连续交流天数），用在「分源解析」的卡片上。它们不进五维雷达——因为它们只对有对话、有时间戳的源成立。

---

## 技术方案

```
┌──────────────────────────────────────────────────┐
│  Next.js（App Router）· 单体 · Vercel             │
│                                                  │
│  Server Component ── 取数与鉴权（首屏带数据）       │
│  Client 岛屿 ────── 交互（雷达 / 筛选 / 弹窗）      │
│  Route Handlers ─── 30 个 API                     │
└──────────────────┬───────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │  PostgreSQL (Neon)  │
        │  16 个模型 / 5 个迁移 │
        └─────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
 知乎开放平台   用户 BYOK       平台默认
 OAuth + 用户API  大模型 Key     大模型
```

7 个页面中 **6 个是 Server Component**（取数与鉴权在服务端完成，首屏即带完整数据），只有登录页与各页的交互部分是 Client Component。

**技术栈**：Next.js 16.3 · React 19.2 · TypeScript 5 · Prisma 7.10 · PostgreSQL (Neon, ap-southeast-1) · 部署在 Vercel。

### 最关键的一个架构判断：Agent 不常驻

不能让上亿 Agent 互相寻找（O(N²)）。正确做法是**检索，而不是全连接**：

```
海量 Persona Index → 向量召回 1000 → 规则精排 100 → 推荐 10 → Agent 对话 1~3
```


### 六个数据源怎么进

| 源 | 进法 | 状态 |
|---|---|---|
| 知乎 | OAuth 授权 → 开放平台用户数据 API（创作/关注/收藏夹） | **实网跑通** |
| 微信 / QQ | 本地导出文件（WeFlow / qq-chat-exporter 等）拖进「导入数据」 | 可用 |
| 飞书 | OAuth 授权 → 消息 / 文档 / Wiki / 多维表格 | 可用（**需在飞书后台启用机器人能力并发布版本**） |
| 钉钉 | OAuth 授权 → 文档 / 多维表格（官方无历史消息接口） | 可用 |
| SBTI | 站内 30 题自评 | 可用 |


### 身份与安全

- 会话是**服务端 `AuthSession` 表 + HttpOnly Cookie**（Vercel 多实例，进程内存储不可用）
- `access_token` 用 AES-256-GCM 加密落库，**浏览器永远拿不到**；密钥按用途做 HKDF 域隔离
- 所有密钥只存在于环境变量；源码中零明文（有断言）
- 页面身份统一由 `resolveIdentity()` 解析：优先会话；**生产环境忽略 `?userId=`**
- **外发前脱敏**（`lib/privacy/redact.ts`）：手机号、身份证（带校验位）、银行卡（Luhn）、邮箱、密钥、长凭据串在送进大模型前替换成占位符，**只改外发文本、库里原文不动**，蒸馏完成会如实告知替换了几处



---

## 快速开始

```bash
cd zhiyu-web
npm install
cp .env.example .env        # 填入 DATABASE_URL 等（见下）
npx prisma migrate deploy   # 建表
npx prisma generate
node --env-file=.env scripts/seed-demo.mjs         # 16 位示例人物
node --env-file=.env scripts/seed-agent-match.mjs  # 演示用的 Agent 匹配
npm run dev
```

打开 http://localhost:3000，点「演示登录」即可完整体验（不需要知乎凭证；**生产环境禁用演示登录**）。

> ⚠️ 改完 `prisma/schema.prisma` 一定要**重启 dev server** —— 否则跑着的进程还用旧 Prisma client，`prisma.<新模型>` 会是 undefined，接口 500 且响应体为空。

### 环境变量

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串（Neon 池化连接） |
| `AUTH_ENC_KEY` | 生产必需 | 32 字节 base64，会话与 OAuth Token 加密主密钥 |
| `ZHIHU_APP_ID` / `ZHIHU_OAUTH_APP_KEY` | 可选 | 知乎 OAuth；未配置时回退演示登录 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 可选 | 必须与知乎开放平台登记值**逐字一致** |
| `ZHIHU_ACCESS_SECRET` | 可选 | 读用户创作 / 关注 / 收藏 |
| `USER_LLM_KEY_ENC` | 可选 | BYOK 密钥加密（未设时用 `AUTH_ENC_KEY` 派生） |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | 可选 | 平台默认大模型（人格蒸馏与 Judge 用） |

> 生产环境**必须**配置 `AUTH_ENC_KEY`，否则启动即报错；开发环境会自动回落，方便本地开箱可用。

---

---

## 验证

不是「写完就算」——每个关键行为都有自动化断言。`zhiyu-web/scripts/` 下有 **90 个脚本**（测试 / 端到端 / 诊断 / 回填），常用这些：

```bash
cd zhiyu-web

# 人格数据管线（纯函数 + 真实数据 fixture）
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-five-dims.mjs     # 五维（含 6083 条真实聊天）
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-sanity.mjs       # 体检闸门 / 无信号留空
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-facet-opts.mjs   # 分源解析口径一致性
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-behavior.mjs     # 可数行为变量
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-import-parse.mjs # 各家导出格式解析
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-redact.mjs       # 外发脱敏
node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-zhihu-links.mjs  # 知乎链接修正

# 端到端（需要 dev server + DATABASE_URL）
node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-behavior-flow.mjs   # 导入→落库→页面
node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-distill-type.mjs    # 真跑蒸馏 + 判型落库
node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-send-report.mjs     # 送报告 + 收件箱可见
node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-fusion-ui.mjs       # 人格页
node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-no-jump-and-sync.mjs # 首页与人格页同源
node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-login-instant.mjs   # 手机端登录可用性
node scripts/verify-live-deploy.mjs https://www.zhiyuapp.site                                          # 线上（只读）
```


---

## 目录结构

```
├── zhiyu-web/                单体 Next.js 应用（部署目标）
│   ├── app/                  7 个页面 + 30 个 API
│   ├── components/           AppShell / 相遇雷达 / 人格卡与弹窗 / 导入弹窗
│   ├── lib/
│   │   ├── persona/          人格管线：fusion / five-dims / sanity /
│   │   │                     type-source / behavior / facet-opts / distill
│   │   ├── privacy/          外发脱敏
│   │   ├── zhihu/            知乎 OAuth 用户 API / 公开端点回填 / 链接修正
│   │   ├── oauth/            飞书 / 钉钉 授权、拉取与同步
│   │   ├── import/           文件解析（微信/QQ/飞书/钉钉导出）
│   │   ├── agent/            Agent 对话与 Judge
│   │   └── auth/             会话 / CSRF / 身份
│   ├── prisma/               schema（16 模型）+ 5 个迁移
│   └── scripts/              90 个测试 / 端到端 / 诊断 / 回填脚本
├── 产品方案/                 产品与开发规范（唯一事实来源）
├── 前端UI/                   静态视觉原型（视觉唯一事实来源）
├── RECON/                    页面验证脚本与踩坑记录（RESKIN.md）
├── 开源项目/                 参考实现（distilly / WeFlow / qq-chat-exporter 等）
└── AGENTS.md                 部署硬约束
```

---

## 当前状态

**已完成并上线**（https://www.zhiyuapp.site，自有域名 + Vercel 单体）：

- 7 个页面 · 30 个 API · 16 个数据模型
- **六源接入**：知乎 OAuth 实网跑通；微信/QQ/飞书/钉钉文件导入；飞书/钉钉 OAuth 授权同步；SBTI 自评
- **人格管线**：分源解析（口径唯一表）→ 数据体检（两道闸门）→ 五维融合 → LLM 判型（带原话依据）
- **Agent 匹配**：定向提问对话 + Judge 五维评分 + 报告弹窗 + **给TA送去报告**（收件方在「通知 → 发来的报告」可见）
- **安全**：HttpOnly 会话、Token 加密落库、外发前脱敏、生产环境忽略 `?userId=`
- **可达性**：自有域名、资源自托管、纸纹转 WebP（登录页传输量 1.5MB → 284KB）


---

<p align="center">
  <b>知遇 ZhiYu｜让 Agent 先替你认识一个人。</b>
</p>
