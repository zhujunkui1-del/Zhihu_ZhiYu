import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizeUrl, isConfigured, readConfigFromEnv } from "@/lib/auth/zhihu-oauth";
import { issueState, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * 发起知乎授权：生成 state → 落库 → 跳转到知乎授权页。
 *
 * 未配置 App ID / App Key 时**不抛错**，而是回到登录页并带上原因 ——
 * 因为凭证要等赛事页面发放，这期间站点必须仍然可用（走演示登录）。
 */
export async function GET(req: NextRequest) {
  const cfg = readConfigFromEnv();

  if (!isConfigured(cfg)) {
    const back = new URL("/", req.nextUrl.origin);
    back.searchParams.set("oauth", "unconfigured");
    return NextResponse.redirect(back);
  }

  const jar = await cookies();
  const sessionToken = jar.get(SESSION_COOKIE)?.value ?? null;

  /* returnTo 只接受站内路径，避免开放重定向 */
  const rawReturn = req.nextUrl.searchParams.get("returnTo") ?? "";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/home";

  const state = await issueState({ sessionToken, returnTo });
  return NextResponse.redirect(buildAuthorizeUrl(cfg, state));
}
