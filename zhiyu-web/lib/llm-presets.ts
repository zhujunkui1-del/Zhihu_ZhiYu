/**
 * BYOK 大模型供应商预设。
 *
 * 依据：`产品方案/AI模型接入设置方案.md` 的预设表，以及原型
 * `前端UI/…/zhiyu-settings.html` 的 AI_PRESETS。
 *
 * 预设只负责「自动填好名称与接入地址」，Key 一律由用户自己粘贴、
 * 服务端加密入库（见 lib/crypto.ts）。**这里不内置任何 Key。**
 */

export interface LlmPreset {
  id: string;
  name: string;
  /** 副标题：所属公司 / 系列 */
  sub: string;
  /** OpenAI 兼容的 Base URL */
  base: string;
  /** 该预设的默认模型名（留空表示需用户填） */
  defaultModel?: string;
  /** 标注需要注意的地方（例如端点非标准 OpenAI 兼容） */
  note?: string;
}

export const LLM_PRESETS: LlmPreset[] = [
  { id: "zhipu", name: "智谱 AI", sub: "GLM", base: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-plus" },
  { id: "kimi", name: "Kimi", sub: "月之暗面", base: "https://api.moonshot.cn/v1", defaultModel: "moonshot-v1-8k" },
  { id: "deepseek", name: "DeepSeek", sub: "DeepSeek", base: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "doubao", name: "豆包", sub: "火山方舟", base: "https://ark.cn-beijing.volces.com/api/v3", note: "模型名需填方舟的推理接入点 ID（ep-…）" },
  { id: "minimax", name: "MiniMax", sub: "MiniMax", base: "https://api.minimaxi.com/v1", note: "国内版与国际版地址不同" },
  { id: "mimo", name: "小米 MiMo", sub: "Xiaomi", base: "https://api.xiaomimimo.com/v1", note: "地址以官方文档为准" },
  { id: "longcat", name: "LongCat", sub: "LongCat", base: "https://api.longcat.chat/openai" },
  { id: "claude", name: "Claude", sub: "Anthropic", base: "https://api.anthropic.com", note: "原生协议与 OpenAI 兼容格式不同，需确认代理层" },
  { id: "openrouter", name: "OpenRouter", sub: "OpenRouter", base: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
  { id: "chatgpt", name: "ChatGPT", sub: "OpenAI", base: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { id: "gemini", name: "Gemini", sub: "Google", base: "https://generativelanguage.googleapis.com/v1beta/openai", note: "走 Google 的 OpenAI 兼容端点" },
  { id: "copilot", name: "Copilot", sub: "GitHub", base: "https://api.githubcopilot.com", note: "端点非标准 OpenAI 兼容，可能需额外鉴权头" },
];

export function presetById(id: string): LlmPreset | undefined {
  return LLM_PRESETS.find((p) => p.id === id);
}
