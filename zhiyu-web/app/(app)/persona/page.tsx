import { redirect } from "next/navigation";
import { buildPersonaBoard } from "@/lib/persona-view";
import { questions } from "@/lib/sbti/scoring";
import { resolveIdentity } from "@/lib/auth/current-user";
import PersonaClient from "./PersonaClient";

export const dynamic = "force-dynamic";

/**
 * 我的人格。
 *
 * Server Component 取数 + 直接传题库。
 * 题库是从 `lib/sbti/scoring` 静态导入的，**不需要客户端再 fetch** ——
 * 于是 SBTI 测试没有"题库加载中"这个中间态，点开即可答题。
 *
 * 两种进入方式：
 *   /persona?personaId=…  看我自己的人格卡
 *   /persona?id=…         看别人的人格卡（发现页/雷达点进来）
 * 后者只读，不显示注入/蒸馏这些对自己才有的操作。
 *
 * 身份来自 `resolveIdentity()`：优先 HttpOnly 会话；`?id=` 只是"要看哪张卡"，
 * 决定 `isSelf` 的是**会话身份**（避免用 query 把自己伪装成别人）。
 */
export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string; id?: string }>;
}) {
  const sp = await searchParams;

  const targetId = sp.id ?? sp.personaId ?? null;
  const me = await resolveIdentity({ queryPersonaId: targetId });

  /* 自己那一侧必须有自己的 persona；看别人时只要目标存在即可 */
  const viewId = targetId ?? me?.personaId ?? null;
  if (!viewId) redirect("/");

  const board = await buildPersonaBoard(viewId);
  if (!board) redirect("/");

  const isSelf = Boolean(me?.personaId && viewId === me.personaId);

  /* 题库只在"自己"这一侧需要（别人的人格卡不能重测） */
  const bank = isSelf
    ? questions.map((q) => ({
        id: q.id,
        dim: q.dim,
        dimName: q.dimName,
        text: q.text,
        options: q.options.map((o) => ({ key: o.key, text: o.text })),
      }))
    : [];

  return <PersonaClient board={board} bank={bank} isSelf={isSelf} />;
}
