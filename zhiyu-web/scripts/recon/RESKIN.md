# 知遇 · 旧前端 → 手绘纸感主题  改造说明

> 改造对象：`前端UI/知乎黑客松产品_知遇ZhiYu18/`（7 个 HTML）
> 视觉来源：`zhiyu-site/`（新前端，暖调手绘纸感）
> 原则：**只换皮，不动功能**。产品方案、页面结构、交互逻辑、数据全部保持原样。
>
> 状态：已完成并经 52 项功能回归 + 7 页结构与主题验证全部通过。

---

## 〇之前之十六、接入知乎社区 API（真实发帖能力）

### 1. 先纠正一个我自己的误判

上一轮我以为社区 API「接口路径未公开」，结论下得太早。用户从知乎站内把完整文档
扒下来之后，真实路径是：

```
GET  /openapi/ring/detail             圈子详情 + 最新内容列表
POST /openapi/publish/pin             发布想法      ⚠️ 每小时最多 5 条
GET  /openapi/comment/list            评论列表      content_type: pin|comment
POST /openapi/comment/create          创建评论      ⚠️ 每小时每个想法最多 20 条
POST /openapi/comment/delete          删除自己的评论
POST /openapi/reaction                点赞/取消点赞
GET  /openapi/hackathon_story/list    故事概要列表（黑客松专项）
GET  /openapi/hackathon_story/detail  故事详情
```

**前缀是 `/openapi/`**。我之前一直试 `/ring/moltbook/api/community/`，
所以怎么试都是 404 —— 路径错了一个数量级。

实测全部打通（HMAC 签名一次通过）：

```
★ OpenClaw 人类观察员    成员 3363   讨论 396789
★ A2A for Reconnect     成员 354    讨论 598
★ 黑客松脑洞补给站        成员 711    讨论 3801
★ 故事列表 9 个（秦始皇登月计划 / 人脸解锁失败 / 夹心 / 逃离灵山 / 画棠春…）
★ 故事详情《秦始皇登月计划》 作者 六酒  正文 3000 字
```

### 2. 顺带纠正两处文档内的不一致

- **`expires_in` 默认是 2592000 秒（30 天）**，不是快速开始示例里的 3600 秒。
  OAuth Skill 那一页明确写了 30 天。我们按实际返回值存，不写死。
- **`like_num` 字段实测返回 `undefined`**（文档写的是 `like_num`，
  圈子详情里首条的点赞数取不到）。已在代码里同时接受 `like_num` / `like_count`
  并归一为 0，避免 `undefined` 泄漏到 UI。
- **评论列表对某些 pin 报 `pin not bound to any ring`** —— 这是文档
  「常见错误」里列出的情形，属于正常业务错误，不是我们调错。

### 3. 发布能力的三道闸门

`POST /api/zhihu/community/post` 把一次真实的 Agent 匹配结果发到知乎圈子。
文档开头的 `[!WARNING]` 写明违规会**收回 app_key 并封号**，所以做了三道闸：

1. **必须显式确认**（`confirm: true`）—— 不做自动/批量发布
2. **服务端节流**：查 `CommunityPost` 表近 1 小时条数，≥5 直接拒（429）
3. **内容必须来自真实报告** —— 没有 `MatchReport` 的匹配直接 404

第 2 条为什么落库而不是内存计数：**Vercel 是多实例 Serverless**，
进程内计数无法跨实例共享，等于没有节流。这也是 `CommunityPost` 表存在的首要理由
（次要理由是追溯：哪次匹配发到哪个圈子、`content_token` 是多少）。

### 4. 我拒绝了"未经授权就真发帖"

验证脚本第一版是直接真实发布的。写到一半我意识到：
**这会在用户本人的知乎账号下产生可见的外部副作用**，不该由我单方面决定。

改成默认演练模式（完整走链路 + 打印将发布的内容预览），真实发布需要 `--live`：

```
node --env-file=.env scripts/verify-community-post.mjs          # 演练，不发
node --env-file=.env scripts/verify-community-post.mjs --live   # 真发
```

另外文档**没有提供「删除想法」接口**，所以发出去的动态只能由用户在知乎 App 内手动删。
这一点必须在动手前讲清楚。

### 5. 一个已知的偶发失败（未修）

`verify-web-discover` 里「雷达里点头像跳到人格卡」偶发失败（约 1/3 概率），
URL 停在 `/find` 没跳转。重跑一次就过。

判断：这是雷达点击命中测试（`document.elementFromPoint` 回退路径）的**时序 flake**，
不是本轮改动引入的（本轮没碰雷达或发现页）。
**没有去改这个测试** —— 把断言放宽会把可能的真 bug 一起掩盖。
记为已知问题，等能稳定复现时再定位。

---

## 〇之前之十五、接入真实知乎数据（凭证到位后的第一轮）

### 1. 新到材料与它们的定位

| 材料 | 是什么 | 怎么用 |
|---|---|---|
| `开源项目/zhihu-hackathon-skill_v2026s2/` | **初始化脚手架 Skill** | 它会**生成一个独立的临时 Demo 项目**（hello-world-basic / hello-world-oauth）。**不是我们的模板** —— 我们已有自己的 Next.js 单体工程，所以只取它的参考实现与文档 |
| `Oauth参数.txt` | App ID `530` + App Key | 只写进 `zhiyu-web/.env`，**不进源码、不进日志** |
| `知乎社区API快速开始.txt` | 一个飞书式的知乎内部链接 | 需要登录，**我打不开**（HTTP 403），不假装读过 |
| 根目录 `知乎数据开放平台密钥.md` | Access Secret（用户已确认是自己账号的） | 同上，只进 `.env` |

### 2. ★ 关键发现：Access Secret 可以**单独**使用，不必等 OAuth

`references/user-api.md` 的「身份模型」写得清楚：

| 场景 | `Authorization` | `X-OAuth-Token` |
|---|---|---|
| **当前调用方本人** | Access Secret | **不传** |
| 第三方应用中的授权用户 | Access Secret | 传该用户的 OAuth token |

所以五个用户接口（创作 / 关注 / 收藏夹 / 收藏夹内容 / 近期收藏）
**现在就能真调**，不需要等 App ID 与公网回调。实测确认有效：

```
① 用户创作   1 条   [pin] 🧠 知遇ZhiYu｜在你认识一个人之前，让 Agent 先认识 TA
② 用户关注   2 条   知乎产品情报局 / 知乎日报
③ 收藏夹     1 个   我的收藏
④ 收藏内容   1 条
⑤ 近期收藏   1 条
```

### 3. 于是「知乎 · 公共表达」这一源从假注入变成了真同步

在此之前 `personaSource(status: "injected")` 是**硬写的**，从没真读过数据。

新增：
- `lib/zhihu/user-api.ts` —— 五个接口的客户端（双凭证模型、分页、错误不外泄）
- `lib/zhihu/sync.ts` —— 拉数据 → 抽标签 → **并集合并**进 `interests`/`topics`
  → 写 `PersonaEvidence` 保留出处 → 标记源已注入
- `app/api/zhihu/sync/route.ts` —— 同步接口（Access Secret 只在服务端用）
- 人格页「注入数据」里知乎那张卡换成真的「连接知乎并同步」按钮 + 结果面板

设计取舍：
- **并集不覆盖** —— 用户自己填的标签不能被同步冲掉
- **幂等** —— 重复同步不累积重复标签（实测 8 → 8）
- **单接口失败不阻断整体**，但如实记进 `errors`（收藏夹为空是正常结果，不算失败）
- **响应体不含任何凭证**（实测断言）

### 4. 两个"测试写死数字"的问题

知乎源一注入，我的人格页验证就从 20/20 掉到 18/20 —— 因为它写死了
「只有 1 个已注入」「5 个禁用按钮」。**功能是对的，断言过期了。**

改成从数据推导：`已注入数 → 与卡片实际状态一致`、
`禁用按钮数 → 未接入来源数`。

另一处：知乎同步验证重复跑时"新增标签"必然为空（标签已在库里）。
改成**测试自己先把标签重置到基线**，这样断言可重复。

> 这两处是同一类问题：**断言依赖了会变化的外部状态**。
> 凡是"数量/集合"类断言，要么从数据推导，要么自己固定初始状态。

---

## 〇之前之十四、zhiyu-web 移植收尾：Agent 匹配页与两个"数据被污染"的坑

### 1. 演示用户的昵称会被每次登录覆盖

`/api/auth/demo` 原本是 `upsert(update: { displayName })`，
意思是**每次调用都用入参刷新昵称**。后果：

自动化测试跑过之后，demo 用户的名字变成了「Agent匹配验证」，
而 Agent 对话里显示的是这个测试名 —— 报告上出现「Agent匹配验证 的 Agent」。

修法：只在**首次创建**时写 displayName，已存在时不覆盖。
`scripts/seed-demo.mjs` 里也加了一句昵称归位，把已污染的库修回来。

> **教训**：`upsert` 的 `update` 分支要慎重。凡是"身份类"字段（昵称、头像、绑定 ID）
> 都不该由调用方每次覆盖 —— 否则任何一次调用（包括测试）都会改掉真实数据。

### 2. Agent 匹配页不需要"造"数据，但需要 seed 才看得见

这一页需要真实的 `Match` / `AgentSession` / `MatchReport` 才有内容，
而它们只能由 `/api/matches/[id]/start` 产生（会跑一遍对话）。

做法：`scripts/seed-agent-match.mjs` **复用 `lib/agent/dialogue.ts` 的
`runMockAgentDialogue`**，而不是自己编几轮对话。
这样 seed 出的数据结构与真实运行时**完全一致**（rounds / dimensions /
reasons / overall 都由同一份代码产生），不会出现"seed 的数据和线上不一样"。

`dialogue.ts` 没有任何 import，所以能被裸 Node 脚本直接引用。

### 3. 报告里的 `demoMode` 必须如实标注

`MatchReport.result` 里带了 `demoMode` 与 `llmError` 两个字段
（由 `/start` 在 LLM 失败回退到 Mock 时写入）。

页面把这个标记显式展示成「演示模式」角标 + 弹窗里一句说明：
「本报告由**确定性规则**产生（演示模式），不是真实 LLM 的判断。」

**不标注等于把 Mock 结果冒充 LLM 判断。** 演示场合尤其不能这样。

### 4. CDP 适配器没有 `page.keyboard`

想测 Esc 关弹窗时发现 `page.keyboard` 是 undefined。
改用 `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`。

---

## 移植完成度（8 页 / 231 项验证）

| 页面 | 路由 | 验证项 |
|---|---|---|
| 登录页 | `/` | 15 |
| 首页 | `/home` | 13 |
| 发现页 | `/find` | 24 + 接口 18 |
| 我的人格 | `/persona` | 20 |
| Agent 匹配 | `/agent-match` | 31 |
| 通知 | `/notify` | 23（与设置页合计） |
| 设置 | `/settings` | 同上 |
| 地基（6 路由 × 结构/主题/壳） | — | 6 |
| 雷达组件（纯逻辑） | — | 13 |
| OAuth（协议 Mock / 加密 / 路由集成） | — | 37 + 12 + 19 |

**唯一未完成的是知乎 OAuth 的实网联调** —— 依赖赛事页面的 App ID / App Key
与已登记的公网 HTTPS 回调地址，两者都在用户侧。

---

## 〇之前之十三、zhiyu-web 移植期：通知页与设置页

### 1. 设置页 02 区的开关终于真的生效了

`产品方案/前端页面框架.md` 里早就写了「沟通偏好的 API 契约」，
但**代码里一直没有对应路由** —— 表和 UI 都有，接口没有，所以开关点了没有任何作用。

这一轮补上 `GET/PATCH /api/settings/prefs`，并把契约里的两条关键要求落实：

- 记录不存在时 `GET` 返回默认全开，**不隐式建行**；`PATCH` 才 upsert
- 只接受三个 boolean 字段，**未出现的字段保持原值**
- 校验对象是**被访方**的偏好（契约里专门警告过："按发起方校验会逻辑反转"）

验证方式也是照契约来的：不只点开关，还**读回接口确认落库**。

### 2. 通知里的 `overallScore` 是 0~1 小数，不是百分数

库里存的是 `0.52`，页面要显示 `52%`。这个换算放在 `lib/notify.ts` 统一做，
避免每个页面各写一遍（首页的通知预览就曾因为没有换算而显示成 0.52% 的风险）。

### 3. 又一个"用户可见文案里写了 Markdown"

设置页有三处 JSX 字符串写成了 `**加粗**`，页面上会**原样显示星号**。
注释里写 Markdown 没问题，但字符串是要渲染的，得用 `<b>`。

**教训：写完 UI 文案后，grep 一次 `\*\*` 确认没有漏网的 Markdown。**

### 4. ★ 第四次用 PowerShell 改含中文的文件

把测试脚本从 `RECON/` 移到 `zhiyu-web/scripts/` 时，
我用 `(Get-Content -Raw).Replace(...) | Set-Content -Encoding UTF8` 改了一处路径，
结果整个文件的中文变成 `閫氱煡椤?` 这类乱码，注释换行也被吃掉。

同一个错误在本会话里已经犯到**第四次**。前三次的教训都是"以后别这么干"，
但显然不够。这次改成一条**可执行的自检**：

> 凡是写了含中文的文件，**执行 `node --check <file>`**（.mjs/.js）
> 或让 `tsc` 跑一次（.ts/.tsx）。
> 乱码会直接导致语法错误，一跑就暴露 —— 而我之前是"看起来没事就不管了"。

`node --check` 在这次确实立刻抓到了问题（还有一处 `.mjs` 里误用了 TS 的 `as`）。

---

## 〇之前之十二、zhiyu-web 移植期：OAuth 实现与两条"文档已写、仍然重犯"的坑

### 1. ★ 我重犯了自己刚写进本文档的两个错误

这一轮的教训不是"发现了新坑"，而是**明知有坑还是踩了**，比新坑更值得记。

**（a）改完 Prisma schema 没重启 dev server。**

上一轮我明确写过：「改完 Prisma schema 必须重启 dev server，
拿到 null 时先用原生 SQL 查一次」。这一轮加了 `AuthSession` / `OAuthState`
两个 model、跑了 `prisma generate`，**却没重启**，结果：

```
TypeError: Cannot read properties of undefined (reading 'findUnique')
    at getSession (lib/auth/session.ts:65)
```

`prisma.authSession` 是 `undefined` —— 旧客户端里没有这个 model。

**这次的症状与上次不同**（上次是读到 null，这次是直接抛 undefined），
所以"认症状"没用，要认**根因**：`prisma generate` 改了 `node_modules`，
而 `next dev` 把客户端模块缓存在内存里。**只要改了 schema 就必须重启。**

**（b）又用 PowerShell 的 `-replace` / `Set-Content` 改含中文的文件。**

上一轮的铁律原文是：「改含中文的文件只用 edit / write 工具」。
这一轮我在给一个测试脚本改路径时又用了 `-replace`，
结果中文再次变成 `鍘熸枃`、`绫诲瀷` 这样的乱码。

**两次都是"我知道但顺手就用了"。** 结论：
- 路径替换也要走 `edit` 工具，哪怕只改一个字符串
- 如果只是想临时改一个脚本做调试，**写完就删**，别用 shell 改

### 2. 知乎 OAuth 有两份官方文档，且互相冲突

材料在 `开源项目/zhihu-cli-skill-0.7.2-…/references/`：

| 文档 | 性质 |
|---|---|
| `hackathon-oauth.md` | 黑客松专用，2026-09-09 更新 |
| `oauth.md` | 通用 OAuth，含 2077 项目 2026-05-14 线上实测偏差 |

**冲突一：回调到底回不回 `state`？**
`oauth.md` 说"实测不返 state"，`hackathon-oauth.md` 说"黑客松服务已支持原样透传"。
后者更新且是黑客松专用，取后者；但实现上做成**回传就严格校验、
没回传不阻断并记日志**，避免在"确实不返"的环境里无法登录。

**冲突二：`app_key` 能否直接作为表单参数？**
`oauth.md` 列为待确认项，`hackathon-oauth.md` 与官方参考实现都在用。按后者实现。

### 3. 一条必须实测才能信的警告：`uid` 会被静默舍入

文档写「`uid` 可能超过 JavaScript 安全整数范围，需无损解析」。
实测确认：

```
字面量 904491330657081871 → JSON.parse 读出 904491330657081900
字面量 1234567890123456789 → JSON.parse 读出 1234567890123456800
```

**没有任何报错**，只是值变了。所以 `lib/auth/zhihu-oauth.ts` 里先做文本预处理
（把 `"uid": <长数字>` 包成字符串）再 `JSON.parse`。

> 附带一个方法论教训：我第一次验证这条时，是用模板字符串把数字拼进 JSON 的，
> 结果**拼接阶段就已经舍入**，看起来"没丢精度"。必须把字面量直接写死在字符串里。

### 4. 官方文档里容易漏掉的响应约定

- 头像字段是 **`avatar_path`**，不是 `avatar_url`
- `email` / `phone_no` 无权限时返回**空字符串**，不是缺字段
- **不能只凭 HTTP 200 判成功**：用户不存在时是 `200 + {"code":404,"data":"User don't exist"}`
- `/access_token` 与 `/user` 的 `code: 20000` **表示成功**，不能把非零 code 当失败
- 基础信息接口**不需要** Access Secret / `X-OAuth-Token` / 时间戳（那是创作类接口才要）

### 5. 路径别名会让"裸 Node 测 lib"失败

`lib/auth/session.ts` 用了 `@/lib/db`，裸 `node` 解析不了这个别名。
所以会话相关的验证改成**走真实 HTTP 打路由**——
反而更接近真实集成，顺带把 Cookie 的 HttpOnly / 清除行为一起验证了。

---

## 〇之前之十一、zhiyu-web 移植期：我的人格页与三个新坑

### 1. `submit.type` 是对象，不是字符串

`/api/sbti/submit` 返回的 `type` 是 **`{ name, title }`**，我按字符串用，
React 直接抛：

```
Objects are not valid as a React child (found: object with keys {name, title})
```

整个页面因此白屏。修法：客户端做一次归一化——

```ts
const t = resp.type as string | { name?: string; title?: string };
const typeLabel = typeof t === "string" ? t : (t?.title ?? t?.name ?? "");
```

**教训：接口返回值的"类型"不能只看字段名。** `type` 听起来像字符串，
实际是对象。接线前先打印一次真实响应。

### 2. SBTI 是 15 个维度，不是 5 个

题库实测 15 个维度（每类 3 个）：S 自我 / E 情感 / A 观念 / Ac 行动 / So 社交。

所以「综合画像」雷达的 5 根轴**不是编出来的**，而是按类目前缀聚合：
每轴取该组 3 个维度的归一化均值（见 `lib/sbti/axes.ts`）。

前缀匹配有个坑：`Ac` 与 `A` 都以 A 开头，**必须先匹配更长的前缀**，
否则 `Ac1` 会被 `A` 抢走、行动轴永远为空。

### 3. 演示数据回填不能覆盖用户真实结果

`/api/auth/demo` 原先每次都把 `DEMO_PERSONA` 整体 upsert 进 persona，
于是**用户做完 30 题 SBTI 后一登录就被演示数据覆盖**。

修法：只在「从未测过」（没有 `sbti.type` 或没有 `dimensions`）时写入演示 SBTI；
已有真实结果时只补 interests / topics / communicationStyle / values。

### 4. 测试顺序会影响结论

人格页验证里我走完了 30 题（全选 A → 全 L 分），把 seed 的演示维度覆盖了，
于是同一份断言在"跑测试前"和"跑测试后"结果不同，一度让我以为雷达坏了。

**排查这类问题要先固定数据状态**（重新 seed），再跑断言。

---

## 〇之前之十、zhiyu-web 移植期：发现页与四个新坑

### 1. ★ 改完 Prisma schema 必须重启 dev server

给 `Persona` 加 `province` / `agentOpen` 并 `prisma generate` 之后，
接口返回的这两个字段**全是 null**，而用 `$queryRaw` 直接查库**数据完全正确**。

根因：`next dev` 进程是在改 schema **之前**启动的，缓存着旧的 Prisma Client，
新字段在它眼里不存在。重启后立刻正确。

**判定方法**：拿到 `null` 时，先用原生 SQL 查一次。
库里有值而 Prisma 读出 null ⇒ 就是客户端陈旧，先重启再查代码。

### 2. 重构接口返回结构时，要检查所有既有调用方

把 `/api/matches/quick` 从「直接返回引擎结果」改成「返回完整候选对象」后，
字段名从 `personaId` 变成了 `id`，而 `/home` 仍在读 `m.personaId`。
两个后果：

- React 把 5 张卡片判为**同一个 key**（`undefined`），报"unique key"警告
- 「让 Agent 先聊聊」传给接口的 `personaBId` 是 `undefined`，**创建匹配会失败**

修法：`DiscoverCandidate` 同时给出 `id` 与 `personaId`（后者标注为兼容别名）。
**教训：改返回结构前，先 grep 所有调用方用了哪些字段名。**

### 3. 给元素设尺寸前，先确认它不是 inline

`.track`（进度条容器）用 `<span>` 承载，`display` 计算值是 `inline` ——
**inline 元素上的 `width` / `height` 不生效**，`height: 9px` 被忽略，
整条被内容撑到 125px，渲染成巨大色块。

同一个坑在 `.brandPlate` 上踩过一次（inline 不约束绝对定位子元素，图片撑成 370px）。
**凡是设尺寸的元素，先确认 `display` 不是 `inline`。**

### 4. CDP 适配器没有 `page.fill` / `page.selectOption`

本项目的 Playwright 包装层只暴露 `evaluate / screenshot / mouse / goto / waitForTimeout / on`。
给输入框赋值要用**原型上的 value setter + 派发 input/change 事件**，
否则 React 收不到值变化：

```js
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
setter.call(el, value);
el.dispatchEvent(new Event("input", { bubbles: true }));
```

另外：**刚改完代码就跑浏览器测试，会因 dev server 重编译而偶发失败。**
看到单点失败先重跑一次再判断是不是真 bug。

---

## 〇之前之九、zhiyu-web 移植期：雷达组件与三个实现教训

### 1. 浮点坐标导致 hydration 不匹配

`Radar` 把计算公式的结果（`Math.cos(a)×r`）直接写进 `style={{left: …}}`，
服务端渲染成 `left:"359.077px"`，客户端是 `left:359.0769002937092`，
React 报整树 hydration 不匹配且**拒绝修补**。

修法：布局层所有坐标统一 `Math.round()`。
**凡是会把计算结果写进 style 的地方，都要先取整。**

### 2. 人少时轨道环 key 撞车

多道环在人数少时会落在同一半径（`rankRadius(0)` 反复出现），
`key={`ring-${r}-${sim}`}` 因此重复。key 里必须带下标。

### 3. Next.js 把下划线开头的目录当私有目录

建临时验证页 `app/(app)/_radar-probe/page.tsx` 访问返回 **404**。
Next.js 的 private folder 约定：`_` 开头的目录不参与路由。
改名 `radar-probe` 即可。

### 4. 取景坐标基准错误会把中心推出视口

`computeView` 早期直接用视口宽高算平移，等价于假设视口位于页面 `(0,0)`。
雷达放在页面下方时，「聚焦我」算出的平移会把中心推出视口外。

修法：返回的平移量以**视口左上角**为基准，只用 `clientWidth/clientHeight`，
绝不代入视口在页面中的位置。

### 5. 默认取景不能是「全览」

16 人时画幅约 2561px，缩进 1084×680 视口只有 `k≈0.30`：
头像 84px→25px、中心「我」88px→26px，整幅糊成一片点。

改为三档取景：

| 档 | k（16 人） | 用途 |
|---|---|---|
| 自适应（默认） | 0.50 | 尽可能多装人，且保证头像 ≥ 42px 读得清 |
| 全览 | 0.30 | 纵览分布（确实很小，但看得全） |
| 聚焦我 | 0.79 | 细看以自己为中心的近邻 |

### 6. 内圈半径必须给中心「我」留位置

`RADIUS_MIN=170`（照搬原型）时，**排名第一的人会压在中心「我」身上**：
中心视觉半径约 44px + 节点半宽约 60px = 需要约 104px 余量，
但 170 在「聚焦我」取景下仍然贴脸。改为 **240** 并加了断言守住。

### 7. 轨道环与连线在缩放后淡到看不见

沿用原型 `--line-soft: rgba(83,42,23,.24)`，缩放 0.5 后只有约 0.7px。
而轨道环承载「半径 = 相似度」的参照含义，看不见就失去意义。
改为 `rgba(83,42,23,.40)` / `rgba(226,102,79,.62)`，线宽 1.6 / 2。

### 8. ★ 我三次用 PowerShell 的 `-replace` / `Set-Content` 改含中文的文件，三次损坏

症状：`✓` 变成 `鉁?`、`探索者` 变成 `鎺㈢储鑰?`，行结构被破坏。
**这个错误本会话内已被明确警告过，仍然重犯。**

铁律：**改含中文的文件只用 edit / write 工具，绝不用 PowerShell 的任何文本替换或重定向。**
`-replace` + `Set-Content -Encoding UTF8` 在中文 Windows 上会按 GBK 误读源文件。

---

## 〇之前之八、zhiyu-web 移植期：一个会静默毁掉整站的 Next.js 16 陷阱

把原型移植进 `zhiyu-web` 时踩到一个**极难定位**的问题，记录在此。

### 症状

登录页 HTML 渲染完全正常（结构、样式、资源全对），但是：

- 按钮点击**毫无反应**
- DOM 节点上**没有任何 `__react` 键**（React 未接管）
- 滚动进场动画**永不触发**（IntersectionObserver 从未回调）
- **控制台零报错、零警告**

而诡异的是：**我手动 new 一个同参数的 IntersectionObserver 却能正常触发**，
`page.evaluate` 里点 `el.click()` 也不发任何网络请求。

### 根因

`next dev` 的 **stderr**（不在页面控制台里）写着：

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1".
  Cross-origin access to Next.js dev resources is blocked by default for safety.
```

**Next.js 16 默认拦截跨源请求 dev 资源。** dev server 以 `localhost` 启动，
而自动化脚本/浏览器常用 `127.0.0.1` 访问——**两者源不同**，
客户端 JS 被拦，整站 hydration 静默失效。

### 修法

`next.config.ts`：

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};
```

配置名与语义由版本内文档确认：
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md`。
（项目的 `zhiyu-web/AGENTS.md` 明确警告"这不是你熟悉的 Next.js"，
所以这类配置不能凭记忆写，必须查版本内文档。）

### 教训

1. **`next dev` 的 stderr 必须看。** 页面控制台永远是干净的，
   而这条警告只出现在服务器进程输出里。
2. **"页面渲染正常 + 零报错 + 事件不绑"** 这个组合，
   优先怀疑 hydration 没发生，而不是组件写错了。
3. **判定 hydration 是否发生**用 `Object.getOwnPropertyNames(el).some(k => k.startsWith("__react"))`，
   比"看页面有没有内容"可靠得多——SSR 出来的 HTML 会让后者误判为成功。

---

## 〇之前之七、第九轮：雷达点头像「仍然」打不开（真根因）

上一轮我以为修好了（改了 `dragDistance` 的状态泄漏），但用户反馈**还是没反应**。
复盘：**我上一轮的测试用的是 JS `el.click()`，那是合成事件**，
不经过 `pointerdown` / `pointerup`，所以测不出真正的原因。

### 真根因：`setPointerCapture` 重定向了 click 目标

用真实鼠标事件抓事件链，一眼就看出来了：

```
pointerdown → target: IMG.（头像）          ← 起始正确
pointerup   → target: DIV.radar-viewport  ← 变了
click       → target: DIV.radar-viewport  ← 所以 e.target.closest('.radar-avatar') 永远为 null
```

原因：我在 `pointerdown` 里**无条件**调用了 `viewport.setPointerCapture(e.pointerId)`。
指针一旦被捕获，后续所有指针事件（含 `pointerup` 与 `click`）的 target
都会被**重定向到捕获元素**。于是点头像时 click 永远落在 viewport 上，
人格卡就永远打不开。

### 修法（两处，缺一不可）

1. **只在确认是拖拽后才捕获指针**：`pointerdown` 不再捕获，
   等 `pointermove` 的位移超过 5px 阈值、真正开始拖拽时再 `setPointerCapture`。
   这样纯点击路径完全没有指针捕获，`click.target` 正常指向头像。
2. **命中判定加坐标兜底**：拖拽路径下 `click.target` 仍会是 viewport，
   所以 `e.target.closest()` 失败时，用 `document.elementFromPoint(e.clientX, e.clientY)`
   反查真实元素。这样两条路径都能正确打开人格卡。

### 验证方式的修正（更重要）

`RECON/test-bugfix.mjs` 里所有雷达点击测试**改为真实鼠标事件**
（`page.mouse.move / down / up`），不再用 JS `.click()`。
新增用例：

- 真实鼠标点第一个头像 → 打开对应人格卡
- 真实鼠标点第二个头像 → 打开的是第二个（验证 id 传递）
- **先拖拽一次再真实点击** → 仍能打开
- 拖拽仍能平移；拖拽结束不会误开人格卡

> **教训：合成事件（`el.click()`）测不出依赖真实指针序列的缺陷。**
> 凡是涉及 pointer 捕获、拖拽、手势的交互，验证必须走真实鼠标/触摸事件。
> 我上一轮就是因为这个漏洞，把一个没修好的 bug 报成了"已修复"。

---

## 〇之前之六、第八轮：设置页开关「错位」

用户反馈：设置页「02 · Agent 沟通偏好」里 `#sw-agent` 位置错位，下面两个同样。

### 实测到的真实问题

`.s-row` 是 `grid-template-columns: minmax(0,1fr) auto` 的两列网格，
父级 `align-items: center` 会把**两列各自居中**：

| 行 | 左列高度 | 控件 | 控件中心 − 标题行中心 |
|---|---|---|---|
| 微信 / QQ / 飞书…（只有一行说明） | ≈44px | 75×44 按钮 | **0px**（看不出问题） |
| 允许他人派 Agent…（标题 + 两行说明） | ≈79px | 46×26 开关 | **+27px** |
| 退出登录（标题 + 一行说明） | ≈50px | 88×44 按钮 | **+11px** |

所以「错位」的本质是：**控件被居中到整行，而不是居中到它所属的标题行**。
「身份与数据源」那几行左列只有 44px 高，两列高度接近，差异为 0，
所以我之前肉眼扫过整页也没发现问题。

### 修法

把控件列在**纵向上收缩成标题行的高度**（`height: 23px`），
子元素（26px 开关 / 44px 按钮 / 状态文字）就会被居中到这个高度里，
中线自然与标题行齐平 —— 一套规则覆盖所有控件类型，不需要逐个补偿。

```css
.s-row > .s-ctl {
  align-self: start;
  align-items: center;
  height: 23px;        /* = 标题行高度 (15.5px × 1.5) */
  min-height: 0;
}
```

开关的 44px 触控热区由 `padding-block: 9px; margin-block: -9px` 保留
（视觉位置不动，点击区域仍是 44px）。移动端单列布局下这组补偿全部关掉。

**结果**：9 行控件的最大偏差从 27px 收敛到 **1px**。

### 验证

已把这条断言并入常驻验证 `RECON/verify-reskin.mjs`：
逐行比较「控件中线 − 标题行中线」，阈值 3px，超出即失败。
当前输出：`行控件对齐: 9 行，最大偏差 1px`。

---

## 〇之前之五、第七轮：匹配报告的字距与底色（含一次追错方向的复盘）

用户反馈：「匹配报告的字间距有问题，文字要超出容器外边了」。

### 实际查到的两件事

**① 字距确实过大，把标签撑宽**（这是真问题）

| 元素 | 原字距 | 后果 |
|---|---|---|
| `.why-block .k`（为什么推荐你认识 TA？） | `0.1em` @11px | 多占 **14px**，几乎顶到容器右缘 |
| `.panel-eyebrow`（匹配报告 · 综合匹配度） | `0.06em`（**主题层加的**） | 多占 **8px** |

修法：`.k` 收到 `0.02em`、`.panel-eyebrow` 收到 `0.02em`，
并给等宽小字显式 `line-height`（11px 配 1.5 行高时字形会压出盒子）。

**② 更显眼的是底色错位**（上一轮我改出来的）

上一轮按「改成纯色 #FDF6E8」把 `.rep-dims` / `.dim-list` 涂成纯色。
但报告弹窗本身是 `#FFF9EB` **+ 纸纹**，在这层纸上贴一块纯色，
会在容器的 padding 区露出**硬边色带**，而内容区（`.dim-item` 是透明的）参差不齐 ——
视觉上就成了「容器到一半、文字在外面」，这才是用户看到的"超出容器"。

修法：弹窗内的容器不再自己承担底色，改为**透明**，让弹窗纸底贯通；
只有独立成块的区域（`.quick-result` 快速匹配结果、`.mcard` / `.rep-row` 报告卡）
保留 `#FDF6E8`。

### 复盘：我追错了三轮指标

我一开始用 `Range.getClientRects()` 去量「文字墨迹是否越过自身盒子」，
得到 `.dn` 出盒 2px、`.dv` 出盒 3px，于是不断加行高去修。结果**越修数值越大**——
因为 `Range` 返回的是**行盒**高度，行高越大越"出盒"。

结论：**那个指标根本不是视觉墨迹**，它只在行高恰好等于字形高度时才≈墨迹。
真正可靠的判断是：① 元素 box 之间是否重叠（`.dtop` 高度 20px、`.dn` 盒高 22px，
间距充足，无视觉重叠）② 直接看高清截图。

教训：**当"修复"让指标变差时，先怀疑指标本身**，而不是继续加大剂量。

### 验证

`RECON/test-stripes.mjs` 的口径已随最终方案更新：
- `.quick-result` 应为 `rgb(253, 246, 232)`
- `.rep-dims` / `.dim-list` 应为 `rgba(0,0,0,0)` 且无底图
- 全站 7 页不得有任何元素引用 `stripes.png`

---

## 〇之前之四、第六轮：匹配结果 / 报告底色改为纯色

**原因**：发现页「快速匹配结果」、Agent 匹配页与通知页的「匹配报告」原本用了
`assets/textures/stripes.png` 条纹纹理（沿用新前端 `.striped-card` 的做法），
用户反馈观感偏花。

**改动**：一条规则，把这四处容器的底色统一为纯色 `#FDF6E8`，并去掉纹理引用。

```css
.striped-surface,
.dim-list,
.rep-dims,
.quick-result {
  background-color: #fdf6e8;
  background-image: none;
}
```

去掉纹理后，视觉层次改由内容自身承担（雷达图、维度进度条、报告文字），
不再需要底纹来分区。

**验证**：`RECON/test-stripes.mjs` 读取三处的**计算样式**确认
`backgroundColor === rgb(253, 246, 232)` 且 `backgroundImage === none`，
并全站扫描 7 个页面确认不再有任何元素引用 `stripes.png`。

> 参考图 `发现页的相遇雷达.png` 里的「遇见更契合的人」木牌插画也用了类似纹理，
> 但它属于插画内容本身，不是 CSS 底纹，因此不受影响。

---

## 〇之前之三、第五轮：两个交互 bug 修复

### BUG-1 · 相遇雷达点头像没反应

**根因（我自己引入的）**：拖拽判断用了跨交互累积的「最大位移」变量 `moved`，
一次拖拽后它永久大于阈值，导致之后**所有点击都被吞掉**。另外 `pointerleave`
在 `setPointerCapture` 期间也会触发，把拖拽状态搞乱。

**修法**：
- 改用**每次 `pointerdown` 归零**的 `dragDistance`，并在 `click` 处理完后再次归零
- 未超过 5px 阈值时不移动舞台，保留点击语义
- 移除 `pointerleave` 结束拖拽，只认 `pointerup` / `pointercancel`

> 这个 bug 的隐蔽之处：**单独点一次是好的，拖一下之后就永远点不开了**。

### BUG-2 · 「让我的 Agent 先聊聊」跳错页

**根因**：`startMeet()` 里写死了 `window.location.href = 'zhiyu-agent-match.html'`，
发现页与首页的人格卡按钮都走这条路。卡片列表按钮的文案还是旧的「和 TA 对话」，
而弹窗里 `closeModal()` 之后才调用 `startMeet()` —— 等于关了卡片又跳页。

**修法（按要求改为后台进行 + 原地留守）**：
- 移除所有跳转；两个 Agent 视为转到后台对话
- 弹出提示：**「你的 Agent 已在后台开始和 <名字> 对话，有进展会通知你。」**
- 把这次发起写入 `localStorage`（`zhiyu-match-focus` / `zhiyu-pending-meet`），
  供 Agent 匹配页识别后台会话
- 卡片按钮与弹窗按钮统一走同一个 `startMeet()`，文案一致

**必要的补偿**：不跳页之后，用户就没有任何线索知道任务已启动，因此在侧栏
「Agent 匹配」右上角加一个**暖色脉冲小圆点**（`.nav-running-dot`）。
这与「界面不要跳转」并不冲突 —— 它只是提示，不改变当前页面。

### 验证

新增 `RECON/test-bugfix.mjs`（23 项），重点覆盖那个隐蔽场景：

- 雷达点头像 → 打开人格卡
- **先拖拽一次、再点头像 → 仍能打开**（旧实现在此必然失败）
- 拖拽本身仍能平移；拖拽结束不会误开人格卡
- 连续点击两个不同头像都能打开
- 发现页 / 首页：点击后 **URL 未变化、0 次导航**
- 提示文案匹配 `你的 Agent 已在后台开始和 .+ 对话，有进展会通知你。`
- 侧栏小圆点出现、`zhiyu-pending-meet` 正确写入

---

## 〇之前之二、第四轮：发现页「相遇雷达」

用户反馈：发现页展示搜索结果的方式太单调，希望改成参考图
`发现页的相遇雷达.png` 的形式 —— 以「我」为中心的雷达图，展示每个人的
**头像 / 名字 / 人格倾向**，可移动以容纳更多人。

### 决策（已与用户确认）

| 问题 | 决定 |
|---|---|
| 雷达与卡片的关系 | **两者并存**，用「卡片 / 相遇雷达」切换器切换 |
| 数据量 | 示例人物 **6 → 16 位** |
| 头像随机规则 | **按 id 确定性映射**（否则同一人在雷达与弹窗里会换脸） |
| 环的语义 | **半径 = 相似度，越近越同频** |

### 实现要点

**新增文件**
- `zhiyu-radar.js` —— 自包含雷达组件，暴露 `window.ZhiyuRadar.render(el, list)`
- `assets/characters/` 里的 7 张角色画用作头像池（`self` 固定作中心）

**发现页改动（只动渲染层，不动筛选逻辑）**
- 三个页签各加一个「卡片 / 相遇雷达」切换器
- 抽出 `paintResults(area, list, withSim)`：两种视图共用同一份筛选结果，切换不丢数据
- `applySearch` / `renderRandom` / `quickMatch` 改为调 `paintResults`
- 随机推荐 3 → 8 位；快速匹配 3 → 10 位
- `window.openProfile` 暴露给雷达组件；弹窗头像也改用角色画

### 布局算法：从「松弛推挤」到「排序螺旋」

**第一版**：相似度线性映射半径 + 角度均分 + 松弛推挤消除重叠。
实测 **16 人时有 7 组重叠**（如「演示人格 03 × 04」重叠 63×46px）。

根因：想同时满足「半径严格映射分数」与「零重叠」，在给定画幅下**不可兼得** ——
分数集中在 69–88 区间时，所有人都被塞进同一圈，推挤只能改变角度不能改变半径。

**第二版**：按相似度**降序排名**，把名次铺在黄金角螺旋上
（phyllotaxis，`r = RADIUS_MIN + SPACING·√rank`）。

- 「越近越同频」**严格成立**（半径随名次单调递增）
- 黄金角保证**任意两人不重叠**（实测 0 组）
- 半径不再精确等于分数值，但视觉上读起来一样

### 取景：两种视图并存

16 人按可读间距铺开需要约 1500px 画幅，而视口只有约 1017px ——
**不可能同时「全装下」与「看得清」**。因此提供两个按钮：

| 按钮 | 行为 |
|---|---|
| 默认 | **全览**：整幅缩进视口，一次看到全部 16 人（头像偏小） |
| 聚焦我 | 放大到以「我」为中心，头像与标签看得清 |
| + / − | 手动缩放，缩放下限 0.3、上限 2.4 |
| 拖动 / 滚轮 | 平移 / 以光标为锚点缩放 |

### 验证

`RECON/test-radar.mjs`（专项）与 `RECON/verify-reskin.mjs`（常驻断言）覆盖：

- 雷达渲染 16 节点、4 道环、16 条连线、14 个装饰点
- **重叠实测 0 组**（逐对比较真实包围盒，不是看布局参数）
- 与中心「我」无重叠；头像全部加载成功
- 拖拽改变 transform、滚轮/按钮缩放生效、全览与聚焦我各回正位
- 点头像打开人格卡（标题/头像/雷达/相似度均正确）
- 筛选（北京 → 3 位）后雷达同步；切回卡片数据不丢
- 随机推荐 8 节点、快速匹配 10 节点

### 已知取舍

- **默认全览时头像偏小**（约 25px）。要放大请点「聚焦我」。
  若希望默认更易读，把 `centreView` 里默认那支的 `view.k` 下限从 0.3 提到 0.5 即可。
- 雷达只对**当前筛选结果**作图，不额外扩池；要看更多人请放宽筛选条件。

---

## 〇之前、第三轮：换成生成式品牌 logo

用户选定 `RECON/logo-gen/v3-gpt-image-2.5-B-狐+双气泡.png` 作为正式 logo，替换原先手写的 SVG。

**logo 来源**：用 `gpt-image-2.5`（经 `https://api.openai-next.com` 图像接口），
以 `素材/刘看山三视图/` 为角色基准生成。共出图 18 张（`gpt-image-2.5` 10 张 +
`gemini-3-pro-image` 4 张 + 早期迭代 4 张），挑选页见 `RECON/logo-gen/final-candidates.png`。

**刘看山的关键特征**（第一版误画成通用狐，现已修正）：
高挑圆润的**白身体** + 两个短**三角尖耳** + 巨大的**黑色球鼻**（圆而非椭圆）+
两个**黑点眼**（高且分得开）+ 细**黑杆四肢** + 小圆白尾巴。

**资产化处理**（`RECON/build-logo-assets.mjs`）：
1024×1024 原图按内容包围盒裁到 977×866（去掉大片米色留白），统一底色为 UI 纸底
`#f9f1df`，导出 8 档位图到 `assets/logo/`：

| 档位 | 用途 |
|---|---|
| `logo-1024` / `logo-512` / `logo-256` | 高清源、登录页 76px 的 4x |
| `logo-128` / `logo-104` | 侧栏 52px 的 2x（默认 `src`） |
| `logo-72` / `logo-52` | 侧栏 52px 的 1x |
| `logo-32` | favicon（浏览器标签页） |

HTML 里用 `srcset` 按 DPR 选档：`logo-52.png 1x, logo-104.png 2x, logo-256.png 4x`。

**为什么不用 SVG**：这是插画式位图，含渐变与柔和高光，手写路径无法保真；
改为按显示尺寸导出多档 + `srcset`。实测裁剪后 52px 能拿到 44×39px 原始像素，
侧栏显示清晰可辨。

**同时调整**：
- `.brand-plate` 底色改为 `#f9f1df`（与 logo 自带底色一致，避免方形出现色块边界）
- `.brand-logo` 用 `object-fit: cover` + `object-position: 50% 42%`
- 移除右上角手绘金星 `✦`（会与 logo 自带的气泡打架）
- favicon 由内联 SVG 改为 `logo-32.png`
- 删除已无引用的 `assets/logo-zhiyu.svg`

> **教训**：第一轮我把 `临时调用api.txt` 当成纯 LLM key，只查了文本模型就下结论
> 「没有图像生成能力」，实际那是个聚合网关，`/v1/models` 里有 641 个模型，
> 其中包含 `gpt-image-2.5`、`gemini-3-pro-image`、`flux-kontext-pro`、
> `qwen-image-edit-plus` 等几十个图像模型。**该查的时候要查全，不要凭假设下结论。**

---

## 〇、第二轮修改（用户反馈 5 项）

| # | 反馈 | 处理 |
|---|---|---|
| 1 | 产品 logo 按 `素材/logo1.png` 的情况来 | 用户选择「重画手绘风」：新建 `assets/logo-zhiyu.svg`，沿用原图构图（双气泡 + 戴眼镜知乎狐 + 两侧各 3 个对话点），改为墨线勾描 + 纸白填充 + 知乎蓝淡彩气泡。替换 7 页共 8 处 logo 与 favicon |
| 2 | 登录页 `#oauth-trigger` 背景色不对 | 真 bug：计算样式为 `color: rgb(255,249,235)` 浅米色压在浅色渐变上，**文字几乎不可见**（通用按钮覆盖把文字色弄丢）。改为**知乎品牌蓝实心 + 白字**（用户明确品牌色不可改） |
| 3 | 冷色蓝模块改暖色 | 主色由 `#348cff` 改为**暖珊瑚 `#e2664f`**，覆盖：雷达图数据面、进度条/相似度条、通知未读标记（点 + 左条）、选中态导航/主按钮/选中页签、已注入等状态胶囊。蓝色只保留给知乎品牌入口 |
| 4 | 「Agent 蒸馏」模块字挤出模块外 | 真 bug：主题层给 `.stage-list` / `.run-req` 加了卡片边框，但这两者是**无内边距的纯列表**（`padding: 0`），内容因此贴边压线。改为「有边框必给内边距」，并移出卡片选择器清单 |
| 5 | 「人格卡 · 综合画像」留白过多，删掉只留六源 | 已合并：去掉装饰性 eyebrow 与标题排版，六源面板占满整宽，蒸馏操作区移入六源面板底部 |

### 第 5 项踩到的坑（值得记住）

`#ov-title` 与 `#ov-actions` 都是 `paintOverview()` **直接写入的节点**。
第一版把整个左栏删掉后，`paintOverview()` 在 `title.textContent = ...` 处抛
`TypeError: Cannot set properties of null`，**整页 JS 初始化中断**——表现是
「Agent 蒸馏」页签也点不动了，连带 `#ov-actions` 里的「去开始蒸馏」按钮也不再渲染。

正确做法是**保留节点、只让它不参与排版**（`id` 留在一个 `.sr-only` 的 `<h2>` 上），
而不是删节点。教训：改动 JS 依赖的 DOM 前，先用 `grep` 查一遍该 id 被谁引用。

### 另一个坑：XML 注释不能含 `--`

首版 `logo-zhiyu.svg` 的注释里用了 `-----` 分隔线，XML 规范禁止注释内出现连续两个短横线，
文件因此非法、浏览器显示破图（HTTP 却是 200）。分隔线一律改用 `=====`。

---

## 一、为什么是"换 token"而不是"重写 CSS"

改造前先做了一次测量，结论决定了整个方案：

| 测量项 | 结果 |
|---|---|
| 旧 CSS 总量 | 185 KB，分散在 7 个页面的内联 `<style>` 里 |
| **写死的颜色** | **只有 7 个 hex**，且**每一个都只出现在 `:root` 定义里**（各 7 次） |
| `color-mix()` / `oklch()` | 169 / 170 处，**全部通过 `var()` 引用** |
| 外部依赖 | 0（无 webfont、无 CDN、无外链图片） |
| 新前端设计变量 | 仅 13 个 |

也就是说：**整站颜色都由极少数 token 驱动**。因此不需要逐条改写旧 CSS，只要在更高特异性上覆盖 token，全站自动换色。

---

## 二、改动清单（只做加法，不改原有规则）

### 1. 新增文件

| 文件 | 作用 |
|---|---|
| `zhiyu-theme.css` | 主题层。覆盖 token + 手绘组件样式 + 雷达图重绘 |
| `zhiyu-avatar.js` | 角色头像运行时。用 MutationObserver 给头像补 fox 插画 |
| `assets/textures/paper.png` | 纸张底纹（620px 平铺） |
| `assets/textures/stripes.png` | 条纹副卡底纹 |
| `assets/decor/signboard.png` | 侧栏底部木牌插画 |
| `assets/decor/rings.png` | 雷达图环状底衬 |
| `assets/decor/progress6.png`、`orbit.png` | 备用装饰 |
| `assets/characters/*.webp` | 8 个 fox 角色插画（self / linyue / chenyu / suqing / limeng / zhaoyi / zhouming / newfriend） |

### 2. 对 7 个 HTML 的结构性改动（每页 4–5 处）

1. `<head>` 中在页面自带 `<style>` **之后**接入 `zhiyu-theme.css`
2. 内联 SVG favicon（纸底墨字「知」，消除默认 `/favicon.ico` 404）
3. 移除旧蓝色 webp logo 的 `<img>`（登录页有 2 处）
4. 侧栏底部注入木牌插画（登录页无侧栏，跳过）
5. `</body>` 前接入 `zhiyu-avatar.js`

**没有改动任何业务 JS、没有删改任何 class、没有移除任何控件。**

### 3. token 映射

| 旧 token | 旧值（冷调科技蓝） | 新值（暖调手绘纸感） |
|---|---|---|
| `--bg` | `#eef3fc` | `#f8f0df` |
| `--surface` | `#ffffff` | `#fff9eb` |
| `--fg` | `#16263f` | `#381508` |
| `--muted` | `#5d6c88` | `#8a6047` |
| `--border` | `#d7e1f1` | `rgba(83,42,23,.22)` |
| `--accent` | `#0d64fd` | **`#e2664f`（暖珊瑚）** |
| `--fg-soft` / `--fg-softer` | 由旧 `--fg` 派生 | **在覆盖层重新混合** |
| `--accent-soft` / `--accent-faint` | 由旧 `--accent` 派生 | **在覆盖层重新混合** |

新增：`--line`、`--line-soft`、`--shadow`、`--shadow-lg`、`--font-hand`、
`--r-hand`、`--r-hand-lg`、`--accent-deep`、`--accent-tint`、`--zhihu-blue`。

> **坑点 1**：`--fg-soft` / `--accent-soft` 这类 `color-mix()` 派生变量是在 `:root` 就地求值的，
> 只改 `--fg` / `--accent` 不会让它们跟着变。必须在覆盖层里按同样公式重新定义一次。
>
> **坑点 2**：旧 CSS 里还有一批**硬编码的蓝色渐变**（`#4f9dff → #2f7fe8` 等）绕过了 token，
> 换 token 不会覆盖它们。必须逐条替换成暖色渐变。

### 4. 品牌区：从 webp logo 到矢量 logo

旧 CSS 把 `.brand-word` 的可用宽度按 **42px 的 logo 尺寸**预留。logo 图一移除，`inline-flex` 里的「知遇」就被压成 42px 宽、两字换行、盒子撑高，看起来像个空框。

修法：`.brand-word { white-space: nowrap }`；`.brand-plate` 改为 52×52，内嵌
`assets/logo-zhiyu.svg`（手绘风重绘），右上角保留暖色 `✦` 点缀。

### 5. 雷达图（三种实现统一重绘）

旧前端有 **三套** 独立的雷达图实现，全部按新风格重绘：

| 实现 | 位置 | 处理 |
|---|---|---|
| `.modal-radar` | 发现页 / 通知页人格卡弹窗 | 暖珊瑚数据面 + 虚线外环 + 纸底顶点圆点 + 手写轴标签 |
| `.radar-wrap` | Agent 匹配页报告弹窗 | 同上（该处用内联属性绘制，靠 `polygon` 末位元素选中数据面） |
| `.pr-shell` | 人格页综合画像 | 同上；无数据时走 `pr-empty` 空态，只画网格/轴/标签 |

三者都叠加了 `rings.png` 环状底衬（`opacity: .18–.20`），视觉上和新前端的手绘感一致。

> 说明：字体 **不重定向** `--font-display`。旧 CSS 的 `h1/h2/品牌字/引文` 都引用它，
> 一旦重定向会让本应保持书卷气的标题也变手写体。手写体单独走 `--font-hand`，
> 只施加在品牌字与 UI 控件（按钮/页签/导航/标签/提示）上。

### 6. Agent 蒸馏面板的盒子内边距

主题层给列表容器加手绘边框时必须同时给内边距：

```css
.stage-list, .run-req {
  border: 1.6px solid var(--line-soft);
  padding: 12px 16px;          /* ← 不能省，否则内容贴边压线 */
}
```

**规则**：凡是被主题层选中加 `border` 的容器，必须确认它原本有 `padding`；
旧前端的 `.stage-list` / `.run-req` 都是 `padding: 0` 的纯列表。

---

## 三、验证结果

### 结构 + 主题验证（`RECON/verify-reskin.mjs`）

7 个页面 × 全部检查项，**7/7 通过**：

- 计算样式 `--bg` / `--accent`(=`#e2664f`) / `--fg` / `--muted` 均等于新 token
- 纸纹背景生效
- 无旧 webp logo 残留、无旧色值出现在**实际渲染色**中
- 侧栏 / 导航 / 卡片 / 弹窗 / 雷达容器 / 木牌结构齐全
- 角色头像全部上色（登录 4/4、首页 5/5、发现 11/11、Agent 9/9 …）
- 品牌 logo 加载成功（可见元素 `naturalWidth > 0`）
- 知乎登录按钮仍是品牌蓝 + 白字
- 暖化抽查：主按钮 / 选中导航 / 进度条 / 雷达图 / 未读标记均无冷蓝残留
- 列表盒「有边框必有内边距」
- **console 错误 0 / page error 0 / 资源失败 0**

### 功能回归验证（`RECON/test-interactions.mjs`）

**52 项全部通过，0 失败**：

| 页面 | 覆盖内容 |
|---|---|
| 发现页（20 项） | 三页签切换、省份→城市级联、浙江/杭州筛选、关键词搜索、只看接受 Agent 对话、重置、随机换一批、快速匹配（87%≥84%≥82% 降序）、人格卡弹窗、雷达图结构（4 环+5 轴+5 顶点+5 标签）、雷达图主色、环状底衬、弹窗数据填充、关闭、让 Agent 先聊聊 |
| 人格页（8 项） | 三页签、雷达图结构、虚线外环、环状底衬、六源卡片（6 卡 + 12 标记）、蒸馏 10 步、Agent 动画图 |
| Agent 匹配页（7 项） | 两页签、认识中列表、对话弹窗（7 条消息）、报告列表、五维雷达（4 网格+5 轴+5 顶点）、雷达填充/描边 == `rgb(52,140,255)` |
| 通知页（4 项） | 三分类（全部 4 / 对话完成 2 / 来报告 2）、全部已读、通知项弹窗 |
| 设置页（6 项） | 四分区、三开关、BYOK 13 个供应商、预设自动填 BaseURL、退出二次确认 |

### Kai 检查

旧前端**原本就不含 Kai 角色**。全库 21 处 `kai` 命中全部是字体名 `KaiTi`（楷体），
独立词 `\bKai\b` 出现 **0** 次。新前端的 Kai 内容未引入。

---

## 四、如何复现 / 回滚

```bash
# 预览（静态服务器，默认 4188 端口）
node RECON/serve-reskin.mjs
# 打开 http://127.0.0.1:4188/

# 重新注入主题（幂等，可反复运行）
node RECON/inject-theme.mjs

# 主题 + 结构验证（会输出 7 页整页截图到 RECON/reskin-verify/）
node RECON/verify-reskin.mjs

# 功能回归测试（52 项，含登录页与品牌色断言）
node RECON/test-interactions.mjs

# 定点复检（logo / 登录按钮 / 暖化 / 人格页合并 / 蒸馏内边距）+ 截图
node RECON/probe-fixes.mjs

# 与原版对比滚动显现行为
node RECON/compare-reveal.mjs
```

**回滚**：改造前的 7 个 HTML 原样备份在 `前端UI/_backup_zhiyu18_original/`。
把它覆盖回 `前端UI/知乎黑客松产品_知遇ZhiYu18/` 即可完全还原（主题层是独立文件，也可单独删掉 `zhiyu-theme.css` 与 `zhiyu-avatar.js` 两行引用）。

---

## 五、遗留与后续

1. **未做的事**：`zhiyu-web/`（Next.js 工程）本次未动。后续把主题迁进 React 时，
   `zhiyu-theme.css` 的 token 块可直接作为 `globals.css` 的 `:root`，
   组件类映射表（`.panel`→`hand-card` 等）已在主题层注释里标明。
2. **新前端的冗余控件未引入**：全局搜索栏（新前端 6 页都有，旧前端只在发现页有）、
   新设置页的 7 个开关（与产品方案四区冲突）均按你的要求丢弃。
3. **文字换行的取舍**：把 `--font-display` 恢复为原书卷气衬线体是一个**可以改回去的决定**。
   如果你更想要新前端那种"标题也手写"的张力，把 `--font-display: var(--font-hand)`
   加回 `:root:root` 即可，一行切换。
4. **冷蓝残留自查**：批量搜索 `#348cff` / `rgba(52, 140, 255` / `#4f9dff` / `#2f7fe8`
   / `#83c4ff` / `#1265cf` 可确认没有遗漏的蓝色。目前主题层内仅剩文档注释里的一处说明文字。
5. **`.run-req` 在移动端**：六源状态胶囊会换行，`flex-wrap` 已开，窄屏表现正常，
   但未做专门的手机端视觉走查。

---

## 六、本轮改造中"我的错"与"测试的错"

诚实记录，便于后续排查时少走弯路：

| 现象 | 真实原因 | 类别 |
|---|---|---|
| 「Agent 蒸馏」页签点不动<br>「去开始蒸馏」按钮不渲染 | 删除 `#ov-title` 导致 `paintOverview()` 抛 TypeError，**整页 JS 初始化中断** | **代码 bug（我的）** |
| logo 显示破图 | SVG 注释内含 `-----`，违反 XML「注释不得含连续两个短横线」 | **代码 bug（我的）** |
| 蒸馏面板文字压出边框 | 给 `padding: 0` 的纯列表加了边框却没给内边距 | **代码 bug（我的）** |
| 知乎登录按钮文字看不见 | 通用按钮覆盖丢失了文字色 | **代码 bug（我的）** |
| 登录页截图大片空白 | `fullPage` 截图未触发滚动显现动画 | 测试方法问题 |
| 3 处雷达图/页签断言失败 | 断言用了错误的选择器（页签靠 `data-tab` 而非 id） | 断言问题 |
| 改造前后滚动显现"不一致" | 测试脚本滚动过快，跑赢了 IntersectionObserver | 测试方法问题 |

> 教训一：**改动 JS 依赖的 DOM 前先 grep 引用**。
> 教训二：**断言要验证"渲染结果"而非"文件内容"**（`naturalWidth` 比字符串搜索可靠）。
> 教训三：本项目里**不要用 PowerShell 做文本替换**（`-replace` + `Set-Content` 会破坏
> 中文编码与文件结构），一律用编辑工具。

