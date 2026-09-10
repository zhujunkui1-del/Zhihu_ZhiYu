import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeCompleteness, type PersonaSourceType } from "@/lib/persona/completeness";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const persona = await prisma.persona.findUnique({
    where: { id },
    include: { sources: true },
  });
  if (!persona) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  const injected = persona.sources
    .filter((s) => s.status === "injected")
    .map((s) => s.type as PersonaSourceType);
  const completeness = computeCompleteness(injected);

  if (Math.abs((persona.completeness ?? 0) - completeness.percent) > 0.001) {
    await prisma.persona.update({
      where: { id: persona.id },
      data: { completeness: completeness.percent },
    });
  }

  const personality = (persona.personality ?? {}) as Record<string, unknown>;
  const sbti = (personality.sbti ?? null) as
    | { codes?: string; type?: string; typeTitle?: string; similarity?: number; fallback?: boolean }
    | null;

  const stage = injected.length === 0 ? "collecting" : "ready_for_distill";

  return NextResponse.json({
    ok: true,
    persona: {
      id: persona.id,
      displayName: persona.displayName,
      kind: persona.kind,
      bio: persona.bio,
      completeness: completeness.percent,
      coveredCategories: completeness.coveredCategories,
      categories: completeness.categories,
      stage,
      sbti,
      sources: persona.sources.map((s) => ({
        type: s.type,
        status: s.status,
        importedAt: s.importedAt,
      })),
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
    },
  });
}
