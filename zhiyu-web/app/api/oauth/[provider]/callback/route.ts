import { NextRequest, NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth/current-user";
import { consumeState } from "@/lib/auth/session";
import { exchangeCode, OAuthApiError } from "@/lib/oauth/clients";
import { isOAuthProvider, readProviderEnv, type OAuthProvider } from "@/lib/oauth/platforms";
import { saveLinkedAccount } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

/**
 * 第三方平台授权回调。
 *
 * 流程：校验并原子消费 state → 授权码换 token → 加密落库 → 跳回「我的人格」。
 * 失败一律跳回并带 `?link=<原因>`，**不把 token / secret 放进 URL 或日志**。
 *
 * 注意：这里**只完成授权**，不顺手拉数据 —— 拉数据放在
 * `POST /api/oauth/<provider>/sync`，这样用户能先看到"授权成功"再决定同步，
 * 也让同步失败时不会把授权状态一起搞乱。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { provider: raw } = await params;
  const origin = req.nextUrl.origin;
  const params2 = req.nextUrl.searchParams;

  const fail = (reason: string) => {
    const back = new URL("/persona", origin);
    back.searchParams.set("tab", "sources");
    back.searchParams.set("link", reason);
    return NextResponse.redirect(back);
  };

  if (!isOAuthProvider(raw)) return fail("unknown_provider");
  const provider: OAuthProvider = raw;

  const me = await resolveIdentity();
  if (!me?.userId) return fail("unauthenticated");

  const env = readProviderEnv(provider);
  if (!env) return fail(`${provider}_unconfigured`);

  /* 用户点了"拒绝"或平台直接回错误 */
  const errParam = params2.get("error") ?? params2.get("error_code");
  if (errParam) return fail("denied");

  const check = await consumeState(params2.get("state"));
  if (!check.ok && check.reason !== "missing") return fail(`state_${check.reason}`);

  const code = params2.get("code") ?? params2.get("authCode") ?? params2.get("authorization_code");
  if (!code) return fail("code_missing");

  try {
    const tokens = await exchangeCode(provider, env, code);
    await saveLinkedAccount(me.userId, provider, tokens);
  } catch (e) {
    const code2 = e instanceof OAuthApiError ? e.code : "unknown";
    console.error(`[oauth/${provider}] 授权失败`, code2, (e as Error).message);
    return fail(`exchange_failed_${code2}`);
  }

  const back = new URL(check.ok ? (check.returnTo ?? "/persona") : "/persona", origin);
  back.searchParams.set("linked", provider);
  return NextResponse.redirect(back);
}
