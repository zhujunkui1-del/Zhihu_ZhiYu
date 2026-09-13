import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildAgentMatch } from "@/lib/agent-match";
import AgentMatchClient from "./AgentMatchClient";

export const dynamic = "force-dynamic";

/**
 * Agent 匹配页。
 *
 * 两个页签：「认识中」列出进行中的会话，「匹配报告」列出已出报告的。
 * 后端逻辑（真 LLM 对话 + Judge + Mock 兜底）都在
 * `/api/matches/[id]/start`，本页**只读不跑**，所以进来不会触发新的对话。
 */
export default async function AgentMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string; matchId?: string }>;
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

  const data = await buildAgentMatch(personaId);

  return (
    <AgentMatchClient
      data={data}
      personaId={personaId}
      /* 从通知 / 首页跳进来时可以指定要展开的那一条 */
      focusMatchId={sp.matchId ?? null}
    />
  );
}
