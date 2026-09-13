import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, destroySession, SESSION_COOKIE } from "@/lib/auth/session";
import { isConfigured, readConfigFromEnv } from "@/lib/auth/zhihu-oauth";

export const dynamic = "force-dynamic";

/**
 * 会话查询。
 *
 * 用于：登录页判断"是否已登录"、健康检查、以及前端在演示登录与真实登录之间选择。
 * 只回吐**展示所需的最小信息**，绝不包含 access_token。
 */
export async function GET() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = await getSession(token);
  const cfg = readConfigFromEnv();

  return NextResponse.json({
    ok: true,
    /** 知乎 OAuth 是否已配置；未配置时前端应回退到演示登录 */
    oauthConfigured: isConfigured(cfg),
    authenticated: Boolean(session),
    user: session
      ? {
          userId: session.userId,
          displayName: session.displayName,
          avatarUrl: session.avatarUrl,
          zhihuAuthorized: session.zhihuAuthorized,
          zhihuTokenValid: session.zhihuTokenValid,
        }
      : null,
  });
}

/** 退出登录：删除服务端会话并清 Cookie */
export async function DELETE(_req: NextRequest) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await destroySession(token);

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
