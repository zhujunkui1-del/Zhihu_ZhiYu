import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      personaA: { select: { id: true, displayName: true, kind: true, personality: true } },
      personaB: { select: { id: true, displayName: true, kind: true, personality: true } },
      report: true,
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { messages: { orderBy: [{ round: "asc" }, { createdAt: "asc" }] } },
      },
    },
  });

  if (!match) {
    return NextResponse.json({ ok: false, error: "Match 不存在" }, { status: 404 });
  }

  const session = match.sessions[0] ?? null;
  const rounds = session
    ? Array.from(new Set(session.messages.map((m) => m.round))).map((round) => {
        const msgs = session.messages.filter((m) => m.round === round);
        return {
          round,
          question: msgs.find((m) => m.role === "system")?.content ?? "",
          aReply: msgs.find((m) => m.role === "agent_a")?.content ?? "",
          bReply: msgs.find((m) => m.role === "agent_b")?.content ?? "",
        };
      })
    : [];

  return NextResponse.json({
    ok: true,
    match: {
      id: match.id,
      mode: match.mode,
      status: match.status,
      personaA: match.personaA,
      personaB: match.personaB,
      session: session
        ? { id: session.id, status: session.status, rounds, startedAt: session.startedAt }
        : null,
      report: match.report,
    },
  });
}
