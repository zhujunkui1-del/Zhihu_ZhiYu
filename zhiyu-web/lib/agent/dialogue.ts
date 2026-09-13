// Agent-to-Agent 演示对话 + Judge（确定性规则版）。
// 后续接入 LLM 时替换 answer()/judge() 内部实现，接口与数据模型保持不变。

export interface DialoguePersona {
  id: string;
  displayName: string;
  kind: string;
  interests?: unknown;
  topics?: unknown;
  communicationStyle?: unknown;
  values?: unknown;
  personality?: unknown;
}

export interface DialogueRound {
  round: number;
  dimension: string;
  question: string;
  aReply: string;
  bReply: string;
}

export interface JudgeDimensions {
  interest: number;
  thinking: number;
  values: number;
  communication: number;
  complementarity: number;
}

export interface JudgeResult {
  overall: number;
  dimensions: JudgeDimensions;
  summary: string;
  reasons: string[];
  demoMode: boolean;
}

export const QUESTIONS = [
  { dimension: "interest", text: "如果突然获得一周完全自由的时间，你会怎么安排？" },
  { dimension: "thinking", text: "一个和你观点完全不同的人，你更愿意说服 TA，还是理解 TA？" },
  { dimension: "values", text: "对你来说，学习和创造哪个更接近你生活的底色？" },
  { dimension: "communication", text: "你在什么情况下会主动开启一段对话？" },
  { dimension: "complementarity", text: "你更愿意把一件事做到极致，还是同时尝试很多新东西？" },
] as const;

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function sbtiCode(p: DialoguePersona): string | null {
  const s = ((p.personality ?? {}) as Record<string, unknown>).sbti as
    | { codes?: string }
    | undefined;
  return s?.codes ? s.codes.replaceAll("-", "") : null;
}

function codeSim(a: string, b: string): number | null {
  const rank: Record<string, number> = { L: 1, M: 2, H: 3 };
  if (a.length !== 15 || b.length !== 15) return null;
  let dist = 0;
  for (let i = 0; i < 15; i++) {
    dist += Math.abs((rank[a[i]] ?? 2) - (rank[b[i]] ?? 2));
  }
  return (1 - dist / 30) * 100;
}

/**
 * 按人格数据生成回答。
 *
 * 修复记录：此前 `thinking` / `values` / `complementarity` 三个分支是**固定文案**，
 * 只有 `interest` / `communication` 随人格变化。后果是对 16 个示例人格，
 * **62.5% 的回答完全重复** —— 报告里的"Agent 对话"看起来像复读。
 * 现在三个分支都改为由该人格的真实数据驱动。
 */
function answerFor(p: DialoguePersona, dimension: string): string {
  const name = p.displayName;
  const interests = strArray(p.interests);
  const topics = strArray(p.topics);
  const comm = strArray(p.communicationStyle);
  const values = (p.values ?? {}) as Record<string, number>;
  const sbti = ((p.personality ?? {}) as Record<string, unknown>).sbti as
    | { type?: string; typeTitle?: string }
    | undefined;
  const tag = sbti?.typeTitle ? `${sbti.typeTitle}（${sbti.type}）` : "未测人格";

  /** 取 values 里最高的几项，转成"在意什么"的说法 */
  const VALUE_LABEL: Record<string, string> = {
    career: "职业成就",
    social: "人际连接",
    autonomy: "自主空间",
    creation: "创造表达",
    learning: "求知",
    stability: "稳定感",
  };
  const topValues = Object.entries(values)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => VALUE_LABEL[k] ?? k);
  const lowValue = Object.entries(values)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => a[1] - b[1])[0];
  const lowLabel = lowValue ? (VALUE_LABEL[lowValue[0]] ?? lowValue[0]) : "";

  /** 沟通风格取前两项，描述"我怎么说话" */
  const commPhrase = comm.length >= 2 ? comm.slice(0, 2).join("、") : "";

  switch (dimension) {
    case "interest":
      return interests.length > 0
        ? `${name}：会把时间花在 ${interests.slice(0, 3).join("、")} 上，越沉浸越快乐。`
        : `${name}：先补完想做的事，再看心情探索。`;

    case "thinking":
      return `${name}：我习惯${commPhrase || "先把逻辑跑一遍"}，像 ${tag} 那样先理解再判断${
        topics.length > 0 ? `；碰到 ${topics[0]} 这类话题会格外较真` : ""
      }。`;

    case "values": {
      const core = topValues.length ? topValues.join("和") : "把手上的事做扎实";
      const tail = lowLabel ? `；相比之下我对${lowLabel}没那么执着` : "";
      const hasBoth =
        typeof values.learning === "number" && typeof values.creation === "number";
      if (hasBoth) {
        /* 只看"谁大"不够 —— 多数人 learning 略高于 creation，
           会导致这句在全体人格里几乎一样。改成看**差距**：
           差距明显才下结论，接近时说"两者拉扯"。 */
        const gap = values.learning - values.creation;
        const verdict =
          gap > 0.15
            ? "学习更接近底色，先把世界读懂"
            : gap < -0.15
              ? "创造更接近底色，先把想法做出来"
              : "学习输入和创造输出一直在互相拉扯，还没分出主次";
        return `${name}：对我最重要的是${core}${tail}。学习和创造我都要——真要说，${verdict}。`;
      }
      return `${name}：对我最重要的是${core}${tail}。`;
    }

    case "communication":
      return topics.length > 0
        ? `${name}：聊到 ${topics.slice(0, 2).join("、")} 这类话题时我会主动开口${
            commPhrase ? `（方式偏${commPhrase}）` : ""
          }。`
        : `${name}：遇到真正感兴趣或值得较真的话题时，我会主动${
            commPhrase ? `，一般是${commPhrase}` : ""
          }。`;

    default: {
      const autonomy = typeof values.autonomy === "number" ? values.autonomy : null;
      const stability = typeof values.stability === "number" ? values.stability : null;
      /* 自主性高 → 偏"把一件事做到极致"；稳定需求高 → 偏"广泛尝试但不冒险" */
      if (autonomy !== null && autonomy >= 0.7) {
        return `${name}：我更愿意把一件事做到极致——自主空间（${Math.round(autonomy * 100)}%）对我来说比铺开面更重要。`;
      }
      if (stability !== null && stability >= 0.65) {
        return `${name}：我会同时尝试很多新东西，但会留一条退路（稳定感需求 ${Math.round(stability * 100)}%）。`;
      }
      return `${name}：重要的事做到极致，新鲜的事愿意尝试——${
        autonomy !== null ? `看当下更需要深度还是广度（自主性 ${Math.round(autonomy * 100)}%）` : "两者我都不想放弃"
      }。`;
    }
  }
}

function jaccard(a: string[], b: string[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  const sa = new Set(a.map((x) => x.toLowerCase()));
  const sb = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? null : (inter / union) * 100;
}

function valuesSim(a: unknown, b: unknown): number | null {
  const va = (a ?? {}) as Record<string, number>;
  const vb = (b ?? {}) as Record<string, number>;
  const keys = Object.keys(va).filter((k) => typeof vb[k] === "number");
  if (keys.length === 0) return null;
  const diff =
    keys.reduce((s, k) => s + Math.abs((va[k] ?? 0) - (vb[k] ?? 0)), 0) / keys.length;
  return (1 - Math.min(diff, 1)) * 100;
}

export function runMockAgentDialogue(a: DialoguePersona, b: DialoguePersona): {
  rounds: DialogueRound[];
  judge: JudgeResult;
} {
  const rounds: DialogueRound[] = QUESTIONS.map((q, i) => ({
    round: i + 1,
    dimension: q.dimension,
    question: q.text,
    aReply: answerFor(a, q.dimension),
    bReply: answerFor(b, q.dimension),
  }));

  const personalitySim = sbtiCode(a) && sbtiCode(b)
    ? codeSim(sbtiCode(a)!, sbtiCode(b)!) ?? 50
    : 50;
  const interest = jaccard(strArray(a.interests), strArray(b.interests)) ?? 30;
  const thinking = personalitySim;
  const values = valuesSim(a.values, b.values) ?? 60;
  const communication =
    jaccard(strArray(a.communicationStyle), strArray(b.communicationStyle)) ?? 50;
  const complementarity = Math.max(0, Math.min(100, 100 - personalitySim * 0.6));

  const dimensions: JudgeDimensions = {
    interest: round1(interest),
    thinking: round1(thinking),
    values: round1(values),
    communication: round1(communication),
    complementarity: round1(complementarity),
  };
  const overall = Math.round(
    (Object.values(dimensions).reduce((s, v) => s + v, 0) / 5) * 100,
  );

  const reasons: string[] = [];
  if (dimensions.interest >= 0.6) reasons.push(`兴趣同频 ${Math.round(dimensions.interest * 100)}%`);
  if (dimensions.thinking >= 0.6) reasons.push(`思维共振 ${Math.round(dimensions.thinking * 100)}%`);
  if (dimensions.values >= 0.6) reasons.push(`价值观适配 ${Math.round(dimensions.values * 100)}%`);
  if (dimensions.communication >= 0.6) reasons.push(`沟通适配 ${Math.round(dimensions.communication * 100)}%`);
  if (dimensions.complementarity >= 0.6) reasons.push(`互补度 ${Math.round(dimensions.complementarity * 100)}%，可能产生思想碰撞`);
  if (reasons.length === 0) reasons.push("信息有限，建议完善双方人格数据后再进行深度匹配");

  return {
    rounds,
    judge: {
      overall: overall / 100,
      dimensions,
      summary: `综合匹配度 ${overall}%——${reasons.join("；")}。`,
      reasons,
      demoMode: true,
    },
  };
}

function round1(pct: number): number {
  return Math.max(0, Math.min(1, pct / 100));
}
