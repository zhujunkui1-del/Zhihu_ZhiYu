import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildPersonaBoard, type PersonaBoard } from "@/lib/persona-view";
import { encryptionStatus } from "@/lib/crypto-box";
import { resolveIdentity } from "@/lib/auth/current-user";
import { platformAvailability } from "@/lib/llm/platform";
import SettingsClient, { type Prefs } from "./SettingsClient";

export const dynamic = "force-dynamic";

/**
 * 设置页。
 *
 * 四区：① 身份与数据源　② Agent 沟通偏好　③ AI 大模型接入　④ 账号与退出
 *
 * 身份只来自 `resolveIdentity()`（HttpOnly 会话），用 `ownPersonaId`。
 * 加密密钥的配置状态在服务端读，用于给 BYOK 区一个**明确**提示
 * （"未配置加密密钥"比"保存失败"有用得多）。
 */
export default async function SettingsPage() {
  const me = await resolveIdentity();
  if (!me) redirect("/");

  const [user, board, prefsRow, llmCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: me.userId } }),
    me.ownPersonaId ? buildPersonaBoard(me.ownPersonaId) : Promise.resolve(null),
    prisma.communicationPrefs.findUnique({ where: { userId: me.userId } }),
    prisma.llmProviderConfig.count({ where: { userId: me.userId } }),
  ]);

  if (!user) redirect("/");

  const boardOrNull: PersonaBoard | null = board;
  const prefs: Prefs = {
    allowAgentInvite: prefsRow?.allowAgentInvite ?? true,
    showSimilarity: prefsRow?.showSimilarity ?? true,
    allowReportDelivery: prefsRow?.allowReportDelivery ?? true,
    usePlatformLlm: prefsRow?.usePlatformLlm ?? true,
  };
  const enc = encryptionStatus();
  /* 免费额度的截止日与剩余天数由服务端算好，避免客户端时区/时间不同导致文案不一致 */
  const platform = platformAvailability();

  return (
    <SettingsClient
      userId={me.userId}
      personaId={me.ownPersonaId ?? ""}
      displayName={user.displayName ?? "演示用户"}
      zhihuAuthorized={user.zhihuAuthorized}
      zhihuHashId={user.zhihuHashId}
      board={boardOrNull}
      prefs={prefs}
      llmCount={llmCount}
      encryptionOk={enc.ok}
      encryptionMissing={enc.missing}
      platform={{
        configured: platform.configured,
        freeOpen: platform.freeOpen,
        usable: platform.usable,
        freeUntil: platform.freeUntil,
        daysLeft: platform.daysLeft,
      }}
    />
  );
}
