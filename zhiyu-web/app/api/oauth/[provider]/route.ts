import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveIdentity } from "@/lib/auth/current-user";
import { issueState, SESSION_COOKIE } from "@/lib/auth/session";
import {
  buildAuthorizeUrl,
  isOAuthProvider,
  readProviderEnv,
  PROVIDER_META,
  type OAuthProvider,
} from "@/lib/oauth/platforms";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

/**
 * 发起第三方平台授权（飞书 / 钉钉）。
 *
 * 与知乎授权同一套骨架：生成 state → 落库（防 CSRF / 重放）→ 跳平台授权页。
 *
 * 未配置应用凭证时**不报错**，而是回到「我的人格」页并带上 `?link=<provider>_unconfigured`，
 * 由页面展示**申请与配置步骤** —— 这是用户明确要求的"引导"：
 * 没配凭证时不能只给一个点了没反应的按钮。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { provider: raw } = await params;
  const back = new URL("/persona", req.nextUrl.origin);
  back.searchParams.set("tab", "sources");

  if (!isOAuthProvider(raw)) {
    back.searchParams.set("link", "unknown_provider");
    return NextResponse.redirect(back);
  }
  const provider: OAuthProvider = raw;

  const me = await resolveIdentity();
  if (!me?.userId) {
    back.searchParams.set("link", "unauthenticated");
    return NextResponse.redirect(back);
  }

  const env = readProviderEnv(provider);
  if (!env) {
    /* 没配置就把需要配的东西告诉用户（环境变量名 + 控制台入口） */
    back.searchParams.set("link", `${provider}_unconfigured`);
    return NextResponse.redirect(back);
  }

  const jar = await cookies();
  const state = await issueState({
    sessionToken: jar.get(SESSION_COOKIE)?.value ?? null,
    returnTo: `/persona?tab=sources&linked=${provider}`,
  });

  void PROVIDER_META[provider];
  return NextResponse.redirect(buildAuthorizeUrl(provider, env, state));
}
