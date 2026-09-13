import { NextResponse } from "next/server";
import { buildPersonaBoard } from "@/lib/persona-view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  /* 装配逻辑统一走 buildPersonaBoard —— 首页的人格总览用同一份，
     避免两处各算一遍完整度导致数字对不上。 */
  const board = await buildPersonaBoard(id);
  if (!board) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    persona: {
      id: board.id,
      displayName: board.displayName,
      kind: board.kind,
      bio: board.bio,
      completeness: board.completeness,
      coveredCategories: board.coveredCategories,
      categories: board.categories,
      stage: board.stage,
      sbti: board.sbti,
      sources: board.sourceChips.map((c) => ({
        type: c.type,
        status: c.status,
        importedAt: c.importedAt,
      })),
    },
  });
}
