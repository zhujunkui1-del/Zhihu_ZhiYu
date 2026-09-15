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

/**
 * 「幂等重放」窗口：同一个 state 在成功换到会话后多久内允许原样重放。
 *
 * 手机端回调被请求第二次是常态（下拉刷新、预取、前进后退、扫码重复打开），
 * 而授权码是一次性的 —— 第二次必然失败。在这段时间内把第一次的结果
 * 原样再给一次，用户就不会看到「授权状态校验失败」。
 */
export const STATE_REPLAY_MS = 5 * 60 * 1000;

export type StateFailure = {
  ok: false;
  reason: "missing" | "mismatch" | "expired" | "consumed";
  /** 这个 state 在库里是否真实存在（missing 恒为 false） */
  exists: boolean;
  /** 发起授权时的目标路径，重放时照旧跳回 */
  returnTo: string | null;
  /** 上一次成功换到的会话 token（仅 consumed 且当时成功过才有） */
  resultSessionToken: string | null;
  /** 距离上一次消费过去了多久（毫秒），无法判断时为 null */
  consumedAgoMs: number | null;
};

export type StateCheck =
  | { ok: true; returnTo: string | null; sessionToken: string | null }
  | StateFailure;

/**
 * 校验并**原子消费** state。
 *
 * 为什么要原子：回调可能被重复投递（用户刷新、浏览器预取），
 * 若不消费就能反复用同一个 state 换 token，等于失去防重放能力。
 * 这里用「条件更新」实现：只有当 `consumedAt` 仍为 null 时才写入，
 * 并发情况下只有一个请求会真正改到行（updateMany 返回 count）。
 */
export async function consumeState(returned: string | null | undefined): Promise<StateCheck> {
  const none = (reason: StateFailure["reason"], exists: boolean, returnTo: string | null): StateFailure => ({
    ok: false,
    reason,
    exists,
    returnTo,
    resultSessionToken: null,
    consumedAgoMs: null,
  });

  if (!returned) return none("missing", false, null);

  /* 先看存在性与有效性，再尝试原子消费 */
  const row = await prisma.oAuthState.findUnique({ where: { state: returned } });
  if (!row) return none("mismatch", false, null);
  const consumed = (): StateFailure => ({
    ok: false,
    reason: "consumed",
    exists: true,
    returnTo: row.returnTo,
    resultSessionToken: row.resultSessionToken,
    consumedAgoMs: row.consumedAt ? Date.now() - row.consumedAt.getTime() : null,
  });
  if (row.consumedAt) return consumed();
  if (row.expiresAt.getTime() <= Date.now()) return none("expired", true, row.returnTo);

  const claimed = await prisma.oAuthState.updateMany({
    where: { state: returned, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count !== 1) {
    /* 并发：另一个请求抢先消费了。重读一次拿它的结果，仍可能救回这次回调 */
    const again = await prisma.oAuthState.findUnique({ where: { state: returned } });
    if (!again) return none("consumed", true, row.returnTo);
    return {
      ok: false,
      reason: "consumed",
      exists: true,
      returnTo: again.returnTo,
      resultSessionToken: again.resultSessionToken,
      consumedAgoMs: again.consumedAt ? Date.now() - again.consumedAt.getTime() : null,
    };
  }

  return { ok: true, returnTo: row.returnTo, sessionToken: row.sessionToken };
}

/** 授权成功后把会话 token 记回 state 行，供重复回调幂等重放 */
export async function saveStateResult(state: string, sessionToken: string): Promise<void> {
  await prisma.oAuthState
    .updateMany({ where: { state }, data: { resultSessionToken: sessionToken } })
    .catch(() => undefined);
}

export type StateAction =
  /** 正常往下走：换 code、建会话 */
  | { kind: "proceed" }
  /** 这个 state 之前已经成功过一次 → 直接复用那次的会话 */
  | { kind: "replay"; sessionToken: string }
  /** 拒绝：回登录页带 state_<reason> */
  | { kind: "reject"; reason: string };

/**
 * 拿到 `consumeState` 的结果后该干什么 —— 纯函数，便于单测。
 *
 * 规则：
 *   · 校验通过 → proceed
 *   · 没带 state（平台不回传的已知兼容路径）→ proceed
 *   · 已消费、但当时确实成功过、且在重放窗口内 → replay（幂等）
 *   · 其余不匹配 / 过期 / 重放超窗 → reject
 */
export function decideStateAction(
  check: StateCheck,
  opts: { now?: number; replayMs?: number; sessionAlive?: boolean } = {},
): StateAction {
  if (check.ok) return { kind: "proceed" };
  if (check.reason === "missing") return { kind: "proceed" };
  if (check.reason !== "consumed") return { kind: "reject", reason: `state_${check.reason}` };

  const replayMs = opts.replayMs ?? STATE_REPLAY_MS;
  const fresh = check.consumedAgoMs !== null && check.consumedAgoMs <= replayMs;
  if (check.resultSessionToken && fresh && opts.sessionAlive !== false) {
    return { kind: "replay", sessionToken: check.resultSessionToken };
  }
  return { kind: "reject", reason: `state_${check.reason}` };
}
