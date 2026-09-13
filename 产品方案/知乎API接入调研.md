# 知乎 API 接入调研记录

> 目的：把「哪些接口真的通了、哪些是混淆、踩过哪些坑」固定下来，
> 避免以后重复调研或误用二手资料。

---

## 一、知乎一共有三套 API，别混

这是最容易出错的地方——它们**域名不同、鉴权方式不同、用途也不同**。

| | ① OAuth API | ② 用户数据 API | ③ 社区 API |
|---|---|---|---|
| **Base URL** | `openapi.zhihu.com` | `developer.zhihu.com` | `openapi.zhihu.com` |
| **路径前缀** | `/authorize` `/access_token` `/user` … | `/api/v1/user/…` | `/openapi/…` |
| **鉴权** | `Authorization: Bearer <access_token>` | `Authorization: Bearer <Access Secret>`（+ 可选 `X-OAuth-Token`） | **HMAC-SHA256 签名**（5 个自定义头） |
| **用途** | 用户登录、读公开资料与社交关系 | 读用户自己的创作/关注/收藏 | 发帖、评论、点赞、圈子内容 |
| **本项目状态** | ✅ 代码完成 | ✅ **已跑通** | ✅ 签名与读接口已跑通 |

---

## 二、OAuth API（①）

### 流程

```
① GET  openapi.zhihu.com/authorize?redirect_uri=…&app_id=…&response_type=code&state=…
② 用户授权 → 回调 {redirect_uri}?authorization_code=…
③ POST openapi.zhihu.com/access_token   表单：app_id / app_key / grant_type=authorization_code / redirect_uri / code
④ GET  openapi.zhihu.com/user           Authorization: Bearer {access_token}
```

### 实测要点（都是容易写错的地方）

1. **回调参数是 `authorization_code`**，不是标准 OAuth 的 `code`；
   但换 token 的表单字段**仍然是 `code`**。两者不一致，必须都兼容。
2. **成功判定看 `access_token` 是否存在**，不要把业务码 `20000` 当失败。
3. **`expires_in` 默认是 2592000 秒（30 天）**。快速开始的示例写的是 3600 秒，
   而 OAuth Skill 那页写的是 30 天——以实际返回值为准，不要写死。
4. **`uid` 是 18~19 位十进制数，超过 JavaScript 安全整数范围**。
   直接 `JSON.parse` 会**静默舍入**：

   ```
   字面量 904491330657081871 → JSON.parse 读出 904491330657081900
   字面量 1234567890123456789 → JSON.parse 读出 1234567890123456800
   ```

   **没有任何报错，只是值变了。** 必须先做文本预处理再 parse。
5. 头像字段是 **`avatar_path`**（不是 `avatar_url`）。
6. `email` / `phone_no` 无权限时返回**空字符串**，不是缺字段。
7. **不能只看 HTTP 状态码**：用户不存在时是 `200 + {"code":404,"data":"User don't exist"}`。
8. `state` 的回传**两份文档说法不一**：通用 OAuth 文档（含实测记录）说不回传，
   黑客松文档说已支持透传。实现上取「**回传就严格校验、没回传不阻断并记日志**」，
   避免在确实不返 state 的环境里无法登录。

### 社交关系接口

`/user/followers`（粉丝）、`/user/followed`（关注）、`/user/moments`（关注动态），
分页参数 `page`（从 0 开始）/ `per_page`。

---

## 三、用户数据 API（②）—— 本项目已接入

Base URL `developer.zhihu.com`，路径前缀 `/api/v1/`。

### 双凭证模型（关键）

| 场景 | `Authorization` | `X-OAuth-Token` | 返回 |
|---|---|---|---|
| **当前调用方本人** | Access Secret | **不传** | Access Secret 所属账号的公开数据 |
| 第三方应用中的授权用户 | Access Secret | 传该用户的 OAuth token | 该授权用户的数据 |

**这条很重要**：意味着**不需要等 OAuth 打通，用 Access Secret 就能读自己的数据**。
本项目就是靠这一点在拿到凭证当天就跑通了五个接口。

### 五个接口（均已实测跑通）

| 接口 | 说明 |
|---|---|
| `GET /api/v1/user/contents` | 创作（回答/文章/视频/想法/问题） |
| `GET /api/v1/user/followees` | 关注的人 |
| `GET /api/v1/user/favlists` | 收藏夹列表 |
| `GET /api/v1/user/favlist_contents` | 收藏夹内容（需第一条收藏夹的 `UrlToken`） |
| `GET /api/v1/user/collections` | 近期收藏 |

**公共请求头**：`Authorization` + `X-Request-Timestamp`（秒级）。
**分页**：`Offset` + `Limit`，响应带 `Paging.NextOffset`。

### 实测结果

```
① 用户创作   1 条   [pin] 🧠 知遇ZhiYu｜在你认识一个人之前，让 Agent 先认识 TA
② 用户关注   2 条   知乎产品情报局 / 知乎日报
③ 收藏夹     1 个   我的收藏
④ 收藏内容   1 条
⑤ 近期收藏   1 条
```

---

## 四、社区 API（③）

Base URL `openapi.zhihu.com`，**路径前缀是 `/openapi/`**。

### 鉴权：HMAC-SHA256 签名（与 OAuth 完全无关）

凭证是另一套：

- `app_key` = **用户 token**（个人主页链接 `people/` 后面那串）
- `app_secret` = 应用密钥，申请地址 `https://www.zhihu.com/ring/moltbook`

签名算法：

```
待签名字符串：app_key:{app_key}|ts:{timestamp}|logid:{log_id}|extra_info:{extra_info}
HMAC-SHA256（密钥 app_secret）→ Base64
```

五个必需请求头：

| 头 | 说明 |
|---|---|
| `X-App-Key` | 用户 token |
| `X-Timestamp` | 秒级时间戳 |
| `X-Log-Id` | 请求唯一标识 |
| `X-Sign` | 上述签名 |
| `X-Extra-Info` | 可为空，但**必须存在**，且要与待签名字符串里的一致 |

统一响应格式 `{ status, msg, data }`，`status: 0` 成功、`1` 失败；
鉴权失败返回 `401` + `{ error: { code: 101, name: "AuthenticationError" } }`。
全局限流 **10 QPS**，超限 `429`。

### 接口清单（均已实测）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/openapi/ring/detail` | 圈子详情 + 内容列表 |
| POST | `/openapi/publish/pin` | 发布想法 ⚠️ **每小时最多 5 条** |
| GET | `/openapi/comment/list` | 评论列表（`content_type`: `pin` \| `comment`） |
| POST | `/openapi/comment/create` | 创建评论 ⚠️ **每小时每个想法最多 20 条** |
| POST | `/openapi/comment/delete` | 删除自己的评论（不能删他人） |
| POST | `/openapi/reaction` | 点赞 / 取消点赞 |
| GET | `/openapi/hackathon_story/list` | 故事概要列表（黑客松专项） |
| GET | `/openapi/hackathon_story/detail` | 故事详情（正文最多 3000 字） |

**三个可用圈子**：

| 圈子 ID | 名称 |
|---|---|
| `2001009660925334090` | OpenClaw 人类观察员 |
| `2015023739549529606` | A2A for Reconnect |
| `2029619126742656657` | 黑客松脑洞补给站 |

### 实测到的三个细节

1. **`like_num` 字段实测返回 `undefined`**（文档写的是 `like_num`，
   圈子详情里首条的点赞数取不到）。代码里同时接受 `like_num` / `like_count` 并归一为 0。
2. **评论列表对某些 pin 返回 `pin not bound to any ring`** —— 这是文档「常见错误」
   里列出的情形，属正常业务错误，不是调用方写错。
3. **`hackathon_story` 是「会员小说」内容库**，属 AI 创作类资源，
   与我们这个社交匹配赛道关系不大。

### ⚠️ 发布功能的硬约束

文档开头是 `[!WARNING]`：**禁止批量、高频、无意义地发布内容**，
违规会被**立即或永久收回 app_key**、**封禁开发者及关联账号**。

### 本项目为什么没有做「发帖到圈子」

曾经实现过（发布接口 + 节流），后来**主动删除**。原因：

1. **与产品核心动作不一致**——知遇的核心是 Agent 对 Agent 的**私密**对话，
   而往圈子发帖是公开广播，方向相反。
2. **与隐私设计冲突**——匹配报告含五维分数、推荐理由、双方人格细节，
   我们连「展示相似度」都给用户一个开关，却把报告公开发到社区是说不过去的。
3. **破坏「具体的一对一」前提**——报告是「TA × 你」的私密结论，
   公开发出去就变成了内容运营素材。
4. **没有需求驱动**——加它只是因为 API 恰好有这个能力。

**结论：「能用」不等于「该用」。** 读接口（圈子详情、评论列表）保留，
将来若要做「发现页展示知乎圈子里的同好」可以直接用；写接口不接。

---

## 五、一次典型的误判记录（留作教训）

曾经收到一份二手资料，声称社区 API 是：

```
Base URL: https://www.moltbook.com/api/v1
鉴权: Authorization: Bearer YOUR_API_KEY
端点: POST /api/v1/agents/register、GET /api/v1/posts、POST /api/v1/posts/{id}/comments …
```

**这份资料是错的**，三条独立证据：

1. **归属错误**：它描述的是 **Moltbook** —— 一个**独立的第三方** agent 社交网络
   （`api.moltbook.com`），与知乎毫无关系。知乎社区 API 的 Base URL 是
   `openapi.zhihu.com`，鉴权是 HMAC 签名而非 `Bearer`。
   知乎内部代号 `ring/moltbook` 只是**撞名**。
2. **端点在知乎上不存在**：实测 `/api/v1/agents/me` 等路径在 `openapi.zhihu.com`
   上全部返回 HTML 404。
3. **域名不可达（DNS 污染）**：

   ```
   moltbook.com       199.16.156.39     ← Twitter 的 IP 段
   www.moltbook.com   69.171.229.11     ← Facebook 的 IP 段
   api.moltbook.com   108.160.170.43    ← Dropbox 的 IP 段
   IPv6               2a03:2880:f10c:83:face:b00c:0:25de   ← 注意 face:b00c

   对照（真实可用）：
   openapi.zhihu.com     182.61.194.10
   developer.zhihu.com   43.242.197.211
   ```

   一个域名解析到三个不相干的网段 + IPv6 含 `face:b00c`，是 DNS 污染的典型特征，
   TCP 完全连不通。

**教训**：二手资料要先做归属核对（域名 + 鉴权方式是否自洽），
再用**一个必然失败的对照**（例如故意写错签名）判断服务端的真实行为，
而不是靠猜路径。
