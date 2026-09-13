import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildHome } from "@/lib/home";
import HomeClient from "./HomeClient";

export const dynamic = "force-dynamic";

/**
 * 首页：人格总览 + Agent 匹配进行中 + 发现预览 + 通知，四块一次查完。
 *
 * Server Component 负责取数，交互（换一批、跳转、退出）交给 HomeClient。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string }>;
}) {
  const sp = await searchParams;

  /* 演示阶段：优先用 URL 传入，其次回退到 demo 用户 */
  let personaId = sp.personaId;
  let userId: string | undefined;

  if (personaId) {
    const p = await prisma.persona.findUnique({
      where: { id: personaId },
      select: { userId: true },
    });
    userId = p?.userId ?? undefined;
  }

  if (!personaId || !userId) {
    const demo = await prisma.user.findUnique({
      where: { username: "demo" },
      include: { persona: true },
    });
    personaId = demo?.persona?.id;
    userId = demo?.id;
  }

  if (!personaId || !userId) redirect("/");

  const data = await buildHome(personaId, userId);

  return <HomeClient data={data} personaId={personaId} userId={userId} />;
}
