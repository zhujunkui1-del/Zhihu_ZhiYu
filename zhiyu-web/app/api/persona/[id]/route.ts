import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildPersonaBoard } from "@/lib/persona-view";
import type { PersonaCardData } from "@/lib/persona-card";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 读取一个人格卡所需的全部内容。
 *
 * 为什么把它做"厚"：首页 / 发现页要**在弹窗里原地打开别人的人格卡**
 * （产品要求：不跳页、不换路由）。弹窗必须自带足够信息，否则只能显示
 * 一个空壳 —— 那就又变成"点开什么都没有"。
 *
 * 所以这里一次给出四块：
 *   ① 六源注入状态（`sources`）
 *   ② 五维画像（`axes`，决定雷达能不能画出来）
 *   ③ 结构化特征（兴趣/话题/沟通风格/价值观…）
 *   ④ **证据**（`evidence`：每条结论凭什么 —— 产品的可解释性承诺）
 *
 * `viewerIsSelf` 由调用方在客户端判断（会话身份），这里只负责给数据，
 * 避免把"我能看什么"的逻辑塞进一个只读接口。
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;

  /* 装配逻辑统一走 buildPersonaBoard —— 人格页与首页总览用同一份，
     避免两处各算一遍完整度导致数字对不上。 */
  const board = await buildPersonaBoard(id);
  if (!board) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  /* 特征与证据分两次查：特征用于展示，证据用于"凭什么" */
  const [persona, evidence] = await Promise.all([
    prisma.persona.findUnique({
      where: { id },
      select: {
        interests: true,
        topics: true,
        communicationStyle: true,
        thinkingStyle: true,
        socialStyle: true,
        values: true,
        identity: true,
        publicRef: true,
        province: true,
        city: true,
      },
    }),
    prisma.personaEvidence.findMany({
      where: { personaId: id },
      orderBy: [{ source: "asc" }, { trait: "asc" }],
      take: 60,
    }),
  ]);

  const asStringList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    return [];
  };

  const identity = (persona?.identity ?? {}) as Record<string, unknown>;
  const values =
    persona?.values && typeof persona.values === "object"
      ? (persona.values as Record<string, unknown>)
      : null;

  const data: PersonaCardData = {
    id: board.id,
    displayName: board.displayName,
    kind: board.kind,
    bio: board.bio,
    completeness: board.completeness,
    coveredCategories: board.coveredCategories,
    stage: board.stage,
    sbti: board.sbti,
    axes: board.axes,
    axesSource: board.axesSource,
    sources: board.sourceChips.map((c) => ({
      type: c.type,
      label: c.label,
      status: c.status,
      injected: c.injected,
      importedAt: c.importedAt ? c.importedAt.toISOString() : null,
    })),
    traits: {
      interests: asStringList(persona?.interests),
      topics: asStringList(persona?.topics),
      communicationStyle: asStringList(persona?.communicationStyle),
      thinkingStyle: asStringList(persona?.thinkingStyle),
      socialStyle: asStringList(persona?.socialStyle),
      values: values
        ? Object.fromEntries(
            Object.entries(values).filter(([, v]) => typeof v === "number") as [
              string,
              number,
            ][],
          )
        : {},
    },
    identity: {
      avatarUrl: typeof identity.avatarUrl === "string" ? identity.avatarUrl : null,
      headline: typeof identity.headline === "string" ? identity.headline : null,
    },
    region: { province: persona?.province ?? null, city: persona?.city ?? null },
    zhihuUrlToken: persona?.publicRef ?? null,
    evidence: evidence.map((e) => ({
      id: e.id,
      source: e.source,
      trait: e.trait,
      value: e.value,
      note: e.note,
      url: e.url,
    })),
  };

  return NextResponse.json({ ok: true, persona: data });
}
