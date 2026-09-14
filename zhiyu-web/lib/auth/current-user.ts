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
import { SESSION_COOKIE, getSession, getZhihuToken } from "@/lib/auth/session";

export interface CurrentIdentity {
  userId: string;
  /**
   * **登录者自己**的 persona id。永远是自己那一份，不受 URL 影响。
   *
   * 为什么必须与 viewPersonaId 分开：曾经把两者合成一个字段，
   * 结果 `?id=<别人>` 时 `me.personaId` 也变成了别人，
   * 页面的 `isSelf = viewId === me.personaId` 恒为 true
   * —— 看任何人的人格卡都被当成"我的人格"。这是实际发生过的 bug。
   */
  ownPersonaId: string | null;
  /** 本次要**查看**的 persona（默认等于 ownPersonaId；看别人时是对方） */
  viewPersonaId: string | null;
  /** 身份来源，便于页面提示与排查 */
  source: "session" | "demo";
  displayName: string | null;
  /**
   * 知乎头像地址（侧栏展示用 #8）。
   *
   * 开放平台在**无权限/未授权时返回空串**，所以这里可能是 null ——
   * 调用方必须能兜底（见 `lib/sidebar-user.ts`），不能直接塞进 <img src>。
   */
  avatarUrl: string | null;
  /** 是否已通过知乎 OAuth 授权 */
  zhihuAuthorized: boolean;
}

const isProd = () => process.env.NODE_ENV === "production";

/** 演示用户（本地与预发用；生产不会走到） */
async function demoIdentity(): Promise<Omit<CurrentIdentity, "viewPersonaId"> | null> {
  const demo = await prisma.user.findUnique({
    where: { username: "demo" },
    include: { persona: { select: { id: true } } },
  });
  if (!demo) return null;
  return {
    userId: demo.id,
    ownPersonaId: demo.persona?.id ?? null,
    source: "demo",
    displayName: demo.displayName,
    avatarUrl: demo.avatarUrl,
    zhihuAuthorized: demo.zhihuAuthorized,
  };
}

/**
 * 解析当前身份。
 *
 * @param opts.queryPersonaId 想查看哪个人设（**不是**身份）。
 *   看他人人格卡是产品功能（发现页/雷达点进去），但身份始终是会话里的那个人。
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
      const own = persona?.id ?? null;
      return {
        userId: s.userId,
        ownPersonaId: own,
        /* 只有传了 queryPersonaId 才是"看别人"；否则看自己 */
        viewPersonaId: opts?.queryPersonaId ?? own,
        source: "session",
        displayName: s.displayName,
        avatarUrl: s.avatarUrl,
        zhihuAuthorized: s.zhihuAuthorized,
      };
    }
  }

  /* ② 非生产环境：回退演示用户，保证本地开箱可用 */
  if (!isProd()) {
    const demo = await demoIdentity();
    if (demo) {
      return {
        ...demo,
        viewPersonaId: opts?.queryPersonaId ?? demo.ownPersonaId,
      };
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

/**
 * 取当前会话里该用户的知乎 OAuth access_token（明文，仅供服务端使用）。
 *
 * 为什么需要它：开放平台的用户数据 API 用**双凭证**区分读谁的数据 ——
 *   · 只带 Access Secret        → 读 **Access Secret 所属账号**（也就是项目所有者）的数据
 *   · Access Secret + 该 token  → 读 **这位授权用户本人** 的数据
 *
 * 曾经同步接口里写死 `oauthToken: null`，后果很严重：
 * 别人授权登录后点「同步」，读到的其实是**项目所有者**的创作，
 * 并写进**这个用户的** Persona —— 既是数据污染，也是越权。
 *
 * 返回 null 表示：没有 OAuth 会话，或 token 已过期。
 * 调用方**必须**据此决定"回退到读自己账号"还是"拒绝同步"，
 * 不能静默降级（那正是上面那个 bug 的成因）。
 */
export async function currentZhihuToken(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getZhihuToken(token);
}
