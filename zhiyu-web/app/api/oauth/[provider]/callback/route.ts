import { NextRequest, NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth/current-user";
import { consumeState } from "@/lib/auth/session";
import { exchangeCode, OAuthApiError } from "@/lib/oauth/clients";
import { redirectUriFor, resolveProviderEnv } from "@/lib/oauth/apps";
import { isOAuthProvider, type OAuthProvider } from "@/lib/oauth/platforms";
import { saveLinkedAccount } from "@/lib/oauth/store";
import { syncProvider } from "@/lib/oauth/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ provider: string }> };

/**
 * 第三方平台授权回调 —— 一步到位：换 token → 落库 → **立刻拉数据** → 跳回。
 *
 * 为什么不把"拉数据"留给用户再点一次：用户要的是「能不让用户动手就不要让用户做」。
 * 他在平台上点完"同意"，回来就该看到数据已经进来了。
 * 拉取失败也不影响授权本身（token 已保存），跳回时带上失败原因。
 *
 * 全程**不把 token / secret 放进 URL 或日志**。
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { provider: raw } = await params;
  const origin = req.nextUrl.origin;
  const q = req.nextUrl.searchParams;

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

  const stored = await resolveProviderEnv(provider);
  if (!stored) return fail(`${provider}_unconfigured`);
  const env = { ...stored, redirectUri: redirectUriFor(provider, origin) };

  if (q.get("error") || q.get("error_code")) return fail("denied");

  const check = await consumeState(q.get("state"));
  if (!check.ok && check.reason !== "missing") return fail(`state_${check.reason}`);

  const code = q.get("code") ?? q.get("authCode") ?? q.get("authorization_code");
  if (!code) return fail("code_missing");

  try {
    const tokens = await exchangeCode(provider, env, code);
    await saveLinkedAccount(me.userId, provider, tokens);
  } catch (e) {
    const code2 = e instanceof OAuthApiError ? e.code : "unknown";
    console.error(`[oauth/${provider}] 授权失败`, code2, (e as Error).message);
    return fail(`exchange_failed_${code2}`);
  }

  /* ── 授权成功，立刻拉数据（用户不用再点第二次）── */
  const back = new URL("/persona", origin);
  back.searchParams.set("tab", "sources");
  try {
    const r = await syncProvider(me.userId, me.ownPersonaId ?? "", provider, "append");
    back.searchParams.set("linked", provider);
    back.searchParams.set("pulled", String(r.pulled));
    back.searchParams.set("total", String(r.total));
  } catch (e) {
    /* 授权本身是成功的，只是这次没拉到数据 —— 如实告知，不假装成功 */
    console.error(`[oauth/${provider}] 授权后自动同步失败`, e);
    back.searchParams.set("linked", provider);
    back.searchParams.set("syncFailed", (e as Error).message.slice(0, 120));
  }
  return NextResponse.redirect(back);
}
