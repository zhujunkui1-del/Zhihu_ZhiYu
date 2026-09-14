/**
 * 人格蒸馏：把「多源证据」融成结构化的 Persona。
 *
 * 在这之前，「Agent 蒸馏」只是界面展示 —— 点按钮没反应，因为后端不存在。
 * 本模块把它补上。
 *
 * 核心设计：**证据先行，LLM 只做归纳**
 *   1. 先把六源里**实际拿到的东西**整理成一份「证据包」（纯数据，可读、可核）
 *   2. 让 LLM 只做一件事：从这份证据包里**归纳**出人格字段
 *   3. 每条归纳都要能指回证据（`groundedIn`），写入 PersonaEvidence 供追溯
 *
 * 为什么不让 LLM 自由发挥：那会产生"看起来很懂我"但无法验证的标签。
 * 产品承诺的是**可解释**——用户能问"你凭什么这么认为"。
 *
 * LLM 不可用时**回退到规则蒸馏**，并如实标注 `method`，
 * 不让规则结果冒充 LLM 归纳（和 Agent 报告里的 `demoMode` 同一原则）。
 */

import { prisma } from "@/lib/db";
import { chatCompletion, type ChatMessage } from "@/lib/llm/chat";
import { encryptionStatus } from "@/lib/crypto-box";

export interface EvidenceItem {
  /** 来源类型：zhihu / sbti / wechat / qq / feishu / dingtalk */
  source: string;
  /** 人类可读的来源标签 */
  sourceLabel: string;
  /** 这条证据是什么 */
  kind: "content" | "profile" | "test" | "tag";
  text: string;
  /** 可点的原文链接（若有） */
  url?: string | null;
  /** 互动量等量化信息 */
  weight?: number;
}

export interface DistilledPersona {
  bio: string;
  interests: string[];
  topics: string[];
  communicationStyle: string[];
  values: Record<string, number>;
  /** 一句话画像 */
  summary: string;
  /** 每个结论指向哪些证据（可解释性） */
  groundedIn: { claim: string; from: string[] }[];
}

export interface DistillResult {
  ok: boolean;
  /** llm = 真 LLM 归纳；rules = 确定性规则兜底 */
  method: "llm" | "rules";
  /** 用了哪些源（实际有数据的那些） */
  usedSources: string[];
  /** 证据包里有几条 */
  evidenceCount: number;
  distilled: DistilledPersona;
  /** LLM 失败原因（method=rules 时说明为何回退） */
  llmError?: string;
  /** 写入的证据条数 */
  written: number;
}

/** 源类型 → 展示名（与产品文案一致） */
const SOURCE_LABELS: Record<string, string> = {
  zhihu: "知乎 · 公共表达",
  sbti: "SBTI · 显性人格",
  wechat: "微信 · 生活私域",
  qq: "QQ · 生活私域",
  feishu: "飞书 · 职场人格",
  dingtalk: "钉钉 · 职场人格",
};

/** 六维价值观的默认值（证据不足时用中位，不编造倾向） */
const NEUTRAL_VALUES = {
  career: 0.5,
  social: 0.5,
  autonomy: 0.5,
  creation: 0.5,
  learning: 0.5,
  stability: 0.5,
};

/**
 * 收集证据包。
 *
 * 只收集**库里真实存在**的东西，缺的源就不出现——
 * 这样蒸馏结果能诚实反映"我们到底知道多少"。
 */
export async function collectEvidence(personaId: string): Promise<{
  items: EvidenceItem[];
  usedSources: string[];
  persona: {
    displayName: string;
    interests: string[];
    topics: string[];
    communicationStyle: string[];
    values: Record<string, number> | null;
    sbti: { type?: string; typeTitle?: string; codes?: string; dimensions?: Record<string, number> } | null;
  } | null;
}> {
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    include: { sources: true, evidence: true },
  });
  if (!persona) return { items: [], usedSources: [], persona: null };

  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const asRec = (v: unknown): Record<string, number> | null =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : null;

  const sbti = ((persona.personality ?? {}) as Record<string, unknown>).sbti as
    | { type?: string; typeTitle?: string; codes?: string; dimensions?: Record<string, number> }
    | undefined;

  const items: EvidenceItem[] = [];
  const used = new Set<string>();

  /* ① 知乎：证据表里已落库的原文（由「连接知乎并同步」写入） */
  for (const e of persona.evidence) {
    const label = SOURCE_LABELS[e.source] ?? e.source;
    used.add(e.source);
    /* 只截断不丢字段：note 可能很长 */
    const note = (e.note ?? "").trim();
    if (!note) continue;
    items.push({
      source: e.source,
      sourceLabel: label,
      kind: "content",
      text: note.slice(0, 160),
      url: e.url,
      weight: typeof e.value === "number" ? e.value : undefined,
    });
  }

  /* ② 已注入的源（哪怕没有逐条证据，也说明"这个源参与过"） */
  for (const s of persona.sources) {
    if (s.status !== "injected") continue;
    used.add(s.type);
    const label = SOURCE_LABELS[s.type] ?? s.type;
    const meta = (s.meta ?? {}) as Record<string, unknown>;
    const bits: string[] = [];
    for (const [k, v] of Object.entries(meta)) {
      if (typeof v === "number" && v > 0) bits.push(`${k} ${v} 条`);
    }
    items.push({
      source: s.type,
      sourceLabel: label,
      kind: "profile",
      text: `已注入${bits.length ? `（${bits.join("，")}）` : ""}`,
      url: null,
    });
  }

  /* ③ SBTI 测试结果：这是用户**主动告知**的人格，权重很高 */
  if (sbti?.type || sbti?.typeTitle) {
    used.add("sbti");
    items.push({
      source: "sbti",
      sourceLabel: SOURCE_LABELS.sbti,
      kind: "test",
      text: `人格类型：${sbti.typeTitle ?? sbti.type}${sbti.codes ? `（${sbti.codes}）` : ""}`,
      url: null,
    });
  }

  /* ④ 已有标签也算证据（用户自己填的或上次蒸馏留下的） */
  const interests = asArr(persona.interests);
  const topics = asArr(persona.topics);
  const comm = asArr(persona.communicationStyle);
  if (interests.length) {
    used.add("profile");
    items.push({
      source: "profile",
      sourceLabel: "已有标签",
      kind: "tag",
      text: `兴趣：${interests.slice(0, 20).join("、")}`,
      url: null,
    });
  }
  if (topics.length) {
    items.push({
      source: "profile",
      sourceLabel: "已有标签",
      kind: "tag",
      text: `话题：${topics.slice(0, 20).join("、")}`,
      url: null,
    });
  }
  if (comm.length) {
    items.push({
      source: "profile",
      sourceLabel: "已有标签",
      kind: "tag",
      text: `沟通风格：${comm.slice(0, 20).join("、")}`,
      url: null,
    });
  }

  return {
    items,
    usedSources: [...used],
    persona: {
      displayName: persona.displayName,
      interests,
      topics,
      communicationStyle: comm,
      values: asRec(persona.values),
      sbti: sbti ?? null,
    },
  };
}

/** 组装给 LLM 的提示词。要求**只依据证据**，并给出溯源。 */
function buildMessages(evidence: EvidenceItem[], displayName: string): ChatMessage[] {
  const pack = evidence
    .map((e, i) => `[${i + 1}] (${e.sourceLabel}${e.weight ? ` · 热度${e.weight}` : ""}) ${e.text}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "你是人格蒸馏引擎。你的唯一任务：**根据给定的证据**归纳出这个人的结构化人格画像。\n" +
        "铁律：\n" +
        "1. 只能依据证据里出现过的信息，不得凭空补充、不得脑补经历。\n" +
        "2. 证据不足以判断某维度时，给中性值 0.5，并在 summary 里说明哪一块信息不足。\n" +
        "3. 每个结论都要能指回证据编号。\n" +
        "输出**严格 JSON**（不要 markdown 代码块），字段：\n" +
        "{\n" +
        '  "bio": "一句话身份描述（20字内，基于证据）",\n' +
        '  "interests": ["兴趣领域", "…"],        // 3~8 个，须来自证据\n' +
        '  "topics": ["常聊话题", "…"],            // 2~6 个\n' +
        '  "communicationStyle": ["表达习惯", "…"], // 2~6 个\n' +
        '  "values": {"career":0~1,"social":0~1,"autonomy":0~1,"creation":0~1,"learning":0~1,"stability":0~1},\n' +
        '  "summary": "两三句总述，必须点明信息不足之处",\n' +
        '  "groundedIn": [{"claim":"某个结论","from":[证据编号]}, …]\n' +
        "}",
    },
    {
      role: "user",
      content: `要蒸馏的人是「${displayName}」。\n\n证据包（共 ${evidence.length} 条）：\n${pack}`,
    },
  ];
}

const clamp01 = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
};
const strArr = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
    : [];

/** 解析 LLM 输出；字段缺失就补安全默认值，不整体失败 */
function parseDistilled(raw: string): DistilledPersona {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? raw).match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("蒸馏输出不是合法 JSON");
  const o = JSON.parse(candidate) as Record<string, unknown>;
  const v = (o.values ?? {}) as Record<string, unknown>;

  return {
    bio: typeof o.bio === "string" ? o.bio.slice(0, 60) : "",
    interests: strArr(o.interests, 10),
    topics: strArr(o.topics, 8),
    communicationStyle: strArr(o.communicationStyle, 8),
    values: {
      career: clamp01(v.career),
      social: clamp01(v.social),
      autonomy: clamp01(v.autonomy),
      creation: clamp01(v.creation),
      learning: clamp01(v.learning),
      stability: clamp01(v.stability),
    },
    summary: typeof o.summary === "string" ? o.summary.slice(0, 400) : "",
    groundedIn: Array.isArray(o.groundedIn)
      ? o.groundedIn
          .map((x) => {
            const g = (x ?? {}) as Record<string, unknown>;
            return {
              claim: typeof g.claim === "string" ? g.claim.slice(0, 80) : "",
              from: Array.isArray(g.from) ? g.from.map((n) => String(n)).slice(0, 6) : [],
            };
          })
          .filter((g) => g.claim)
          .slice(0, 12)
      : [],
  };
}

/**
 * 规则兜底蒸馏：证据不足或 LLM 不可用时使用。
 *
 * 刻意做得很简单——它只做"统计与归并"，不做任何推断。
 * 这样它给出的东西一定是证据里有的，不会编。
 */
function distillByRules(evidence: EvidenceItem[], displayName: string): DistilledPersona {
  const tagText = evidence
    .filter((e) => e.kind === "tag")
    .map((e) => e.text.replace(/^(兴趣|话题|沟通风格)：/, ""))
    .join("、");
  const interests = [...new Set(tagText.split(/[、,，]/).map((s) => s.trim()).filter(Boolean))].slice(0, 8);

  const testItem = evidence.find((e) => e.kind === "test");
  return {
    bio: `${displayName}（由已有标签归并）`,
    interests,
    topics: interests.slice(0, 4),
    communicationStyle: [],
    values: { ...NEUTRAL_VALUES },
    summary:
      `本次未调用大模型，仅把已有标签做了归并（${evidence.length} 条证据）。` +
      (testItem ? `包含 ${testItem.text}。` : "") +
      "要得到更完整的画像，需要接入大模型或补充更多数据源。",
    groundedIn: [],
  };
}

/**
 * 执行蒸馏。
 *
 * @param personaId 目标人格
 * @param provider  指定用哪个模型；不传则用平台 AI_API_KEY
 */
export async function distillPersona(
  personaId: string,
  provider?: { baseUrl: string; apiKey: string; model: string },
): Promise<DistillResult> {
  const { items, usedSources, persona } = await collectEvidence(personaId);
  if (!persona) throw new Error("Persona 不存在");

  const displayName = persona.displayName;

  /* 证据太少时**直接拒绝**，而不是硬蒸出一个空壳。
     这是产品诚实性的一部分：没有数据就说没有数据。 */
  if (items.length === 0) {
    return {
      ok: false,
      method: "rules",
      usedSources: [],
      evidenceCount: 0,
      distilled: distillByRules([], displayName),
      llmError: "没有任何证据——请先注入至少一个数据源",
      written: 0,
    };
  }

  /* 选择模型：优先调用方指定（BYOK），否则用平台 AI_API_KEY */
  const platform = {
    baseUrl: process.env.AI_BASE_URL || "https://api.openai-next.com",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL || "gpt-4o-mini",
  };
  const chosen = provider ?? platform;

  let distilled: DistilledPersona | null = null;
  let method: "llm" | "rules" = "rules";
  let llmError: string | undefined;

  if (!chosen.apiKey) {
    llmError = "未配置大模型 API Key（平台 AI_API_KEY 或用户 BYOK）";
  } else {
    try {
      const raw = await chatCompletion(chosen, buildMessages(items, displayName), {
        maxTokens: 1200,
        timeoutMs: 45000,
      });
      distilled = parseDistilled(raw);
      method = "llm";
    } catch (e) {
      llmError = (e as Error).message.slice(0, 200);
    }
  }

  if (!distilled) distilled = distillByRules(items, displayName);

  /* 写入：字段合并（不覆盖已有标签，蒸馏是"补充"而非"替换"） */
  const merged = {
    interests: [...new Set([...persona.interests, ...distilled.interests])].slice(0, 40),
    topics: [...new Set([...persona.topics, ...distilled.topics])].slice(0, 40),
    communicationStyle: [
      ...new Set([...persona.communicationStyle, ...distilled.communicationStyle]),
    ].slice(0, 20),
  };

  let written = 0;
  await prisma.$transaction(async (tx) => {
    await tx.persona.update({
      where: { id: personaId },
      data: {
        bio: persona.interests.length === 0 && distilled.bio ? distilled.bio : undefined,
        interests: merged.interests,
        topics: merged.topics,
        communicationStyle: merged.communicationStyle,
        /* 有 LLM 归纳时才用它的 values；规则兜底是中位值，写进去等于撒谎 */
        values: method === "llm" ? distilled.values : undefined,
        confidence: {
          method: method === "llm" ? "llm-distill" : "rule-distill",
          distilledAt: new Date().toISOString(),
          evidenceCount: items.length,
          usedSources,
          summary: distilled.summary,
          groundedIn: distilled.groundedIn,
          llmError: llmError ?? null,
        } as never,
      },
    });

    /* 溯源：把这次的归纳作为证据存下来 */
    if (distilled.summary) {
      await tx.personaEvidence.create({
        data: {
          personaId,
          source: "distill",
          trait: method,
          value: items.length,
          note: distilled.summary.slice(0, 500),
          url: null,
        },
      });
      written += 1;
    }
  });

  return {
    ok: true,
    method,
    usedSources,
    evidenceCount: items.length,
    distilled,
    llmError,
    written,
  };
}

/** 蒸馏是否具备条件（给页面做前置提示） */
export function distillReadiness(): {
  platformLlm: boolean;
  encryption: { ok: boolean; missing: string[] };
} {
  return {
    platformLlm: Boolean((process.env.AI_API_KEY ?? "").trim()),
    encryption: encryptionStatus(),
  };
}
