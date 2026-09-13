/**
 * 当前登录身份解析（页面与 API 的统一入口）。
 *
 * 为什么需要它：在此之前 6 个页面各自 `?userId=` 优先、缺失时回退 `username: "demo"`。
 * 这意味着**带上别人的 userId 就能读到对方的通知与设置** —— 评审或任何访客都能试。
 * OAuth 会话早就实现了（`lib/auth/session.ts`），只是页面没用它。
 *
 * 本模块把它们统一成一条链：
 *   ① 读 HttpOnly 会话 Cookie → 有则用真实登录用户（生产唯一合法来源）
 *   ② 没有会话时，**仅在非生产环境**回退到演示用户（保证本地与演示可用）
 *   ③ 生产环境没有会话 → 返回 null，由调用方跳登录页
 *
 * 关于 `?userId=`：保留但**只在非生产环境生效**，仅用于本地调试与自动化验证。
 * 生产环境忽略该参数（否则等于任意用户可冒充他人）。
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, getSession } from "@/lib/auth/session";

export interface CurrentIdentity {
  userId: string;
  personaId: string | null;
  /** 身份来源，便于页面提示与排查 */
  source: "session" | "demo" | "query-dev";
  displayName: string | null;
  /** 是否已通过知乎 OAuth 授权 */
  zhihuAuthorized: boolean;
}

const isProd = () => process.env.NODE_ENV === "production";

/** 演示用户（本地与预发用；生产不会走到） */
async function demoIdentity(): Promise<CurrentIdentity | null> {
  const demo = await prisma.user.findUnique({
    where: { username: "demo" },
    include: { persona: { select: { id: true } } },
  });
  if (!demo) return null;
  return {
    userId: demo.id,
    personaId: demo.persona?.id ?? null,
    source: "demo",
    displayName: demo.displayName,
    zhihuAuthorized: demo.zhihuAuthorized,
  };
}

/**
 * 解析当前身份。
 *
 * @param opts.queryUserId 仅在非生产环境生效的调试用 userId
 * @param opts.queryPersonaId 选择要看哪个人设（查看他人人格卡是正常功能）
 */
export async function resolveIdentity(opts?: {
  queryUserId?: string | null;
  queryPersonaId?: string | null;
}): Promise<CurrentIdentity | null> {
  /* ① 真实会话优先 —— 生产环境唯一合法来源 */
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await getSession(token);
    if (s) {
      const persona = await prisma.persona.findUnique({
        where: { userId: s.userId },
        select: { id: true },
      });
      return {
        userId: s.userId,
        /* 允许看别人的 persona（查看他人人格卡是产品功能），
           但身份仍然是会话里的那个人 */
        personaId: opts?.queryPersonaId ?? persona?.id ?? null,
        source: "session",
        displayName: s.displayName,
        zhihuAuthorized: s.zhihuAuthorized,
      };
    }
  }

  /* ② 非生产环境：允许 ?userId= 调试（自动化验证需要） */
  if (!isProd() && opts?.queryUserId) {
    const u = await prisma.user.findUnique({
      where: { id: opts.queryUserId },
      include: { persona: { select: { id: true } } },
    });
    if (u) {
      return {
        userId: u.id,
        personaId: opts?.queryPersonaId ?? u.persona?.id ?? null,
        source: "query-dev",
        displayName: u.displayName,
        zhihuAuthorized: u.zhihuAuthorized,
      };
    }
  }

  /* ③ 非生产环境：回退演示用户，保证本地开箱可用 */
  if (!isProd()) {
    const demo = await demoIdentity();
    if (demo) {
      return { ...demo, personaId: opts?.queryPersonaId ?? demo.personaId };
    }
  }

  /* ④ 生产环境且无会话 → 未登录 */
  return null;
}

/** API 路由用：解析身份，未登录时直接给出 401 响应体 */
export async function requireIdentity(opts?: { queryUserId?: string | null }) {
  const id = await resolveIdentity(opts);
  if (!id) {
    return {
      ok: false as const,
      status: 401 as const,
      body: { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
    };
  }
  return { ok: true as const, identity: id };
}
