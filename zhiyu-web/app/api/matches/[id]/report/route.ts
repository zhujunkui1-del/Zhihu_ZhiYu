import { NextRequest, NextResponse } from "next/server";
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

  return NextResponse.json({ ok: true, report });
}
