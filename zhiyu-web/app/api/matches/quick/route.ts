import { NextRequest, NextResponse } from "next/server";
import { buildDiscover, type DiscoverCandidate } from "@/lib/discover";

export const dynamic = "force-dynamic";

/**
 * 快速匹配：不经过 Agent 对话，直接用人格数据找最同频的人。
 *
 * 与 /api/discover 的分工见那个文件顶部注释。
 * 这里在 discover 的候选集之上做**排序 + 截断**，并允许地区/倾向预筛，
 * 因为「快速匹配」的产品语义是"给我最合拍的几个"，而不是"让我浏览全部"。
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const personaId = sp.get("personaId");
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 10) || 10, 1), 50);
  const province = sp.get("province")?.trim() ?? "";
  const city = sp.get("city")?.trim() ?? "";
  const type = sp.get("type")?.trim() ?? "";
  const agentOnly = sp.get("agent") === "1";

  const data = await buildDiscover(personaId);

  let list: DiscoverCandidate[] = data.candidates;
  if (province) list = list.filter((c) => c.province === province);
  if (city) list = list.filter((c) => c.city === city);
  if (type) list = list.filter((c) => c.type === type);
  if (agentOnly) list = list.filter((c) => c.agentOpen);

  const matches = [...list].sort((a, b) => b.sim - a.sim).slice(0, limit);

  return NextResponse.json({
    ok: true,
    mode: "quick",
    meReady: data.meReady,
    count: matches.length,
    /** 预筛后的候选总数（用于提示"从 N 位里选出 M 位"） */
    poolSize: list.length,
    matches,
  });
}
