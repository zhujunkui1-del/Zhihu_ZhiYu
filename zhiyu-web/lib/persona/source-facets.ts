/**
 * 分源人格解析：把库里**按源存好的证据**逐源解析成 facet，
 * 再融合成综合画像（六维 + 人格倾向）。
 *
 * ── 产品要求（用户原话整理）────────────────────────────────────────────
 *   · 拿到某个源的数据后，就应该能解析出"这个人在这个源里表现出什么特征"
 *   · 「我的人格」页要把每个源的解析分别展示出来
 *   · 「综合画像」是**多源蒸馏融合**的结果，不是 SBTI 自评结果
 *
 * 之前的实现只有"整体蒸馏"这一步，且把 SBTI 结果当成综合画像；
 * 分源解析与融合判定都不存在。本模块补上这两层。
 *
 * 数据来源：`PersonaEvidence`（source / trait / value / note / url）。
 * 知乎同步与回填脚本都把内容写在这里，SBTI 也写了一条，
 * 所以这里能一次性拿到"每个源各自有什么"。
 */

import { prisma } from "@/lib/db";
import { personalities } from "@/lib/sbti/scoring";
import {
  facetFromContents,
  fuseSourceFacets,
  matchPersonaType,
  isObservedSource,
  interestFromContents,
  VALUE_KEYS,
  type SourceContent,
  type SourceFacet,
  type TypeMatch,
  type ValueKey,
} from "./fusion";

/**
 * 按代码查 SBTI 人格记录。
 *
 * ⚠️ 字段含义容易搞反（实测）：
 *   `id`    = 编号（"20"）
 *   `name`  = **代码**（"MONK"）
 *   `title` = 中文名（"僧人"）
 *   `description` = 解读长文；`greeting` = 一句话开场白
 * 所以按代码查要用 `name`，不是 `id`。
 */
function findSbti(code: string | null | undefined) {
  if (!code) return null;
  const want = code.trim().toUpperCase();
  return personalities.find((x) => String(x.name).trim().toUpperCase() === want) ?? null;
}

/**
 * 取某个 SBTI 人格的解析文案。
 *
 * 人格库（25 型：CTRL 拿捏者 / MONK 僧人 / DEAD 死者 …）本来就随项目带着
 * （`lib/sbti/data/personalities.json`），`description` 就是完整解读 ——
 * 直接拿来用，不需要去解析 skill 里的 markdown。
 */
export function sbtiBlurb(code: string | null | undefined): string | null {
  const p = findSbti(code);
  if (!p) return null;
  /* greeting + description：前者是那句点睛的短句，后者是完整解读 */
  const parts = [p.greeting?.trim(), p.description?.trim()].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

/** 取 SBTI 人格的中文名（僧人 / 拿捏者 …） */
export function sbtiTitle(code: string | null | undefined): string | null {
  return findSbti(code)?.title?.trim() ?? null;
}

/** 取 SBTI 人格的一句话开场白（"没有那种世俗的欲望。"） */
export function sbtiGreeting(code: string | null | undefined): string | null {
  return findSbti(code)?.greeting?.trim() ?? null;
}

/** 源的展示名（与人格卡上的六源命名保持一致） */
const SOURCE_LABEL: Record<string, string> = {
  zhihu: "知乎 · 公共表达",
  wechat: "微信 · 私域生活",
  qq: "QQ · 私域表达",
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
  sbti: "SBTI · 显性自评",
  profile: "公开资料",
  distill: "Agent 蒸馏",
};

export interface PersonaFacets {
  /** 每个**观察到的**源各自解析出的 facet（SBTI 不在其中，它是自评） */
  observed: SourceFacet[];
  /** SBTI 单独作为一面：本人自评的结果 */
  selfReport: {
    type: string | null;
    typeTitle: string | null;
    codes: string | null;
    /** 自评结果的一句话解读（来自 sbti-skill 的人格库） */
    blurb: string | null;
  } | null;
  /** 多源融合出的六维 */
  fused: Partial<Record<ValueKey, number>>;
  /** 参与融合的源 */
  usedSources: string[];
  /** 由融合六维判定的人格倾向；数据不足时为 null（不硬猜） */
  type: TypeMatch | null;
}

/** PersonaFeature 里存"分源解析结果"用的 key 前缀 */
const FACET_KEY_PREFIX = "facets:";

/**
 * 把一个源解析出的 facet **持久化**。
 *
 * ── 为什么必须写入时算、存下来，而不是读的时候再算 ────────────────────
 * `PersonaEvidence.note` 有长度限制，而且实际存进去的是**标题**
 * （实测 26 个真实用户的 note 平均只有 20 字，0 条 ≥120 字）。
 * 若读取时拿这些 note 反推"表达密度 / 长文比例 / 连接强度"，
 * 量到的其实是**标题长度**，不是这个人的特征。之前正是踩了这个坑：
 * 所有人的 learning 都是 0.03、creation 恒定，判定结果 19/24 挤在同一型。
 *
 * 正确做法：**写入时**算（那时手上有公开端点返回的完整正文与热度），
 * 之后读取只做组装，不再反推。
 */
export async function persistSourceFacet(personaId: string, facet: SourceFacet): Promise<void> {
  const key = `${FACET_KEY_PREFIX}${facet.source}`;
  await prisma.personaFeature.upsert({
    where: { personaId_key: { personaId, key } },
    update: { value: facet as never },
    create: { personaId, key, value: facet as never },
  });
}

/** 读回已持久化的分源解析结果 */
export async function loadSourceFacets(personaId: string): Promise<SourceFacet[]> {
  const rows = await prisma.personaFeature.findMany({
    where: { personaId, key: { startsWith: FACET_KEY_PREFIX } },
  });
  const out: SourceFacet[] = [];
  for (const r of rows) {
    const v = r.value as unknown as SourceFacet | null;
    if (v && typeof v === "object" && typeof v.source === "string" && v.values) out.push(v);
  }
  /* 顺序固定，避免每次刷新顺序乱跳 */
  return out.sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * 读取一个人格的分源解析 + 综合画像。
 *
 * @param personaId 目标人格
 */
export async function buildPersonaFacets(personaId: string): Promise<PersonaFacets | null> {
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, personality: true, values: true },
  });
  if (!persona) return null;

  /**
   * 分源解析优先取**持久化的 facet**（写入时按完整原文算的，可信）。
   *
   * 没有持久化记录时的回退：用 `Persona.values` 当作一个整体源。
   * 演示人格的六维就是预置在那里的；真实用户若跑过整源蒸馏也会有。
   * **绝不拿被裁过的 note 硬算** —— 那只会产出假特征。
   */
  const observed: SourceFacet[] = await loadSourceFacets(personaId);

  if (observed.length === 0) {
    const v = persona.values as Record<string, unknown> | null;
    const nums: Partial<Record<ValueKey, number>> = {};
    if (v && typeof v === "object") {
      for (const k of VALUE_KEYS) {
        const raw = v[k];
        if (typeof raw === "number" && Number.isFinite(raw)) nums[k] = raw;
      }
    }
    if (Object.keys(nums).length) {
      observed.push({
        source: "profile",
        label: "已有六维（无逐源明细）",
        values: nums,
        itemCount: 0,
        summary: "六个维度来自既有数据，暂无可展示的逐源解析。",
      });
    }
  }

  const { fused, usedSources } = fuseSourceFacets(observed);

  /* SBTI 自评单独一面（不参与融合） */
  const sbti = ((persona.personality ?? {}) as Record<string, unknown>).sbti as
    | { type?: string; typeTitle?: string; codes?: string }
    | undefined;
  const selfReport = sbti?.type
    ? {
        type: sbti.type,
        typeTitle: sbti.typeTitle ?? null,
        codes: sbti.codes ?? null,
        blurb: sbtiBlurb(sbti.type),
      }
    : null;

  return {
    observed,
    selfReport,
    fused,
    usedSources,
    type: matchPersonaType(fused),
  };
}

/**
 * 取某个源解析出的兴趣方向（供展示"这个源里他关心什么"）。
 *
 * ⚠️ 这里用 note 是**可以的**：兴趣是"文本里出现了哪些领域词"，
 * 标题往往就足以判断（"金庸x苏轼" → 人文历史）。这与"用标题长度
 * 推断表达密度"完全不同 —— 后者是把长度当特征，前者只是关键词匹配。
 */
export async function sourceInterests(personaId: string): Promise<Record<string, string[]>> {
  const rows = await prisma.personaEvidence.findMany({
    where: { personaId },
    select: { source: true, note: true },
  });
  const bySource = new Map<string, string[]>();
  for (const r of rows) {
    if (!isObservedSource(r.source)) continue;
    const note = (r.note ?? "").trim();
    if (note.length < 4) continue;
    const list = bySource.get(r.source) ?? [];
    list.push(note);
    bySource.set(r.source, list);
  }
  const out: Record<string, string[]> = {};
  for (const [source, texts] of bySource) {
    out[source] = interestFromContents(texts);
  }
  return out;
}
