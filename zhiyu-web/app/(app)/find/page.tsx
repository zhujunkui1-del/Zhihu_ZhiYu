import { redirect } from "next/navigation";
import { buildDiscover } from "@/lib/discover";
import { prisma } from "@/lib/db";
import DiscoverClient from "./DiscoverClient";

export const dynamic = "force-dynamic";

/**
 * 发现页。
 *
 * 渲染方式：Server Component 负责**取数与鉴权**，交互（筛选、切换视图、雷达）
 * 全部交给 `DiscoverClient`。这样首屏就带完整数据，不需要客户端再打一次接口，
 * 也不会出现"先空后闪"。
 *
 * 会话：与其他受保护页面一致，用 `?personaId=` 传入（演示阶段）；
 * 缺失时回退到 demo 用户，避免手输 URL 就掉登录页。
 * 接入知乎 OAuth 后改为读 HttpOnly 会话 Cookie。
 */
export default async function FindPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string }>;
}) {
  const sp = await searchParams;
  let personaId = sp.personaId;

  if (!personaId) {
    const demo = await prisma.user.findUnique({
      where: { username: "demo" },
      include: { persona: true },
    });
    personaId = demo?.persona?.id;
  }
  if (!personaId) redirect("/");

  const data = await buildDiscover(personaId);

  return <DiscoverClient data={data} personaId={personaId} />;
}
