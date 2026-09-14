/**
 * 「人格视图」装配：把 Persona 记录整理成页面可直接渲染的形态。
 *
 * 为什么抽成共享模块：`/api/persona/[id]`、「我的人格」页与首页的人格总览
 * 都要用这套逻辑（完整度、六源注入状态、阶段、SBTI）。分散实现容易算出不一致的数字。
 */

import { prisma } from "@/lib/db";
import type { Persona, PersonaSource } from "@prisma/client";
import { computeCompleteness, type PersonaSourceType } from "@/lib/persona/completeness";
import { axesFromDimensions, type Axis, type RawDimScore } from "@/lib/sbti/axes";

/** 六个数据源与展示顺序（首页的「人格数据源」行、我的人格页都用它） */
export const SOURCE_TYPES: PersonaSourceType[] = [
  "wechat",
  "qq",
  "feishu",
  "dingtalk",
  "zhihu",
  "sbti",
];

export const SOURCE_LABELS: Record<PersonaSourceType, string> = {
  wechat: "微信",
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
  zhihu: "知乎",
  sbti: "SBTI",
};

export interface SbtiView {
  codes?: string;
  type?: string;
  typeTitle?: string;
  similarity?: number;
  fallback?: boolean;
  /** 15 个维度的原始分（SBTI 提交时写入） */
  dimensions?: Record<string, RawDimScore>;
}

export interface SourceChip {
  type: PersonaSourceType;
  label: string;
  status: string;
  /** 是否已注入（chip 上点亮圆点） */
  injected: boolean;
  importedAt: Date | null;
}

export interface PersonaBoard {
  id: string;
  displayName: string;
  kind: string;
  bio: string | null;
  completeness: number;
  coveredCategories: number;
  categories: Record<string, { covered: boolean; label: string; injected: PersonaSourceType[] }>;
  /** collecting | ready_for_distill */
  stage: string;
  sbti: SbtiView | null;
  /** 六个数据源按固定顺序列出（缺的也列，显示为未注入） */
  sourceChips: SourceChip[];
  injectedCount: number;
  /**
   * 五轴画像（由 SBTI 的 15 维聚合而来）。
   * 未做 SBTI 时各轴 value 为 null —— 调用方据此显示"等待蒸馏"。
   */
  axes: Axis[];
}

/**
 * 读取并整理一个人设。
 *
 * 副作用：完整度与库中不一致时会顺带回写（沿用原有行为）。
 *
 * @param preloaded 调用方已查过的 persona（含 sources）。
 *   传进来可省一次数据库往返 —— Neon 在新加坡，单次往返约 100~200ms，
 *   而首页既要人格卡又要发现预览，不共享的话同一个 persona 会查两遍。
 */
export async function buildPersonaBoard(
  personaId: string,
  preloaded?: (Persona & { sources: PersonaSource[] }) | null,
): Promise<PersonaBoard | null> {
  const persona =
    preloaded !== undefined
      ? preloaded
      : await prisma.persona.findUnique({
          where: { id: personaId },
          include: { sources: true },
        });
  if (!persona) return null;

  const injected = persona.sources
    .filter((s) => s.status === "injected")
    .map((s) => s.type as PersonaSourceType);
  const completeness = computeCompleteness(injected);

  /* 完整度是派生值，与库中不一致时回写，保证列表页读到的是最新值 */
  if (Math.abs((persona.completeness ?? 0) - completeness.percent) > 0.001) {
    await prisma.persona.update({
      where: { id: persona.id },
      data: { completeness: completeness.percent },
    });
  }

  const byType = new Map(persona.sources.map((s) => [s.type as PersonaSourceType, s]));
  const sourceChips: SourceChip[] = SOURCE_TYPES.map((type) => {
    const row = byType.get(type);
    return {
      type,
      label: SOURCE_LABELS[type],
      status: row?.status ?? "not_injected",
      injected: row?.status === "injected",
      importedAt: row?.importedAt ?? null,
    };
  });

  const personality = (persona.personality ?? {}) as Record<string, unknown>;
  const sbti = (personality.sbti ?? null) as SbtiView | null;

  return {
    id: persona.id,
    displayName: persona.displayName,
    kind: persona.kind,
    bio: persona.bio,
    completeness: completeness.percent,
    coveredCategories: completeness.coveredCategories,
    categories: completeness.categories,
    stage: injected.length === 0 ? "collecting" : "ready_for_distill",
    sbti,
    sourceChips,
    injectedCount: injected.length,
    /* 五轴来自 SBTI 的 15 维聚合 —— 这是真实数据，不是占位 */
    axes: axesFromDimensions(sbti?.dimensions),
  };
}
