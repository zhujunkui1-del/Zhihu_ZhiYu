import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildNotify } from "@/lib/notify";
import NotifyClient from "./NotifyClient";

export const dynamic = "force-dynamic";

/**
 * 通知中心。
 *
 * 会话：与其它受保护页一致，`?userId=` 优先，缺失时回退到 demo 用户。
 * 接入知乎 OAuth 后改为读 HttpOnly 会话 Cookie。
 */
export default async function NotifyPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; personaId?: string }>;
}) {
  const sp = await searchParams;

  let userId = sp.userId;
  let personaId = sp.personaId;

  if (!userId) {
    const demo = await prisma.user.findUnique({
      where: { username: "demo" },
      include: { persona: true },
    });
    userId = demo?.id;
    personaId = personaId ?? demo?.persona?.id;
  }
  if (!userId) redirect("/");

  const data = await buildNotify(userId);

  return <NotifyClient data={data} userId={userId} personaId={personaId ?? ""} />;
}
