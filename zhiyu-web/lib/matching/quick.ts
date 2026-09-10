// MVP 快速匹配：基于现有结构化字段做规则化评分，不做 LLM 对话。

export interface MatchablePersona {
  id: string;
  displayName: string;
  kind: string;
  interests: unknown;
  topics: unknown;
  communicationStyle: unknown;
  values: unknown;
  personality: unknown;
}

export interface QuickDimensionScore {
  score: number | null;
  label: string;
}

export interface QuickMatchResult {
  personaId: string;
  displayName: string;
  kind: string;
  overall: number;
  dimensions: Record<string, QuickDimensionScore>;
  reasons: string[];
}

const CODE_ORDER: Record<string, number> = { L: 1, M: 2, H: 3 };

function sbtiCodes(personality: unknown): string | null {
  const p = (personality ?? {}) as Record<string, unknown>;
  const sbti = p.sbti as { codes?: string } | undefined;
  return sbti?.codes ? sbti.codes.replaceAll("-", "") : null;
}

function codeSim(a: string, b: string): number | null {
  if (a.length !== 15 || b.length !== 15) return null;
  let dist = 0;
  for (let i = 0; i < 15; i++) {
    dist += Math.abs((CODE_ORDER[a[i]] ?? 2) - (CODE_ORDER[b[i]] ?? 2));
  }
  return (1 - dist / 30) * 100;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function jaccard(a: string[], b: string[]): number | null {
  if (a.length === 0 || b.length === 0) return null;
  const setA = new Set(a.map((x) => x.toLowerCase()));
  const setB = new Set(b.map((x) => x.toLowerCase()));
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? null : (inter / union) * 100;
}

function valuesSim(a: unknown, b: unknown): number | null {
  const va = (a ?? {}) as Record<string, number>;
  const vb = (b ?? {}) as Record<string, number>;
  const keys = Object.keys(va).filter((k) => typeof vb[k] === "number");
  if (keys.length === 0) return null;
  const diff =
    keys.reduce((sum, k) => sum + Math.abs((va[k] ?? 0) - (vb[k] ?? 0)), 0) /
    keys.length;
  return (1 - Math.min(diff, 1)) * 100;
}

export function quickMatch(
  me: MatchablePersona,
  candidates: MatchablePersona[],
  limit = 10,
): QuickMatchResult[] {
  const results: QuickMatchResult[] = [];

  for (const c of candidates) {
    if (c.id === me.id) continue;

    const personalitySim = sbtiCodes(me.personality)
      ? codeSim(sbtiCodes(me.personality)!, sbtiCodes(c.personality) ?? "")
      : null;
    const interestSim = jaccard(
      stringArray(me.interests),
      stringArray(c.interests),
    );
    const topicSim = jaccard(stringArray(me.topics), stringArray(c.topics));
    const commSim = jaccard(
      stringArray(me.communicationStyle),
      stringArray(c.communicationStyle),
    );
    const valueSim = valuesSim(me.values, c.values);
    const complementarity =
      personalitySim == null ? null : Math.max(0, 100 - personalitySim);

    const dims: Record<string, QuickDimensionScore> = {
      interest: { score: interestSim, label: "兴趣同频" },
      personality: { score: personalitySim, label: "人格画像相似" },
      topics: { score: topicSim, label: "话题重合" },
      values: { score: valueSim, label: "价值观适配" },
      communication: { score: commSim, label: "沟通适配" },
      complementarity: { score: complementarity, label: "互补程度" },
    };

    const weights: Record<string, number> = {
      interest: 0.3,
      personality: 0.25,
      topics: 0.15,
      values: 0.1,
      communication: 0.1,
      complementarity: 0.1,
    };

    let totalWeight = 0;
    let weighted = 0;
    for (const [key, dim] of Object.entries(dims)) {
      if (dim.score != null) {
        weighted += (weights[key] ?? 0) * dim.score;
        totalWeight += weights[key] ?? 0;
      }
    }
    const overall = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

    const reasons: string[] = [];
    if (personalitySim != null && personalitySim >= 60) {
      reasons.push(`SBTI 人格画像相似度 ${Math.round(personalitySim)}%`);
    }
    if (interestSim != null && interestSim >= 30) {
      reasons.push(`兴趣重合 ${Math.round(interestSim)}%（如：${stringArray(c.interests).slice(0, 3).join("、")}）`);
    }
    if (topicSim != null && topicSim >= 30) {
      reasons.push(`共同关注 ${stringArray(c.topics).slice(0, 2).join("、")} 等话题`);
    }
    if (valueSim != null && valueSim >= 60) {
      reasons.push(`价值观适配 ${Math.round(valueSim)}%`);
    }
    if (complementarity != null && complementarity >= 60) {
      reasons.push(`人格互补度 ${Math.round(complementarity)}%，可能有思想碰撞`);
    }
    if (reasons.length === 0) {
      reasons.push("候选特征有限，建议完善人格数据后再精确匹配");
    }

    results.push({
      personaId: c.id,
      displayName: c.displayName,
      kind: c.kind,
      overall,
      dimensions: dims,
      reasons,
    });
  }

  return results.sort((x, y) => y.overall - x.overall).slice(0, limit);
}
