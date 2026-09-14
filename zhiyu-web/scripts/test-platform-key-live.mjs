#!/usr/bin/env node
/**
 * 实测平台大模型 Key 现在能不能用。
 *
 * 为什么要单独测：`https://api.openai-next.com` 不带 `/v1` 时会返回一坨
 * HTTP 200 的网页 HTML（看起来"成功"但根本不是模型回复）—— 踩过这个坑。
 * 所以在正式批量蒸馏前，先用一次最小调用确认链路真的通。
 *
 * 用法：node --env-file=.env scripts/test-platform-key-live.mjs
 */
import { chatCompletion } from "../lib/llm/chat.ts";

const baseUrl = (process.env.AI_BASE_URL || "https://api.openai-next.com/v1").trim();
const apiKey = (process.env.AI_API_KEY || "").trim();
const models = [process.env.AI_MODEL || "gpt-4o-mini", "deepseek-chat", "gpt-4o", "glm-4"];

console.log("平台大模型连通性实测");
console.log("=".repeat(70));
console.log(`  baseUrl = ${baseUrl}`);
console.log(`  apiKey  = ${apiKey ? `${apiKey.slice(0, 6)}…(${apiKey.length} 字符)` : "(未配置)"}`);
console.log("");

if (!apiKey) {
  console.log("✗ 未配置 AI_API_KEY，无法测试");
  process.exit(1);
}

for (const model of models) {
  const t0 = Date.now();
  try {
    const reply = await chatCompletion(
      { baseUrl, apiKey, model },
      [{ role: "user", content: "只回复两个字：可用" }],
      { maxTokens: 16, timeoutMs: 40000 },
    );
    const ms = Date.now() - t0;
    /* 防"返回网页 HTML 却当作成功"：回复里出现 HTML 特征就判失败 */
    const looksLikeHtml = /<(!doctype|html|head|body|div)/i.test(reply);
    console.log(
      `${looksLikeHtml ? "✗" : "✓"} ${model.padEnd(16)} ${String(ms).padStart(6)}ms  回复=${JSON.stringify(reply.slice(0, 60))}${looksLikeHtml ? "  ← 像是网页 HTML，端点可能写错" : ""}`,
    );
  } catch (e) {
    console.log(`✗ ${model.padEnd(16)} 失败：${String(e.message).slice(0, 140)}`);
  }
}
