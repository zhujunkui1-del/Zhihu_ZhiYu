import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveIdentity } from "@/lib/auth/current-user";
import { denyIfCrossSite } from "@/lib/auth/csrf";

export const dynamic = "force-dynamic";

/**
 * Agent 沟通偏好（设置页 02 的三个开关）。
 *
 * 契约依据：`产品方案/前端页面框架.md` 的「02 区：沟通偏好的 API 契约」。
 *
 * 身份**只**来自 `resolveIdentity()`（HttpOnly 会话）。
 * 之前这里接受 `?userId=` —— 那是水平越权，而且这是**写操作**：
 * 换个 id 就能改别人的隐私开关（比如把「不被推荐给陌生人」关掉）。
 *
 * 字段名以 `prisma/schema.prisma` 的 `CommunicationPrefs` 为准（扁平 camelCase）。
 */

const FIELDS = [
  "allowAgentInvite",
  "showSimilarity",
  "allowReportDelivery",
  /* #7：设置页 03 区「使用知遇提供的大模型」滑块（默认开）。
     虽然它归在 03 区，但本质也是用户级偏好，放同一张表最省事。 */
  "usePlatformLlm",
] as const;
type Field = (typeof FIELDS)[number];

/** 记录不存在时返回默认值（全 true），**不隐式建行** */
export async function GET() {
  const me = await resolveIdentity();
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  const row = await prisma.communicationPrefs.findUnique({ where: { userId: me.userId } });

  return NextResponse.json({
    ok: true,
    prefs: {
      allowAgentInvite: row?.allowAgentInvite ?? true,
      showSimilarity: row?.showSimilarity ?? true,
      allowReportDelivery: row?.allowReportDelivery ?? true,
      usePlatformLlm: row?.usePlatformLlm ?? true,
    },
  });
}

/** 局部更新；记录不存在时用默认值建行后再更新 */
export async function PATCH(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  /* 只接受这三个字段，且必须是 boolean；未出现的字段保持原值。
     `userId` 即使传了也**忽略** —— 身份以会话为准。 */
  const patch: Partial<Record<Field, boolean>> = {};
  for (const f of FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (typeof v !== "boolean") {
      return NextResponse.json({ ok: false, error: `${f} 必须是 boolean` }, { status: 400 });
    }
    patch[f] = v;
  }

  const prefs = await prisma.communicationPrefs.upsert({
    where: { userId: me.userId },
    update: patch,
    create: { userId: me.userId, ...patch },
  });

  return NextResponse.json({
    ok: true,
    prefs: {
      allowAgentInvite: prefs.allowAgentInvite,
      showSimilarity: prefs.showSimilarity,
      allowReportDelivery: prefs.allowReportDelivery,
      usePlatformLlm: prefs.usePlatformLlm,
    },
  });
}
