/**
 * 应用会话与 OAuth state 的服务端管理。
 *
 * 落库而非进程内 Map：本项目部署在 Vercel（Serverless、多实例），
 * 进程内存储无法跨实例共享，请求落到另一个实例就会"登录态消失"。
 *
 * 分工：
 *   · 浏览器只拿一个不可猜的 `token`（HttpOnly + Secure + SameSite=Lax Cookie）
 *   · 知乎的 access_token 加密后留在服务端，**永不下发到浏览器**
 */

import { prisma } from "@/lib/db";
import { decryptFor, encryptFor } from "@/lib/crypto-box";
import { newSessionToken, newState } from "./zhihu-oauth";
import { SESSION_COOKIE, SESSION_DAYS } from "./cookie";

/* Cookie 属性集中在 ./cookie（无依赖，便于单独测试），这里转出去，
   调用方仍然可以只从 session 引入，不必知道文件是怎么切的。 */
export { SESSION_COOKIE, SESSION_DAYS, sessionCookieOptions, clearedSessionCookieOptions } from "./cookie";
/** state 有效期：10 分钟（够用户登录并点同意） */
const STATE_MINUTES = 10;
/** 会话滑动续期的最小间隔，避免每个请求都写库 */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/* ── 会话 ───────────────────────────────────────────────────────────────── */

export interface SessionUser {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  zhihuAuthorized: boolean;
  /** access_token 是否仍在有效期内 */
  zhihuTokenValid: boolean;
}

/**
 * 新建一个会话，返回要写进 Cookie 的 token 明文。
 * 库里只存 token 本身（它是随机的，本身不是密钥材料），
 * 但 access_token 一定加密存。
 */
export async function createSession(params: {
  userId: string;
  zhihuToken?: string | null;
  tokenExpiresIn?: number | null;
}): Promise<string> {
  const token = newSessionToken();
  const now = Date.now();
  await prisma.authSession.create({
    data: {
      token,
      userId: params.userId,
      zhihuTokenEnc: params.zhihuToken ? encryptFor("zhihu-oauth-token", params.zhihuToken) : null,
      tokenExpiresAt:
        params.zhihuToken && typeof params.tokenExpiresIn === "number"
          ? new Date(now + params.tokenExpiresIn * 1000)
          : null,
      expiresAt: new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

/** 按 Cookie token 取会话；顺带做滑动续期与过期清理 */
export async function getSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const s = await prisma.authSession.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!s) return null;

  /* 会话过期：直接删掉，不静默续命 */
  if (s.expiresAt.getTime() <= Date.now()) {
    await prisma.authSession.delete({ where: { id: s.id } }).catch(() => undefined);
    return null;
  }

  /* 滑动续期（低频写入） */
  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.authSession
      .update({
        where: { id: s.id },
        data: {
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
        },
      })
      .catch(() => undefined);
  }

  const tokenValid = Boolean(s.tokenExpiresAt && s.tokenExpiresAt.getTime() > Date.now());
  return {
    userId: s.userId,
    displayName: s.user.displayName,
    avatarUrl: s.user.avatarUrl,
    zhihuAuthorized: s.user.zhihuAuthorized,
    zhihuTokenValid: tokenValid,
  };
}

/**
 * 取会话里的知乎 access_token 明文。
 *
 * token 过期或鉴权失败时**停止读取**，不静默切换到 Access Secret 所属账号
 * —— 这是规格里的硬要求。
 */
export async function getZhihuToken(token: string): Promise<string | null> {
  const s = await prisma.authSession.findUnique({ where: { token } });
  if (!s?.zhihuTokenEnc) return null;
  if (s.tokenExpiresAt && s.tokenExpiresAt.getTime() <= Date.now()) return null;
  try {
    return decryptFor("zhihu-oauth-token", s.zhihuTokenEnc);
  } catch {
    return null;
  }
}

/** 退出：删除该会话（浏览器 Cookie 由调用方清除） */
export async function destroySession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.authSession.deleteMany({ where: { token } });
}

/** 清掉某用户全部会话（重新授权、token 失效时用） */
export async function destroyUserSessions(userId: string): Promise<number> {
  const r = await prisma.authSession.deleteMany({ where: { userId } });
  return r.count;
}

/* ── OAuth state ────────────────────────────────────────────────────────── */

/** 生成并保存 state，绑定发起时的会话 token */
export async function issueState(params: {
  sessionToken?: string | null;
  returnTo?: string | null;
}): Promise<string> {
  const state = newState();
  await prisma.oAuthState.create({
    data: {
      state,
      sessionToken: params.sessionToken ?? null,
      returnTo: params.returnTo ?? null,
      expiresAt: new Date(Date.now() + STATE_MINUTES * 60 * 1000),
    },
  });
  /* 顺手清理过期 state，避免表无限增长 */
  await prisma.oAuthState
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
    .catch(() => undefined);
  return state;
}

export type StateCheck =
  | { ok: true; returnTo: string | null; sessionToken: string | null }
  | { ok: false; reason: "missing" | "mismatch" | "expired" | "consumed" };

/**
 * 校验并**原子消费** state。
 *
 * 为什么要原子：回调可能被重复投递（用户刷新、浏览器预取），
 * 若不消费就能反复用同一个 state 换 token，等于失去防重放能力。
 * 这里用「条件更新」实现：只有当 `consumedAt` 仍为 null 时才写入，
 * 并发情况下只有一个请求会真正改到行（updateMany 返回 count）。
 */
export async function consumeState(returned: string | null | undefined): Promise<StateCheck> {
  if (!returned) return { ok: false, reason: "missing" };

  /* 先看存在性与有效性，再尝试原子消费 */
  const row = await prisma.oAuthState.findUnique({ where: { state: returned } });
  if (!row) return { ok: false, reason: "mismatch" };
  if (row.consumedAt) return { ok: false, reason: "consumed" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

  const claimed = await prisma.oAuthState.updateMany({
    where: { state: returned, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, reason: "consumed" };

  return { ok: true, returnTo: row.returnTo, sessionToken: row.sessionToken };
}
