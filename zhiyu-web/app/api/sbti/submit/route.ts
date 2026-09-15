import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { scoreSbti, questions } from "@/lib/sbti/scoring";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

interface SubmitBody {
  personaId?: string;
  answers?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;
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

  /* ⚠️ 越权保护：SBTI 是**自评**，只能写进自己的人格。
     此前这里直接信任 body.personaId，等于任何人都能把别人的 SBTI
     覆盖掉（一条 POST 即可改掉对方的人格数据）。 */
  const me = await resolveIdentity();
  if (me?.ownPersonaId && persona.id !== me.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", error: "只能提交自己的人格测试" },
      { status: 403 },
    );
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
    /* 结果弹窗要展示"完整解读"：点睛短句 + 长文。
       人格库本来就带着这两段（greeting / description），
       以前没往外传，前端只能显示一行「刚完成 SBTI：死者」。 */
    greeting: result.type.greeting ?? null,
    description: result.type.description ?? null,
  });
}
