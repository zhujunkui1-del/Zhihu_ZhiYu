import { NextRequest, NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth/current-user";
import { platformAppStatus, redirectUriFor } from "@/lib/oauth/apps";
import { isOAuthProvider, PROVIDER_META, type OAuthProvider } from "@/lib/oauth/platforms";
import { listLinkedAccounts } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/**
 * 「同步数据」按钮要的状态：配没配凭证、授权没授权。
 *
 * **只回状态，不回任何秘密**（App ID 不是秘密，回调地址也不是）。
 * 界面据此决定：直接跳授权页 / 打开发配置向导 / 直接同步。
 */
export async function GET(req: NextRequest) {
  const me = await resolveIdentity();
  const apps = await platformAppStatus(req.nextUrl.origin);
  const linked = me?.userId ? await listLinkedAccounts(me.userId) : [];
  const byProvider = new Map(linked.map((l) => [l.provider, l] as const));

  const providers = {} as Record<
    OAuthProvider,
    {
      provider: OAuthProvider;
      label: string;
      configured: boolean;
      /** App ID（非秘密），配置向导里回显用 */
      appId: string | null;
      /** 用户要复制到平台后台的回调地址 */
      redirectUri: string;
      /** 平台开放平台入口 */
      consoleUrl: string;
      scope: string;
      linked: { displayName: string | null; expired: boolean } | null;
    }
  >;

  for (const p of ["feishu", "dingtalk"] as OAuthProvider[]) {
    const l = byProvider.get(p);
    providers[p] = {
      provider: p,
      label: PROVIDER_META[p].label,
      configured: apps[p].configured,
      appId: apps[p].appId,
      redirectUri: redirectUriFor(p, req.nextUrl.origin),
      consoleUrl: PROVIDER_META[p].consoleUrl,
      scope: PROVIDER_META[p].scope,
      linked: l ? { displayName: l.displayName, expired: l.expired } : null,
    };
  }

  void isOAuthProvider;
  return NextResponse.json({ ok: true, providers });
}
