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
import { redactText } from "@/lib/privacy/redact";
import { encryptionStatus } from "@/lib/crypto-box";
import {
  facetFromContents,
  isObservedSource,
  PERSONA_TYPES,
} from "@/lib/persona/fusion";
import { persistSourceFacet } from "@/lib/persona/source-facets";
import { facetOptionsFor, isContentFacetSource } from "@/lib/persona/facet-opts";

export interface EvidenceItem {
  /** 来源类型：zhihu / sbti / wechat / qq / feishu / dingtalk */
  source: string;
  /** 人类可读的来源标签 */
  sourceLabel: string;
  /**
   * 这条证据是什么。
   * `marker` = 「已注入 N 条」这类**源标记**：它说明"这个源参与过"，
   * 但**不是内容**，因此不能进分源解析的 itemCount（否则条数会虚高一条）。
   */
  kind: "content" | "profile" | "test" | "tag" | "marker";
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
  /**
   * 价值观六维。
   *
   * ⚠️ **不再作为"综合画像"的来源**（用户已确认的方针：六维只保留在
   * SBTI 自评那一侧）。这里仍然解析，是为了兼容历史数据与规则兜底
   * （`NEUTRAL_VALUES`），但**不再写进 `Persona.values`** —— 让 LLM
   * 拍六个 0~1 的数字正是"数据太假"的来源之一（实测它给出 100%/50% 这种整档值）。
   */
  values: Record<string, number>;
  /**
   * LLM 判定的**人格倾向型**（六型之一；判定不了就是 null = 暂不判定）。
   *
   * 为什么改由 LLM 判：原来用"归一化欧氏距离"算六型相似度，
   * 实测第一名与第二名只差 **0.016 个百分点**（79.2109% vs 79.1949%），
   * 把 career 从 0.5 挪到 0.6 就直接换型 —— 那不是判定，是抛硬币。
   * 现在让模型读懂证据后给结论，并**必须带原话依据**（`typeEvidence`）。
   */
  type: (typeof PERSONA_TYPES)[number] | null;
  /** 判定依据（1~2 句，须引用证据原话） */
  typeEvidence: string;
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
  /**
   * 外发前的脱敏结果。
   * `total > 0` 时界面必须如实告诉用户"有 N 处敏感信息被替换后才交给模型"。
   */
  privacy: { hits: { rule: string; count: number }[]; total: number };
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
    /** personality JSON 列（判型结果与依据就写在里面） */
    personality: Record<string, unknown> | null;
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
      /* ⚠️ 这类"已注入 X 条"是**源标记**，不是内容。
         它只该出现在给 LLM 的证据包里；分源解析必须把它排除，
         否则 itemCount 会多算一条（实测：微信显示 201 条而实际 200）。 */
      kind: "marker",
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
      personality: (persona.personality ?? null) as Record<string, unknown> | null,
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
        "2. 证据不足以判断的字段，如实留空或写「证据不足」，**不要给一个凑出来的数字**。\n" +
        "3. 每个结论都要能指回证据编号。\n" +
        "4. 不做诊断、不做道德评判。\n" +
        "输出**严格 JSON**（不要 markdown 代码块），字段：\n" +
        "{\n" +
        '  "bio": "一句话身份描述（20字内，基于证据）",\n' +
        '  "interests": ["兴趣领域", "…"],        // 3~8 个，须来自证据\n' +
        '  "topics": ["常聊话题", "…"],            // 2~6 个\n' +
        '  "communicationStyle": ["表达习惯", "…"], // 2~6 个\n' +
        '  "type": "深度思考型|好奇探索型|温和共情型|理性辩手型|体验派|务实执行型",\n' +
        '  "typeEvidence": "为什么判成这一型：1~2 句，必须引用证据里的原话",\n' +
        '  "summary": "两三句总述，必须点明信息不足之处",\n' +
        '  "groundedIn": [{"claim":"某个结论","from":[证据编号]}, …]\n' +
        "}\n" +
        "⚠️ `type` 只能从上面六个里选一个。**证据不足以判断就填 null**，并在 typeEvidence 里说明缺什么 —— " +
        "宁可说「暂不判定」，也不要猜一个。",
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

  /**
   * 倾向型：**只接受六型之一**，其余一律当作"暂不判定"。
   *
   * 为什么不让它自由发挥：这个字段会直接显示成"你的人格倾向是 X"，
   * 还可能被发现页的筛选用到 —— 一个模型自创的型名会污染筛选。
   * 判定不了就返回 null，界面显示"暂不判定"，不硬选。
   */
  const rawType = typeof o.type === "string" ? o.type.trim() : "";
  const type = (PERSONA_TYPES as string[]).includes(rawType)
    ? (rawType as (typeof PERSONA_TYPES)[number])
    : null;

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
    /** 判定的倾向型（可为 null = 暂不判定） */
    type,
    /** 判定依据：必须带原话，界面上和型名一起显示 */
    typeEvidence: typeof o.typeEvidence === "string" ? o.typeEvidence.slice(0, 300) : "",
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
    /* 规则兜底**不判型**：它只做统计归并，没有读懂内容的能力，
       硬选一个型等于编。界面会显示"暂不判定"。 */
    type: null,
    typeEvidence: "",
    summary:
      `本次未调用大模型，仅把已有标签做了归并（${evidence.length} 条证据）。` +
      (testItem ? `包含 ${testItem.text}。` : "") +
      "要得到更完整的画像，需要接入大模型或补充更多数据源。",
    groundedIn: [],
  };
}

/**
 * 对证据包做外发脱敏，并统计命中。
 *
 * 返回**新的** items（不改原对象）：原文本还要留在库里给用户自己看，
 * 就地打码等于把用户的数据弄坏。
 */
function redactEvidenceItems(items: EvidenceItem[]): {
  items: EvidenceItem[];
  hits: { rule: string; count: number }[];
  total: number;
} {
  const counts = new Map<string, number>();
  const safe = items.map((it) => {
    const r = redactText(it.text);
    for (const h of r.hits) counts.set(h.rule, (counts.get(h.rule) ?? 0) + h.count);
    return r.total > 0 ? { ...it, text: r.text } : it;
  });
  const hits = [...counts].map(([rule, count]) => ({ rule, count }));
  return { items: safe, hits, total: hits.reduce((s, h) => s + h.count, 0) };
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

  /**
   * 外发前脱敏。
   *
   * 证据来自用户导入的**真实私聊/文档**，里面确实出现过手机号、身份证式长数字、
   * base64 凭据串（实测一份微信私聊里就有）。`chatCompletion` 那层也有一道兜底，
   * 但这里显式做一次是为了**拿到精确命中条数**并回报给用户 ——
   * 悄悄改了他的数据再发出去是不诚实的。
   */
  const privacy = redactEvidenceItems(items);

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
      privacy: { hits: [], total: 0 },
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
      const raw = await chatCompletion(chosen, buildMessages(privacy.items, displayName), {
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
        /**
         * ⚠️ **不再写 `values`（LLM 拍的六维）**。
         *
         * 用户确认的方针：价值观六维只保留在 SBTI 自评那一侧，不参与综合结论。
         * 让模型对着证据拍六个 0~1 的数字，实测出来的就是 100%/50% 这种整档值
         * （"数据太假"）。判型改由 `type` / `typeEvidence` 承担 ——
         * 那是**读懂内容后的结论 + 原话依据**，而不是六个凭空的小数。
         * 历史数据里的旧 values 保留不动（界面仍可显示，但会被标注为旧口径）。
         */
        values: undefined,
        /* 判型与依据：写进 personality（JSON 列），discover 页优先读它 */
        ...(method === "llm"
          ? {
              personality: {
                ...((persona.personality ?? {}) as Record<string, unknown>),
                ...(distilled.type
                  ? {
                      type: distilled.type,
                      typeEvidence: distilled.typeEvidence,
                      typeJudgedAt: new Date().toISOString(),
                      typeJudgeMethod: "llm-distill",
                    }
                  : {
                      /* 模型说判不了 —— 清掉旧的判定，别让过期结论继续挂着 */
                      type: undefined,
                      typeEvidence: undefined,
                      typeJudgedAt: new Date().toISOString(),
                      typeJudgeMethod: "llm-undecided",
                    }),
              } as never,
            }
          : {}),
        confidence: {
          method: method === "llm" ? "llm-distill" : "rule-distill",
          distilledAt: new Date().toISOString(),
          evidenceCount: items.length,
          usedSources,
          summary: distilled.summary,
          groundedIn: distilled.groundedIn,
          llmError: llmError ?? null,
          judgedType: distilled.type,
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

  /**
   * 刷新**分源解析**（facet）。
   *
   * ⚠️ 这一步以前**只在我的离线回填脚本里做过，应用内从来不做**。
   * 后果正是用户反馈的"发了新想法、重新蒸馏，人格卡却没变化"：
   * 人格卡上的「分源解析」与「综合画像」读的是持久化的 facet，
   * 而应用内的同步/蒸馏只写 evidence 与 values，facet 始终是旧的那一份
   * （或者干脆没有），所以卡片看起来永远不变。
   *
   * 所以这里必须继续刷新 —— 但**必须用正确的材料与口径**。之前踩了三个坑，
   * 同一批微信聊天被算成「社交连接 1%」+「（只有标题、无正文）」就是它们造成的：
   *   ① 材料用的是**证据包里截断到 160 字的文本**（`it.text`），
   *      而不是库里那份完整 note（导入时最多存 2000 字）；
   *   ② 没传 opts → 聊天记录按知乎长文口径算 → 短消息占比 ≥0.8 →
   *      判定"只有标题" → 三维整组丢掉、social 按 0/300 算成 1%；
   *   ③ 把「已注入 N 条」这类**源标记**和 SBTI 的类型标记也当成内容条目。
   * 现在：材料从库里按源重读、口径走 `facetOptionsFor`、只取真正的行为源。
   */
  const facetSources = [...new Set(items.map((it) => it.source))].filter(
    (s) => isObservedSource(s) && isContentFacetSource(s),
  );
  for (const source of facetSources) {
    const rows = await prisma.personaEvidence.findMany({
      where: { personaId, source },
      select: { note: true, value: true },
    });
    const contents = rows
      .map((r) => ({ text: (r.note ?? "").trim(), heat: r.value ?? undefined }))
      .filter((c) => c.text.length > 0);
    const facet = facetFromContents(source, SOURCE_LABELS[source] ?? source, contents, {
      ...facetOptionsFor(source),
    });
    if (facet) await persistSourceFacet(personaId, facet);
  }

  return {
    ok: true,
    method,
    usedSources,
    evidenceCount: items.length,
    distilled,
    llmError,
    written,
    privacy: { hits: privacy.hits, total: privacy.total },
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
