// OpenAI 兼容 Chat Completions 客户端（用于 BYOK 真实对话）

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProviderInput {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function chatCompletion(
  provider: LlmProviderInput,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<string> {
  const base = provider.baseUrl.trim().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        max_tokens: opts.maxTokens ?? 256,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`LLM 请求失败 HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM 返回内容为空");
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}
