import { redirect } from "next/navigation";
import { buildDiscover } from "@/lib/discover";
import { resolveIdentity } from "@/lib/auth/current-user";
import DiscoverClient from "./DiscoverClient";

export const dynamic = "force-dynamic";

/**
 * 发现页。
 *
 * 渲染方式：Server Component 负责**取数与鉴权**，交互（筛选、切换视图、雷达）
 * 全部交给 `DiscoverClient`。这样首屏就带完整数据，不需要客户端再打一次接口，
 * 也不会出现"先空后闪"。
 *
 * 身份来自 `resolveIdentity()`：优先 HttpOnly 会话，生产环境无会话则跳登录页。
 * `?personaId=` 仍然可用——**看别人的人格卡是产品功能**，但身份始终取自会话。
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string }>;
}) {
  const sp = await searchParams;

  const me = await resolveIdentity({ queryPersonaId: sp.personaId ?? null });
  if (!me?.personaId) redirect("/");

  const data = await buildDiscover(me.personaId);

  return <DiscoverClient data={data} personaId={me.personaId} />;
}
