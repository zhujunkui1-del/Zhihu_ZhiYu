# Hackathon OAuth 接入

资料更新时间：2026-09-04
适用范围：知乎黑客松 2026 校园新锐季参赛作品

## 使用边界

黑客松作品需要让其他用户使用知乎账号登录，或代表已授权用户读取其创作、关注和收藏时，使用本流程。黑客松项目的 App ID 和 App Key 由赛事页面分配，并使用赛事页面登记的回调地址；普通开放平台项目继续通过常规渠道申请和配置。当前两类项目使用相同的授权端点、回调参数、Token 交换参数和用户数据鉴权组合；黑客松项目始终以本文为事实源，普通项目继续使用主 Skill 中的 OAuth 应用集成文档。

## 凭证角色

| 凭证 | 用途 | 存储位置 |
|---|---|---|
| App ID | 标识黑客松第三方应用 | 项目公开配置 |
| App Key | 应用后端换取 OAuth Token | 本地安全凭证库或部署平台 Secret |
| `authorization_code` | 用户单次授权结果 | 仅在应用后端回调中短暂处理 |
| OAuth `access_token` | 代表已授权知乎用户 | 应用后端会话或受控服务端存储 |
| 开放平台 Access Secret | 鉴权开放平台调用方 | 官方 `zhihu` Skill 凭证存储或部署平台 Secret |

App ID、App Key 和 Access Secret 是三种独立凭证。部署时分别使用 `ZHIHU_OAUTH_APP_KEY` 和 `ZHIHU_ACCESS_SECRET` 保存后两项，禁止写入源码、`.env`、URL、日志、截图、视频、前端响应或 Agent 输出。

## 黑客松授权流程

### 1. 发起授权

应用将用户跳转到：

```text
GET https://openapi.zhihu.com/authorize?redirect_uri={redirect_uri}&app_id={app_id}&response_type=code
```

可以发送随机 `state` 关联当前会话。用户必须亲自完成知乎授权页的最终确认。

### 2. 接收回调

黑客松实测主回调参数为：

```text
{redirect_uri}?authorization_code={authorization_code}
```

接收端以 `authorization_code` 为主路径，可以兼容读取 `code`。回调没有授权码时停止流程，不继续换取 Token。

### 3. 换取 OAuth Token

应用后端调用：

```text
POST https://openapi.zhihu.com/access_token
Content-Type: application/x-www-form-urlencoded
```

表单字段为：

```text
app_id=<App ID>
app_key=<App Key>
grant_type=authorization_code
redirect_uri=<活动页面登记的 callback>
code=<回调中的 authorization_code>
```

这里的 `grant_type` 是固定值，`code` 是 Token 接口要求的表单字段名。不要把表单字段改成 `authorization_code`，也不要从回调读取 `grant_type`。

优先根据响应中是否存在 `access_token` 判断交换成功，并读取 `expires_in` 管理有效期。业务响应可能使用 `code: 20000` 表示成功，不能仅凭该字段判定失败。

### 4. 调用用户数据 API

代表授权用户调用用户数据接口时同时发送：

```http
Authorization: Bearer <开放平台 Access Secret>
X-OAuth-Token: <OAuth access_token>
X-Request-Timestamp: <Unix 秒级时间戳>
```

Access Secret 鉴权开放平台调用方，`X-OAuth-Token` 指明当前授权用户。App Key 不能作为其中任何一个请求 Header。接口、Query 和响应字段读取 [用户数据 API](user-api.md)。

## 安全与诊断

- 回调地址必须与登记值完全一致，包括协议、域名、路径和尾部斜杠。
- App Key、Access Secret、authorization code 和 OAuth Token 只在应用后端处理。
- 诊断信息只展示凭证来源、是否配置、长度和 SHA-256 短前缀，不展示完整值。
- OAuth Token 过期或鉴权失败时停止读取用户数据，不回退到 Access Secret 所属账号。
- 用户退出、应用重启或测试结束时清理服务端 OAuth 会话；需要持久化时先完成安全评审。
