/**
 * 已授权平台账号的存取。
 *
 * token 一律 `encryptSecret()` 加密后落库（AES-256-GCM，见 lib/crypto.ts），
 * **不进 Cookie、不进日志、不返回给前端**。
 */

import { prisma } from "@/lib/db";
import { decryptFor, encryptFor } from "@/lib/crypto-box";
import type { OAuthProvider } from "./platforms";
import type { TokenSet } from "./clients";

/**
 * 第三方账号 token 的加解密。
 *
 * ⚠️ 密钥域用 `zhihu-oauth-token`（即 OAuth token 域），**不是** `llm-key`。
 * `lib/crypto-box.ts` 的注释写明：分域的意义是"不同敏感级别、不同撤销周期
 * 的东西可以单独轮换"。之前图省事调了 `encryptSecret`（BYOK 域），
 * 属于把两个域混用 —— 一旦要轮换 BYOK 密钥，会连带把所有人的平台授权弄失效。
 *
 * 读取时**回落旧域**：早期那几行是用 `llm-key` 域写的，直接换域会让已授权的
 * 用户被迫重新授权。新写入一律用新域，旧密文读得出来就继续用。
 */
function encryptToken(plain: string): string {
  return encryptFor("zhihu-oauth-token", plain);
}

function decryptToken(payload: string): string {
  try {
    return decryptFor("zhihu-oauth-token", payload);
  } catch {
    /* 兼容早期用 BYOK 密钥域写入的密文 */
    return decryptFor("llm-key", payload);
  }
}

export { encryptToken, decryptToken };

export interface LinkedAccountView {
  provider: OAuthProvider;
  displayName: string | null;
  externalId: string | null;
  /** 是否已过期（过期就该重新授权，不静默降级） */
  expired: boolean;
  expiresAt: Date | null;
  updatedAt: Date;
}

export async function saveLinkedAccount(
  userId: string,
  provider: OAuthProvider,
  tokens: TokenSet,
): Promise<void> {
  const expiresAt =
    tokens.expiresIn && tokens.expiresIn > 0
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : null;

  const data = {
    displayName: tokens.displayName,
    externalId: tokens.externalId,
    accessTokenEnc: encryptToken(tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
    expiresAt,
  };

  await prisma.linkedAccount.upsert({
    where: { userId_provider: { userId, provider } },
    update: data,
    create: { userId, provider, ...data },
  });
}

/**
 * 读回可用 token；已过期时 `expired: true`（调用方提示重新授权）。
 *
 * 同时带回 `displayName`（平台上的昵称）—— 同步时要用它做搜索关键词
 * （飞书文档搜索、钉钉文档搜索都按名字查），所以一次读出来，省一次查询。
 */
export async function readAccessToken(
  userId: string,
  provider: OAuthProvider,
): Promise<{
  token: string;
  externalId: string | null;
  displayName: string | null;
  expired: boolean;
} | null> {
  const row = await prisma.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!row) return null;
  const expired = row.expiresAt != null && row.expiresAt.getTime() < Date.now();
  let token = "";
  try {
    token = decryptToken(row.accessTokenEnc);
  } catch {
    /* 解密失败（密钥换过）→ 当作没有授权，引导重新授权，而不是抛 500 */
    return { token: "", externalId: row.externalId, displayName: row.displayName, expired: true };
  }
  return { token, externalId: row.externalId, displayName: row.displayName, expired };
}

export async function listLinkedAccounts(userId: string): Promise<LinkedAccountView[]> {
  const rows = await prisma.linkedAccount.findMany({ where: { userId } });
  return rows.map((r) => ({
    provider: r.provider as OAuthProvider,
    displayName: r.displayName,
    externalId: r.externalId,
    expired: r.expiresAt != null && r.expiresAt.getTime() < Date.now(),
    expiresAt: r.expiresAt,
    updatedAt: r.updatedAt,
  }));
}

export async function unlinkAccount(userId: string, provider: OAuthProvider): Promise<void> {
  await prisma.linkedAccount.deleteMany({ where: { userId, provider } });
}

/**
 * 用户手工提供的**私聊会话 ID**（飞书 `oc_...`）。
 *
 * 为什么需要用户给：飞书没有任何"列出我的私聊"的接口，
 * `GET /im/v1/chats` 只返回群聊。官方文档《群 ID 说明》给的办法之一，
 * 是让用户在**飞书客户端（≥7.60）打开该私聊 → 右上角设置 → 复制群 ID**
 * —— 零打扰、不需要机器人能力。另一条路（让机器人给对方发消息换 chat_id）
 * 会在对方聊天框留痕，本站不做。
 *
 * 存 `LinkedAccount.meta.p2pChatIds`：与已有授权绑在一起，
 * 重新授权不会丢（saveLinkedAccount 只更新 token 字段）。
 */
export async function readP2pChatIds(
  userId: string,
  provider: OAuthProvider,
): Promise<string[]> {
  const row = await prisma.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { meta: true },
  });
  const meta = (row?.meta ?? null) as Record<string, unknown> | null;
  const list = meta?.p2pChatIds;
  return Array.isArray(list)
    ? list.filter((x): x is string => typeof x === "string" && /^oc_[A-Za-z0-9]+$/.test(x))
    : [];
}

/**
 * 保存私聊会话 ID（只留合法形状的，去重，上限 50 条）。
 *
 * ⚠️ 私聊 ID 是挂在**已授权账号**上的。未授权时没有行可写 ——
 * 之前直接 `update` 会抛 P2025（记录不存在），route 变成 500 空响应，
 * 前端只看到 "Unexpected end of JSON input"（e2e 实测抓到）。
 * 所以这里先判存在，不存在就返回 `linked: false` 让调用方给出人话提示。
 */
export async function saveP2pChatIds(
  userId: string,
  provider: OAuthProvider,
  ids: string[],
): Promise<{ linked: boolean; saved: string[] }> {
  const clean = [
    ...new Set(
      ids
        .map((s) => s.trim())
        .filter((s) => /^oc_[A-Za-z0-9]+$/.test(s)),
    ),
  ].slice(0, 50);

  const row = await prisma.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider } },
    select: { meta: true },
  });
  if (!row) return { linked: false, saved: [] };

  const meta = ((row.meta ?? {}) as Record<string, unknown>) ?? {};
  await prisma.linkedAccount.update({
    where: { userId_provider: { userId, provider } },
    data: { meta: { ...meta, p2pChatIds: clean } as never },
  });
  return { linked: true, saved: clean };
}
