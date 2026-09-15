import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildReportView } from "@/lib/agent-match";
import { resolveIdentity } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 取**单场**匹配报告（供「通知页点『再看一次』就地打开报告」用）。
 *
 * 为什么需要它：通知里只有 `matchId`，而通知页不该为了看一份报告
 * 跳到「Agent 匹配」页 —— 产品要求就地弹窗。这里现查一次即可。
 *
 * 身份只来自会话；`buildReportView` 以**查看者自己的 persona** 为视角
 * 决定"对方是谁"，所以不会把 A 侧名字当成对方显示给 B。
 *
 * 另外如实回报两个「送出」状态，供弹窗决定按钮怎么显示：
 *   · `sentToMe` —— 这份报告是**别人送来**的（我收到过针对它的 report_received）
 *                   → 不再显示「给TA送去报告」（用户明确要求）
 *   · `sentByMe` —— 我已经送出去了 → 按钮显示「已送去」，不可重复点
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const me = await resolveIdentity();
  if (!me?.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或还没有自己的人格" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const report = await buildReportView(id, me.ownPersonaId);
  if (!report) {
    return NextResponse.json(
      { ok: false, code: "REPORT_NOT_FOUND", error: "这场匹配还没有报告" },
      { status: 404 },
    );
  }

  /* 收件人是这场匹配里"不是我的那一侧"。用 persona 推 userId，
     不额外要求调用方传参（传参容易被伪造，指到别人身上去）。 */
  const counterpartUserId =
    report.counterpart.id === report.me.id
      ? null
      : ((
          await prisma.persona.findUnique({
            where: { id: report.counterpart.id },
            select: { userId: true },
          })
        )?.userId ?? null);

  const [sentToMe, sentByMe] = await Promise.all([
    prisma.notification.findFirst({
      where: {
        userId: me.userId,
        type: "report_received",
        payload: { path: ["matchId"], equals: id },
      },
      select: { createdAt: true },
    }),
    counterpartUserId
      ? prisma.notification.findFirst({
          where: {
            userId: counterpartUserId,
            type: "report_received",
            payload: { path: ["matchId"], equals: id },
          },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    ok: true,
    report,
    /** 报告是别人送来的（我这一侧收到过投递） */
    sentToMe: Boolean(sentToMe),
    /** 我已经把它送出去了 */
    sentByMe: Boolean(sentByMe),
    sentAt: sentByMe?.createdAt ?? null,
  });
}
