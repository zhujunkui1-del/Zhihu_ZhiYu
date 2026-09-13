import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveIdentity } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * 通知列表 / 全部标为已读。
 *
 * 身份来自 `resolveIdentity()`：优先 HttpOnly 会话。
 * `?userId=` 只在非生产环境生效（本地调试与自动化验证用），
 * 生产环境忽略——否则带上别人的 userId 就能读别人的通知。
 */
export async function GET(req: NextRequest) {
  const me = await resolveIdentity({
    queryUserId: req.nextUrl.searchParams.get("userId"),
  });
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  const items = await prisma.notification.findMany({
    where: { userId: me.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  let body: { userId?: string } = {};
  try {
    body = (await req.json()) as { userId?: string };
  } catch {
    /* 允许空 body —— 身份以会话为准 */
  }

  const me = await resolveIdentity({ queryUserId: body.userId ?? null });
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  const r = await prisma.notification.updateMany({
    where: { userId: me.userId, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true, marked: r.count });
}
