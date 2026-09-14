/**
 * 当前登录身份解析（页面与 API 的统一入口）。
 *
 * 为什么需要它：在此之前 6 个页面各自 `?userId=` 优先、缺失时回退 `username: "demo"`。
 * 这意味着**带上别人的 userId 就能读到对方的通知与设置** —— 评审或任何访客都能试。
 * OAuth 会话早就实现了（`lib/auth/session.ts`），只是页面没用它。
 *
 * 本模块把它们统一成一条链：
 *   ① 读 HttpOnly 会话 Cookie → 有则用真实登录用户（**唯一**合法身份来源）
 *   ② 没有会话时，仅在非生产环境回退到演示用户（保证本地开箱可用）
 *   ③ 生产环境没有会话 → 返回 null，由调用方跳登录页
 *
 * ⚠️ **不接受任何来自 URL 的身份**（已移除 `?userId=` 支持）。
 *    原因：那是水平越权——换个 id 就能读别人数据。
 *    生产与开发行为一致，避免"本地能跑、线上 401"这类环境差异带来的误判。
 *
 * `?personaId=` / `?id=` 仍然可用：那是「**看哪个人格卡**」，
 * 而看他人人格卡是产品功能（发现页/雷达点进去），不涉及身份冒用。
 */

import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, getSession } from "@/lib/auth/session";

export interface CurrentIdentity {
  userId: string;
  personaId: string | null;
  /** 身份来源，便于页面提示与排查 */
  source: "session" | "demo";
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
 * @param opts.queryPersonaId 选择要看哪个人设（**不是**身份）
 */
export async function resolveIdentity(opts?: {
  queryPersonaId?: string | null;
}): Promise<CurrentIdentity | null> {
  /* ① 真实会话 —— 唯一合法身份来源 */
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
        personaId: opts?.queryPersonaId ?? persona?.id ?? null,
        source: "session",
        displayName: s.displayName,
        zhihuAuthorized: s.zhihuAuthorized,
      };
    }
  }

  /* ② 非生产环境：回退演示用户，保证本地开箱可用 */
  if (!isProd()) {
    const demo = await demoIdentity();
    if (demo) {
      return { ...demo, personaId: opts?.queryPersonaId ?? demo.personaId };
    }
  }

  /* ③ 生产环境且无会话 → 未登录 */
  return null;
}

/** API 路由用：解析身份，未登录时直接给出 401 响应体 */
export async function requireIdentity(opts?: { queryPersonaId?: string | null }) {
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
