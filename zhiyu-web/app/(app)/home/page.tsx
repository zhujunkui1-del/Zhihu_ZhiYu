import { redirect } from "next/navigation";
import { buildHome } from "@/lib/home";
import { resolveIdentity } from "@/lib/auth/current-user";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

/**
 * 首页：人格总览 + Agent 匹配进行中 + 发现预览 + 通知，四块一次查完。
 *
 * 身份来自 `resolveIdentity()`：优先 HttpOnly 会话，生产环境无会话则跳登录页。
 * `?personaId=` 仍可用于切换查看的人设（看他人人格卡是产品功能）。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string }>;
}) {
  const sp = await searchParams;

  const me = await resolveIdentity({ queryPersonaId: sp.personaId ?? null });
  if (!me?.personaId) redirect("/");

  const data = await buildHome(me.personaId, me.userId);
  /* 人设存在但装配失败（理论上不会）时回登录页，而不是渲染半个页面 */
  if (!data) redirect("/");

  return <HomeClient data={data} personaId={me.personaId} userId={me.userId} />;
}
