/**
 * 「人格倾向型」的**唯一取值口径**。
 *
 * ── 为什么必须只有一处 ────────────────────────────────────────────────────
 * 实测事故：首页显示「务实执行型」，同一个人的人格页显示「深度思考型」。
 * 两处读的是同一份数据（都从 `buildPersonaBoard` 来），但**优先级不一样**：
 *   · 首页当时取 `fused.type`（六维欧氏距离，匹配度 60%）
 *   · 人格页已经改成 `judgedType`（LLM 读完证据后的判定）
 * 于是同一张卡上雷达是新的、标题是旧的，首页和人格页各说各话。
 *
 * 这类"改了 A 没改 B"的 bug，靠人记得同步是防不住的 —— 所以收敛成这个函数，
 * 首页 / 人格页 / 发现页 / 人格卡**四处都调它**，任何一处都不许自己取字段。
 *
 * ── 优先级 ────────────────────────────────────────────────────────────────
 *   ① judged —— `personality.type`：蒸馏时 LLM 读懂证据后的判定，带原话依据。
 *                 演示数据预置的型也在这个字段，行为不变。
 *   ② fused  —— 六维欧氏距离（`matchPersonaType`）。**仅作历史数据兜底**：
 *                 实测第一名与第二名只差 0.016 个百分点，把 career 从 0.5
 *                 挪到 0.6 就换型，所以不再当主来源。
 *   ③ sbti   —— SBTI 自评的类型名，最后一档。
 *   ④ none   —— 都没有。界面显示"暂不判定"，不硬选。
 */

import { PERSONA_TYPES, type PersonaType } from "./fusion";

export type PersonaTypeSource = "judged" | "fused" | "sbti" | "none";

export interface ResolvedPersonaType {
  type: PersonaType | string | null;
  source: PersonaTypeSource;
  /** judged 时的原话依据；没有依据时为 null（演示数据预置的型就没有） */
  evidence: string | null;
  /** fused 时的相似度（0~100）；其它来源为 null */
  similarity: number | null;
  /** judged 的判定时间（ISO） */
  judgedAt: string | null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 解析出"这个人的倾向型"。
 *
 * @param personality `Persona.personality`（判型结果与依据写在这里）
 * @param fused       六维融合的判定结果（可为 null）
 */
export function resolvePersonaType(input: {
  personality?: unknown;
  fused?: { type: string; similarity: number } | null;
}): ResolvedPersonaType {
  const p = (input.personality ?? {}) as Record<string, unknown>;

  /* ① LLM 判定 / 演示数据预置 —— 必须在六型白名单内，自创型名一律不算 */
  const preset = str(p.type);
  if (preset && (PERSONA_TYPES as readonly string[]).includes(preset)) {
    const evidence = str(p.typeEvidence);
    return {
      type: preset as PersonaType,
      source: "judged",
      evidence: evidence || null,
      similarity: null,
      judgedAt: str(p.typeJudgedAt) || null,
    };
  }

  /* ② 六维兜底（历史数据） */
  if (input.fused?.type) {
    return {
      type: input.fused.type,
      source: "fused",
      evidence: null,
      similarity: input.fused.similarity,
      judgedAt: null,
    };
  }

  /* ③ SBTI 自评的类型名 */
  const sbti = p.sbti as { type?: string; typeTitle?: string } | undefined;
  const self = str(sbti?.typeTitle) || str(sbti?.type);
  if (self) {
    return { type: self, source: "sbti", evidence: null, similarity: null, judgedAt: null };
  }

  return { type: null, source: "none", evidence: null, similarity: null, judgedAt: null };
}

/** 界面上那句"这个型是怎么来的"，四处共用同一份文案 */
export function personaTypeSourceNote(r: ResolvedPersonaType): string {
  switch (r.source) {
    case "judged":
      return r.evidence ? "Agent 读完你的数据后判定" : "已判定";
    case "fused":
      return "六维相似度（旧口径，仅供参考）";
    case "sbti":
      return "来自 SBTI 自评（还不是综合画像）";
    default:
      return "暂不判定";
  }
}
