import { redirect } from "next/navigation";
import { buildNotify } from "@/lib/notify";
import { resolveIdentity } from "@/lib/auth/current-user";
import NotifyClient from "./NotifyClient";

export const dynamic = "force-dynamic";

/**
 * 通知中心。
 *
 * 身份来自 `resolveIdentity()`：优先 HttpOnly 会话，
 * 生产环境无会话则跳登录页（不再接受 `?userId=`，避免冒用他人身份）。
 */
export default async function NotifyPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; personaId?: string }>;
}) {
  const sp = await searchParams;

  const me = await resolveIdentity({
    queryUserId: sp.userId ?? null,
    queryPersonaId: sp.personaId ?? null,
  });
  if (!me) redirect("/");

  const data = await buildNotify(me.userId);

  return (
    <NotifyClient data={data} userId={me.userId} personaId={me.personaId ?? ""} />
  );
}
