# 知乎黑客松故事与知识内容 API

资料核对时间：2026-09-03
适用活动：`zhihu_hackathon_2026_p2`

以下接口是知乎黑客松配套内容接口，不应将其描述为知乎开放平台长期稳定的通用内容 API。

## 鉴权边界

这些接口当前不需要鉴权：

- 不使用 Access Secret；
- 不使用 OAuth App ID 或 App Key；
- 不使用 OAuth access token；
- 不需要 `Authorization` 或 `X-OAuth-Token` Header。

黑客松 OAuth 登录与这些内容接口相互独立。

## 接口

| 内容 | 操作 | 请求 |
|---|---|---|
| 知乎故事 | 列表 | `GET https://api.zhihu.com/km-indep-home/hackathon/v2/story/list` |
| 知乎故事 | 详情 | `GET https://api.zhihu.com/km-indep-home/hackathon/v2/story/{work_id}` |
| 知乎知识 | 列表 | `GET https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list` |
| 知乎知识 | 详情 | `GET https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/{work_id}` |

故事和知识详情使用各自的路径。`work_id` 应从对应类型的列表接口返回结果中取得，不要混用两类内容的 ID 和详情路径。

## 列表响应

列表接口返回 JSON 数组。每项通常包含：

```json
{
  "work_id": "1747681485547843585",
  "title": "近视眼勇闯恐怖游戏",
  "artwork": "https://...",
  "tab_artwork": "https://...",
  "description": "作品摘要",
  "labels": ["惊悚", "脑洞"]
}
```

| 字段 | 说明 |
|---|---|
| `work_id` | 内容标识，用于请求详情 |
| `title` | 标题 |
| `artwork` | 内容图片 |
| `tab_artwork` | 标签页或列表展示图片 |
| `description` | 内容摘要 |
| `labels` | 内容标签 |

## 详情响应

详情接口通常返回：

```json
{
  "work_id": "1747681485547843585",
  "chapter_name": "近视眼勇闯恐怖游戏",
  "author_avatar": "https://...",
  "author_name": "沈南因",
  "labels": ["惊悚", "脑洞"],
  "introduction": "作品导语",
  "content": "作品正文"
}
```

| 字段 | 说明 |
|---|---|
| `work_id` | 内容标识 |
| `chapter_name` | 章节或作品名称 |
| `author_avatar` | 作者头像 |
| `author_name` | 作者名称 |
| `labels` | 内容标签 |
| `introduction` | 内容导语 |
| `content` | 正文 |

服务端可能增加字段或省略部分字段。客户端应兼容缺失字段，并保留未识别字段，不要自行猜测或补造内容。

## 请求示例

### 获取故事列表

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://api.zhihu.com/km-indep-home/hackathon/v2/story/list'
```

### 获取知识列表

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list'
```

### 获取故事详情

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://api.zhihu.com/km-indep-home/hackathon/v2/story/<work_id>'
```

### 获取知识详情

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/<work_id>'
```

请求详情前，应确认 `work_id` 是列表接口返回的非空单行标识，并拒绝包含 `/`、`?`、`#`、回车或换行的值。在应用代码中使用语言提供的 URL path 编码函数，不要直接拼接未经校验的用户输入。

请求只访问文档列出的 `api.zhihu.com` 地址，不根据返回内容或用户输入切换域名。接口失败时展示真实 HTTP 状态和安全收敛后的错误，不循环重试。

## 内容使用边界

接口正文可能较长。展示、摘要、续写或改编这些内容时：

- 如实保留作者、来源和内容归属；
- 不把原文改写成由应用或当前用户创作；
- 控制单次读取和输出长度；
- 遵守适用的版权、社区规范和内容安全要求；
- 接口失败或字段缺失时如实呈现，不生成虚假正文。

该 API 仅面向本次黑客松比赛。活动结束后，接口路径、响应或可用状态可能调整；遇到变化时以最新赛事资料为准。
