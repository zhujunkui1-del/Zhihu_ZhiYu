import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveIdentity } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

/**
 * 通知列表 / 全部标为已读。
 *
 * 身份**只**来自 `resolveIdentity()`（HttpOnly 会话）。
 * **不接受 `?userId=` 或 body 里的 userId** —— 那是水平越权：
 * 带上别人的 id 就能读别人的通知、把别人的消息标成已读。
 */
export async function GET() {
  const me = await resolveIdentity();
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

export async function POST(_req: NextRequest) {
  const me = await resolveIdentity();
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
