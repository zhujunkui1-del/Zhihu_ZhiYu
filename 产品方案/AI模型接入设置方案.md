# AI 模型接入设置方案（BYOK 决策记录）

> 状态：已确认（2026-09-06），尚未开发。
> 功能位置：设置页（Profile → 用户设置）新增「AI 模型接入」模块。
> 定位：让用户自带第三方 LLM API Key（BYOK）；与平台级 `AI_API_KEY`（系统密钥）严格分离、互不影响。
> 关键决策（2026-09-06 确认）：API Key 采用**服务端加密入库**；设置页原型中的“仅保存在本地”仅为静态演示文案，不代表最终实现口径。
> 模型字段决策（2026-09-07 确认，对齐 Hiliu-Community 做法）：预设内置默认模型（可修改）；自定义配置的“模型名”同时作为请求的 `model` 参数。

## 1. 目标与原则

- 用户无需知道各供应商的接口地址，选择预设即可接入；也支持自定义供应商。
- 每个接入配置必须能独立验证“是否真的连得上”。
- 所有第三方调用（验证/后续使用）由 Next.js 服务端代理完成，浏览器不直连第三方 LLM、不持久化完整 Key。
- 不改变部署形态：仍为单体 Next.js 全栈 + PostgreSQL，部署在 Vercel，不新增任何 Vercel 之外的平台。

## 2. 界面结构（设置 → AI 模型接入）

```text
AI 模型接入
├── 已接入配置列表
│   每项显示：名称 / 供应商 / BaseURL（可折叠） / Key 掩码（…后 4 位） / 连接状态 / 最近延迟
│   操作：延迟测试 · 设为默认 · 编辑 · 删除
│
    └── 新增接入配置
    ├── 方式 A：预设供应商（下拉选择，共 12 个）
    │   选择后自动填入：供应商名称 + 默认 BaseURL + 默认模型（可修改）
    │   用户只需填写：API Key
    │
    └── 方式 B：自定义模型
        手动填写：模型名（作为展示名，同时作为请求的 model 参数）
                 + BaseURL
                 + API Key

两种方式均提供：
    [延迟测试] 按钮：用当前配置发起一次最小对话请求，校验“URL + Key + 模型”是否连通
```

## 3. 内置预设供应商（12 个）

供应商名称与自动填入的默认 BaseURL 如下（**默认值仅为开发期初始配置，上线前须逐项按各供应商官方文档校对，并集中维护在代码预设配置中，不散落写死在页面里**）：

| # | 预设供应商 | 默认 BaseURL（开发时校对） | 备注 |
|---|---|---|---|
| 1 | Zhipu（智谱） | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容 |
| 2 | Kimi（Moonshot） | `https://api.moonshot.cn/v1` | OpenAI 兼容 |
| 3 | DeepSeek | `https://api.deepseek.com` | OpenAI 兼容 |
| 4 | DouBao（豆包/火山方舟） | `https://ark.cn-beijing.volces.com/api/v3` | OpenAI 兼容 |
| 5 | MiniMax | `https://api.minimax.chat/v1` | 国际版地址不同，开发时确认 |
| 6 | Xiaomi MiMo | 待官方文档确认 | 开发时补充 |
| 7 | LongCat | 待官方文档确认 | 开发时补充 |
| 8 | Claude（Anthropic） | `https://api.anthropic.com/v1/` | 按官方 OpenAI 兼容接入说明实现 |
| 9 | OpenRouter | `https://openrouter.ai/api/v1` | OpenAI 兼容 |
| 10 | ChatGPT（OpenAI） | `https://api.openai.com/v1` | OpenAI 兼容 |
| 11 | Gemini（Google） | `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI 兼容端点 |
| 12 | Copilot | 待确认（按 GitHub Models / Copilot 官方 OpenAI 兼容端点） | 开发时确认 |

选择预设后：

- 供应商名称、BaseURL、默认模型自动填入，且**允许用户手动修改**（防止官方更新地址/模型后旧预设失效）。
- 预设的默认模型保证“只填 Key 即可发起对话”；默认模型清单与 BaseURL 一样在开发期逐项校对。

## 4. 自定义模型

- 字段：模型名、BaseURL、API Key。
- **模型名同时作为 Chat Completions 请求的 `model` 参数提交**（与预设默认模型的角色一致），并用于列表展示。
- 请求地址完全以 BaseURL 为准；模型名是否正确由延迟测试的实际对话请求验证。
- 与预设配置存同一张表，通过 `type: preset | custom` 区分。

## 5. 延迟测试按钮

### 触发位置

- 新增配置弹层/表单内：对“当前填写但尚未保存”的内容测试。
- 已接入配置列表：对“已保存”的配置重新测试。

### 行为要求

1. 点击后调用后端 Route Handler（建议 `POST /api/settings/llm/test`），由服务端代发请求，避免浏览器跨域与 Key 暴露。
2. 默认判定方式：用当前配置发起一次**最小 Chat Completions 请求**（携带 `model`：预设默认模型或自定义模型名，`max_tokens=1`），一次验证“URL + Key + model”三者连通，通过即代表该配置真实可用。
3. 若供应商对最小对话请求有额外限制（如必须走流式或禁止空内容），按其官方文档的连通性检查方式降级，例如回退 `GET {baseURL}/models` 仅校验 Key 与地址。
4. 超时上限建议 10 秒；请求失败不重试轰炸。
5. 结果展示：成功显示“连接成功 · 耗时 xx ms”；失败显示脱敏错误摘要（HTTP 状态/错误类别），**不得回显完整 API Key 或完整响应体**。
6. 测试通过即把配置标记为“已验证”；未测试或失败的配置允许保存，但状态显示“未验证/异常”，不阻断录入。

## 6. 存储与安全要点

- **传输**：API Key 仅经 HTTPS 从前端提交给服务端；完整 Key 不写入 localStorage、不进入 URL、不写日志。
- **存储**：配置存 PostgreSQL（如 `llm_provider_configs` 表，归属 user）；API Key 使用应用级加密密钥（如 AES-GCM）加密后存储，加密密钥来自 Vercel Environment Variables（例：`USER_LLM_KEY_ENC`），不落 Git。
- **回显**：所有读取接口只返回 Key 掩码（后 4 位），不返回密文或明文。
- **调用边界**：测试与后续模型调用均在服务端 Route Handler 内完成；系统级 `AI_API_KEY` 保持不变，仅服务 Vercel 环境变量，与本模块的用户 Key 互不混用。
- **删除**：删除配置即删除密文，用户可随时重新接入。

## 7. MVP 优先级与开放问题

### 优先级建议

- P1：设置页 UI（12 预设 + 自定义 + 延迟测试）+ 数据表与加密存储 + 测试 Route Handler。
- P2：把用户接入的模型接入 Agent / 蒸馏调用策略（默认模型选择、供应商切换、额度/失败回退）。

### 开放问题（开发前确认）

1. 已接入多个 Key 时，“默认供应商/模型”如何被 Agent 匹配、蒸馏等模块选用。
2. Copilot、Xiaomi MiMo、LongCat 的官方 OpenAI 兼容 BaseURL 与默认模型需在开发阶段从官方文档确认。
3. 是否需要用量/费用提示（本设定不含计费控制）。

## 8. 关联文档

- 页面位置见《前端页面框架.md》设置页。
- 与 v2.0 开发规范 §28.9 系统级环境变量不冲突；本模块为“用户级 LLM 配置”。
