import { NextRequest, NextResponse } from "next/server";
import { buildDiscover } from "@/lib/discover";

export const dynamic = "force-dynamic";

/**
 * 发现页数据接口。
 *
 * 为什么单独一个 /api/discover，而不是复用 /api/matches/quick：
 *
 *  · `quick` 的语义是「纯匹配」——返回"最合拍的 N 个"，会**排序并截断**。
 *    而发现页的「找特定的人」与「随机推荐」需要给**每一位**候选配一个相似度
 *    （卡片上显示"与你的相似度"），提前截断会丢掉大部分人的分数。
 *  · 发现页还要人设的 `province` / `city` / `type` / `tags` / `agentOpen` 等
 *    展示字段，这些与"匹配"无关；塞进 quick 的响应会让它职责变浑。
 *
 * 两者共用 `lib/matching/quick.ts` 的同一套评分逻辑（`scoreAll`），
 * 所以分数不会对不上 —— 区别只在"要不要排序截断"和"带不带展示字段"。
 */
export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId");
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }

  const data = await buildDiscover(personaId);
  if (!data.total) {
    return NextResponse.json(
      { ok: false, error: "人设不存在，或候选池为空" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, ...data });
}
