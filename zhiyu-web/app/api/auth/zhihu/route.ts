import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizeUrl, isConfigured, readConfigFromEnv } from "@/lib/auth/zhihu-oauth";
import { issueState, SESSION_COOKIE } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * 授权入口一律不允许任何缓存。
 *
 * 为什么：每次调用都会**新签一个 state**，缓存住旧响应就等于把旧 state 再发一次；
 * 而旧 state 可能已经被消费（用户看到「已经完成过一次」）或已过期。
 * Next 默认给的是 `public, max-age=0, must-revalidate`，浏览器会回源，
 * 但手机网络上的运营商透明代理/中间层未必照规矩来 —— 直接 no-store 最省心。
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

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
    return NextResponse.redirect(back, { headers: NO_STORE });
  }

  const jar = await cookies();
  const sessionToken = jar.get(SESSION_COOKIE)?.value ?? null;

  /* returnTo 只接受站内路径，避免开放重定向 */
  const rawReturn = req.nextUrl.searchParams.get("returnTo") ?? "";
  const returnTo = rawReturn.startsWith("/") && !rawReturn.startsWith("//") ? rawReturn : "/home";

  const state = await issueState({ sessionToken, returnTo });
  return NextResponse.redirect(buildAuthorizeUrl(cfg, state), { headers: NO_STORE });
}
