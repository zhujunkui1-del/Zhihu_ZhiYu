import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "缺少 userId" }, { status: 400 });
  }
  const list = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    ok: true,
    items: list.map((n) => ({
      id: n.id,
      type: n.type,
      payload: n.payload,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
    unread: list.filter((n) => !n.readAt).length,
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { userId?: string };
  if (!body.userId) {
    return NextResponse.json({ ok: false, error: "缺少 userId" }, { status: 400 });
  }
  const res = await prisma.notification.updateMany({
    where: { userId: body.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, updated: res.count });
}
