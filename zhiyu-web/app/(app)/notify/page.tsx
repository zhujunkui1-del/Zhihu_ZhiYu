import { redirect } from "next/navigation";
import { buildNotify } from "@/lib/notify";
import { resolveIdentity } from "@/lib/auth/current-user";
import NotifyClient from "./NotifyClient";

export const dynamic = "force-dynamic";

/**
 * 通知中心。
 *
 * 身份**只**来自 `resolveIdentity()`（HttpOnly 会话；非生产环境可回退演示用户）。
 * 不接受 `?userId=` —— 那是水平越权（换 id 就能读别人通知）。
 * `?personaId=` 仍保留，它只决定"看哪个人格卡"，不涉及身份。
 */
export default async function NotifyPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string }>;
}) {
  const sp = await searchParams;

  const me = await resolveIdentity({ queryPersonaId: sp.personaId ?? null });
  if (!me) redirect("/");

  const data = await buildNotify(me.userId);

  return (
    <NotifyClient data={data} userId={me.userId} personaId={me.personaId ?? ""} />
  );
}
