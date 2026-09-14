import { redirect } from "next/navigation";
import { buildPersonaBoard } from "@/lib/persona-view";
import { questions } from "@/lib/sbti/scoring";
import { resolveIdentity } from "@/lib/auth/current-user";
import PersonaClient from "./PersonaClient";

export const dynamic = "force-dynamic";

/**
 * 人格卡页。
 *
 * 两种进入方式：
 *   /persona            看**我自己**的人格卡（可注入数据、可重测 SBTI）
 *   /persona?id=…       看**别人**的人格卡（只读，发现页/雷达点进来）
 *
 * ⚠️ `isSelf` 必须比较「要看的 id」与「**我自己的** persona id」。
 * 曾经把这两个概念合成一个字段，导致 `?id=<别人>` 时自己那一份也被覆盖成对方，
 * 于是 `isSelf` 恒为 true —— 看任何人的人格卡都显示成「我的人格」。
 * 现在身份里 `ownPersonaId`（我是谁）与 `viewPersonaId`（看谁）是分开的。
 */
export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string; id?: string }>;
}) {
  const sp = await searchParams;

  /* 要看谁：?id= 优先（看别人），否则看我自己的 */
  const requested = sp.id ?? sp.personaId ?? null;
  const me = await resolveIdentity({ queryPersonaId: requested });

  const viewId = me?.viewPersonaId ?? requested;
  if (!viewId) redirect("/");

  const board = await buildPersonaBoard(viewId);
  if (!board) redirect("/");

  /* 只有「要看的就是我自己」时才是本人视角 */
  const isSelf = Boolean(me?.ownPersonaId && viewId === me.ownPersonaId);

  /* 题库只在本人视角需要（别人的人格卡不能重测） */
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
