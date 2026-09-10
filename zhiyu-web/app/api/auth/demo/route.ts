import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 黑客松演示登录：创建/复用演示用户（真实 OAuth 接入前使用）
export async function POST(req: NextRequest) {
  let displayName = "演示用户";
  try {
    const body = (await req.json()) as { displayName?: string };
    if (body.displayName && typeof body.displayName === "string") {
      displayName = body.displayName.trim().slice(0, 40) || displayName;
    }
  } catch {
    // 无 body 时使用默认演示名
  }

  const demo = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { username: "demo" },
      update: { displayName },
      create: { username: "demo", displayName },
    });

    const persona =
      (await tx.persona.findUnique({ where: { userId: user.id } })) ??
      (await tx.persona.create({
        data: {
          userId: user.id,
          kind: "human",
          displayName,
        },
      }));

    await tx.communicationPrefs.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    return { user, persona };
  });

  return NextResponse.json({
    ok: true,
    userId: demo.user.id,
    personaId: demo.persona.id,
    displayName: demo.user.displayName,
  });
}
