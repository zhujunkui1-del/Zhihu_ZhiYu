import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Agent 沟通偏好（设置页 02 的三个开关）。
 *
 * 契约依据：`产品方案/前端页面框架.md` 的「02 区：沟通偏好的 API 契约」。
 * 这是那个契约的落地实现 —— 在此之前只有表和 UI，没有接口，
 * 所以开关点了不会生效。
 *
 * 字段名以 `prisma/schema.prisma` 的 `CommunicationPrefs` 为准（扁平 camelCase）。
 */

const FIELDS = ["allowAgentInvite", "showSimilarity", "allowReportDelivery"] as const;
type Field = (typeof FIELDS)[number];

/** 记录不存在时返回默认值（全 true），**不隐式建行** */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "缺少 userId" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ ok: false, error: "用户不存在" }, { status: 404 });
  }

  const row = await prisma.communicationPrefs.findUnique({ where: { userId } });

  return NextResponse.json({
    ok: true,
    prefs: {
      allowAgentInvite: row?.allowAgentInvite ?? true,
      showSimilarity: row?.showSimilarity ?? true,
      allowReportDelivery: row?.allowReportDelivery ?? true,
    },
  });
}

/** 局部更新；记录不存在时用默认值建行后再更新 */
export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) {
    return NextResponse.json({ ok: false, error: "缺少 userId" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ ok: false, error: "用户不存在" }, { status: 404 });
  }

  /* 只接受这三个字段，且必须是 boolean；未出现的字段保持原值 */
  const patch: Partial<Record<Field, boolean>> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (typeof v !== "boolean") {
      return NextResponse.json(
        { ok: false, error: `${f} 必须是 boolean` },
        { status: 400 },
      );
    }
    patch[f] = v;
  }

  const prefs = await prisma.communicationPrefs.upsert({
    where: { userId },
    update: patch,
    create: { userId, ...patch },
  });

  return NextResponse.json({
    ok: true,
    prefs: {
      allowAgentInvite: prefs.allowAgentInvite,
      showSimilarity: prefs.showSimilarity,
      allowReportDelivery: prefs.allowReportDelivery,
    },
  });
}
