import { redirect } from "next/navigation";
import { buildHome } from "@/lib/home";
import { resolveIdentity } from "@/lib/auth/current-user";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

/**
 * 首页：人格总览 + Agent 匹配进行中 + 发现预览 + 通知，四块一次查完。
 *
 * 身份来自 `resolveIdentity()`（HttpOnly 会话）。
 * 用 `ownPersonaId` —— 首页永远是"我自己的"总览，
 * 不受 URL 上任何 persona 参数影响。
 */
export default async function HomePage() {
  const me = await resolveIdentity();
  if (!me?.ownPersonaId) redirect("/");

  const data = await buildHome(me.ownPersonaId, me.userId);
  /* 人设存在但装配失败（理论上不会）时回登录页，而不是渲染半个页面 */
  if (!data) redirect("/");

  return <HomeClient data={data} personaId={me.ownPersonaId} userId={me.userId} />;
}
