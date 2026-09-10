// 真实 LLM（BYOK）版 Agent 对话与 Judge。
import type { ChatMessage } from "@/lib/llm/chat";
import {
  QUESTIONS,
  type DialoguePersona,
  type DialogueRound,
  type JudgeDimensions,
  type JudgeResult,
} from "./dialogue";

export interface LlmDialogueOptions {
  chat: (messages: ChatMessage[]) => Promise<string>;
}

function personaSystem(p: DialoguePersona): string {
  const sbti = ((p.personality ?? {}) as Record<string, unknown>).sbti as
    | { type?: string; typeTitle?: string }
    | undefined;
  const tag = sbti?.typeTitle ? `${sbti.typeTitle}（${sbti.type}）` : "未测人格";
  const interests = Array.isArray(p.interests)
    ? (p.interests as string[]).join("、")
    : "未提供";
  const topics = Array.isArray(p.topics)
    ? (p.topics as string[]).join("、")
    : "未提供";
  return (
    `你是「${p.displayName}」的人格 Agent，基于其人格数据回答，用第一人称，` +
    `回答 1~2 句话，口语化但克制。人格标签：${tag}；兴趣：${interests}；关注话题：${topics}。`
  );
}

function clamp01(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}

interface ParsedJudge extends JudgeDimensions {
  overall?: number;
  reasons: string[];
  summary: string;
}

function parseJudgeJson(raw: string): ParsedJudge {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("Judge 输出不是合法 JSON");
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  const reasons = Array.isArray(obj.reasons)
    ? obj.reasons.filter((x): x is string => typeof x === "string").slice(0, 6)
    : [];
  return {
    interest: clamp01(obj.interest),
    thinking: clamp01(obj.thinking),
    values: clamp01(obj.values),
    communication: clamp01(obj.communication),
    complementarity: clamp01(obj.complementarity),
    overall: clamp01(obj.overall),
    reasons,
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

export async function runLlmAgentDialogue(
  a: DialoguePersona,
  b: DialoguePersona,
  opts: LlmDialogueOptions,
): Promise<{ rounds: DialogueRound[]; judge: JudgeResult; demoMode: false }> {
  const rounds: DialogueRound[] = [];
  for (const q of QUESTIONS) {
    const aReply = await opts.chat([
      { role: "system", content: personaSystem(a) },
      { role: "user", content: q.text },
    ]);
    const bReply = await opts.chat([
      { role: "system", content: personaSystem(b) },
      { role: "user", content: q.text },
    ]);
    rounds.push({
      round: rounds.length + 1,
      dimension: q.dimension,
      question: q.text,
      aReply,
      bReply,
    });
  }

  const transcript = rounds
    .map(
      (r) =>
        `第${r.round}轮（${r.dimension}）问题：${r.question}\nA：${r.aReply}\nB：${r.bReply}`,
    )
    .join("\n\n");
  const judgeRaw = await opts.chat([
    {
      role: "system",
      content:
        "你是知遇的 Judge Agent，只输出一个 JSON 对象，不要输出其他文字。" +
        '字段：interest, thinking, values, communication, complementarity（0~1 浮点）、overall（0~1）、reasons（字符串数组，中文）、summary（一句中文总结）。',
    },
    { role: "user", content: transcript },
  ]);

  const parsed = parseJudgeJson(judgeRaw);
  const overall =
    parsed.overall ??
    (parsed.interest + parsed.thinking + parsed.values + parsed.communication + parsed.complementarity) /
      5;

  const dimensions: JudgeDimensions = {
    interest: parsed.interest,
    thinking: parsed.thinking,
    values: parsed.values,
    communication: parsed.communication,
    complementarity: parsed.complementarity,
  };

  return {
    rounds,
    judge: {
      overall,
      dimensions,
      summary: parsed.summary || `综合匹配度 ${Math.round(overall * 100)}%`,
      reasons: parsed.reasons.length > 0 ? parsed.reasons : ["LLM Judge 未给出具体理由"],
      demoMode: false,
    },
    demoMode: false,
  };
}
