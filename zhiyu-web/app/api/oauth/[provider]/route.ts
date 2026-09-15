import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveIdentity } from "@/lib/auth/current-user";
import { issueState, SESSION_COOKIE } from "@/lib/auth/session";
import { redirectUriFor, resolveProviderEnv } from "@/lib/oauth/apps";
import {
  buildAuthorizeUrl,
  isOAuthProvider,
  type OAuthProvider,
} from "@/lib/oauth/platforms";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

/**
 * 发起第三方平台授权（飞书 / 钉钉）—— 「同步数据」按钮点下去就到这里。
 *
 * 配置好之后这里**一步直达平台授权页**：用户只需在平台上点一次"同意"，
 * 回来（callback）就自动拉数据，不需要再点第二次。
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

  const stored = await resolveProviderEnv(provider);
  if (!stored) {
    /* 还没配应用凭证 → 回到「我的人格」并打开配置向导（不是一堆文字） */
    back.searchParams.set("link", `${provider}_unconfigured`);
    return NextResponse.redirect(back);
  }
  /* 回调地址以当前站点为准（库里存的可能是别的域名） */
  const env = { ...stored, redirectUri: redirectUriFor(provider, req.nextUrl.origin) };

  const jar = await cookies();
  const state = await issueState({
    sessionToken: jar.get(SESSION_COOKIE)?.value ?? null,
    returnTo: `/persona?tab=sources&linked=${provider}`,
  });

  return NextResponse.redirect(buildAuthorizeUrl(provider, env, state));
}
