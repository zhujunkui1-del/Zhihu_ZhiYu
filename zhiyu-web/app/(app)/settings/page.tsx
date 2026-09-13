import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildPersonaBoard, type PersonaBoard } from "@/lib/persona-view";
import { encryptionStatus } from "@/lib/crypto-box";
import SettingsClient, { type Prefs } from "./SettingsClient";

export const dynamic = "force-dynamic";

/**
 * 设置页。
 *
 * 四区：① 身份与数据源　② Agent 沟通偏好　③ AI 大模型接入　④ 账号与退出
 *
 * 会话：`?userId=` 优先，缺失时回退 demo 用户；接 OAuth 后改读 HttpOnly Cookie。
 * 说明：加密密钥的配置状态也在服务端读，用于给 BYOK 区一个**明确**提示
 * （"未配置加密密钥"比"保存失败"有用得多）。
 */
export default async function SettingsPage({
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

  const [user, board, prefsRow, llmCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    personaId ? buildPersonaBoard(personaId) : Promise.resolve(null),
    prisma.communicationPrefs.findUnique({ where: { userId } }),
    prisma.llmProviderConfig.count({ where: { userId } }),
  ]);

  if (!user) redirect("/");

  const boardOrNull: PersonaBoard | null = board;
  const prefs: Prefs = {
    allowAgentInvite: prefsRow?.allowAgentInvite ?? true,
    showSimilarity: prefsRow?.showSimilarity ?? true,
    allowReportDelivery: prefsRow?.allowReportDelivery ?? true,
  };
  const enc = encryptionStatus();

  return (
    <SettingsClient
      userId={userId}
      personaId={personaId ?? ""}
      displayName={user.displayName ?? "演示用户"}
      zhihuAuthorized={user.zhihuAuthorized}
      zhihuHashId={user.zhihuHashId}
      board={boardOrNull}
      prefs={prefs}
      llmCount={llmCount}
      encryptionOk={enc.ok}
      encryptionMissing={enc.missing}
    />
  );
}
