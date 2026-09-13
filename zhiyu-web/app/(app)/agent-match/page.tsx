import { redirect } from "next/navigation";
import { buildAgentMatch } from "@/lib/agent-match";
import { resolveIdentity } from "@/lib/auth/current-user";
import AgentMatchClient from "./AgentMatchClient";

export const dynamic = "force-dynamic";

/**
 * Agent 匹配页。
 *
 * 两个页签：「认识中」列出进行中的会话，「匹配报告」列出已出报告的。
 * 后端逻辑（真 LLM 对话 + Judge + Mock 兜底）都在
 * `/api/matches/[id]/start`，本页**只读不跑**，所以进来不会触发新的对话。
 *
 * 身份来自 `resolveIdentity()`：优先 HttpOnly 会话，生产环境无会话则跳登录页。
 */
export default async function AgentMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ personaId?: string; matchId?: string }>;
}) {
  const sp = await searchParams;

  const me = await resolveIdentity({ queryPersonaId: sp.personaId ?? null });
  if (!me?.personaId) redirect("/");

  const data = await buildAgentMatch(me.personaId);

  return (
    <AgentMatchClient
      data={data}
      personaId={me.personaId}
      /* 从通知 / 首页跳进来时可以指定要展开的那一条 */
      focusMatchId={sp.matchId ?? null}
    />
  );
}
