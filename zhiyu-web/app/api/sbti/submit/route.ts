import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { scoreSbti, questions } from "@/lib/sbti/scoring";

export const dynamic = "force-dynamic";

interface SubmitBody {
  personaId?: string;
  answers?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.personaId || typeof body.personaId !== "string") {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== "object") {
    return NextResponse.json({ ok: false, error: "缺少 answers" }, { status: 400 });
  }
  if (Object.keys(body.answers).length !== questions.length) {
    return NextResponse.json(
      { ok: false, error: `需要作答 ${questions.length} 题` },
      { status: 400 },
    );
  }

  let result;
  try {
    result = scoreSbti(body.answers);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }

  const persona = await prisma.persona.findUnique({
    where: { id: body.personaId },
  });
  if (!persona) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  const current = (persona.personality ?? {}) as Record<string, unknown>;
  await prisma.$transaction([
    prisma.persona.update({
      where: { id: persona.id },
      data: {
        personality: {
          ...current,
          sbti: {
            codes: result.codesFormatted,
            type: result.type.name,
            typeTitle: result.type.title,
            similarity: result.similarity,
            fallback: result.fallback,
            dimensions: result.dimensionScores,
          },
        } as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.personaSource.upsert({
      where: { personaId_type: { personaId: persona.id, type: "sbti" } },
      update: { status: "injected", importedAt: new Date() },
      create: {
        personaId: persona.id,
        type: "sbti",
        status: "injected",
        importedAt: new Date(),
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    codes: result.codesFormatted,
    type: { name: result.type.name, title: result.type.title },
    similarity: result.similarity,
    fallback: result.fallback,
    dimensions: result.dimensionScores,
  });
}
