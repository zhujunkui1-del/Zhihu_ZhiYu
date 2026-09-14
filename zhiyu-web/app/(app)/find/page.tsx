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
 * 身份来自 `resolveIdentity()`（HttpOnly 会话）。
 * 注意这里用的是 `ownPersonaId` —— 发现页永远是"以**我自己**为中心找别人"，
 * 不受 URL 上任何 persona 参数影响。
 */
export default async function FindPage() {
  const me = await resolveIdentity();
  if (!me?.ownPersonaId) redirect("/");

  const data = await buildDiscover(me.ownPersonaId);

  return <DiscoverClient data={data} personaId={me.ownPersonaId} />;
}
