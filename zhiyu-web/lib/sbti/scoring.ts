import qJson from "./data/questions.json";
import pJson from "./data/personalities.json";

export interface SbtiOption {
  key: string;
  score: number;
  text: string;
}

export interface SbtiQuestion {
  id: string;
  dim: string;
  dimName: string;
  text: string;
  options: SbtiOption[];
}

export interface SbtiPersonality {
  id: string;
  name: string;
  title: string;
  pattern: string;
  greeting: string;
  description: string;
}

export const questions = qJson as unknown as SbtiQuestion[];
export const personalities = pJson as unknown as SbtiPersonality[];

export const FALLBACK_PERSONALITY: SbtiPersonality = {
  id: "26",
  name: "HHHH",
  title: "傻乐者（兜底人格）",
  pattern: "",
  greeting: "哈哈哈哈哈哈。",
  description: "标准人格库匹配率均低于 60% 时的强制兜底人格。",
};

export interface SbtiDimensionResult {
  score: number;
  level: "L" | "M" | "H";
}

export interface SbtiResult {
  dimensionScores: Record<string, SbtiDimensionResult>;
  codes: string; // 15 位，无分隔符
  codesFormatted: string; // 例如 HHL-HMH-MMH-HHM-LHH
  type: SbtiPersonality;
  similarity: number; // 0-100
  fallback: boolean;
}

const LEVELS: Array<{ max: number; level: "L" | "M" | "H" }> = [
  { max: 3, level: "L" },
  { max: 4, level: "M" },
  { max: 6, level: "H" },
];

export function levelOf(total: number): "L" | "M" | "H" {
  return LEVELS.find((l) => total <= l.max)?.level ?? "L";
}

export function toNumber(level: "L" | "M" | "H"): number {
  return level === "L" ? 1 : level === "M" ? 2 : 3;
}

export function formatCodes(codes: string): string {
  const g = ["", "", ""];
  for (let i = 0; i < codes.length; i++) {
    g[Math.floor(i / 5)] += codes[i];
  }
  return g.join("-");
}

export function scoreSbti(answers: Record<string, string>): SbtiResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const dims: string[] = [];
  for (const q of questions) {
    if (!dims.includes(q.dim)) dims.push(q.dim);
  }

  const missing = questions.filter((q) => !answers[q.id]).map((q) => q.id);
  if (missing.length > 0) {
    throw new Error(`缺少作答：${missing.join(", ")}`);
  }

  const totals: Record<string, number> = {};
  for (const q of questions) {
    const qDef = byId.get(q.id)!;
    const opt = qDef.options.find((o) => o.key === answers[q.id]?.toUpperCase());
    if (!opt) {
      throw new Error(`q${q.id} 选项无效：${answers[q.id]}`);
    }
    totals[q.dim] = (totals[q.dim] ?? 0) + opt.score;
  }

  const dimensionScores: Record<string, SbtiDimensionResult> = {};
  let codes = "";
  for (const dim of dims) {
    const level = levelOf(totals[dim]);
    dimensionScores[dim] = { score: totals[dim], level };
    codes += level;
  }

  let best: SbtiPersonality | null = null;
  let bestSim = -1;
  let bestExact = -1;

  for (const p of personalities) {
    const pattern = p.pattern.replaceAll("-", "");
    if (pattern.length !== codes.length) continue;
    let dist = 0;
    let exact = 0;
    for (let i = 0; i < codes.length; i++) {
      const d = Math.abs(toNumber(codes[i] as "L" | "M" | "H") - toNumber(pattern[i] as "L" | "M" | "H"));
      dist += d;
      if (d === 0) exact += 1;
    }
    const sim = (1 - dist / (codes.length * 2)) * 100;
    if (
      sim > bestSim ||
      (sim === bestSim && exact > bestExact)
    ) {
      best = p;
      bestSim = sim;
      bestExact = exact;
    }
  }

  const fallback = !best || bestSim < 60;
  const type = fallback ? FALLBACK_PERSONALITY : best!;
  return {
    dimensionScores,
    codes,
    codesFormatted: formatCodes(codes),
    type,
    similarity: fallback ? 0 : bestSim,
    fallback,
  };
}
