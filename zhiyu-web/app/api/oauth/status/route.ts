import { NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/auth/current-user";
import {
  OAUTH_PROVIDERS,
  PROVIDER_META,
  providerConfigStatus,
  type OAuthProvider,
} from "@/lib/oauth/platforms";
import { listLinkedAccounts } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/**
 * 授权状态查询（给「我的人格 → 注入数据」页用）。
 *
 * 返回三样东西，界面据此决定显示"引导配置"还是"授权按钮"还是"同步按钮"：
 *   · capability —— 这个平台授权后能拉到什么、**拉不到**什么（照实展示）
 *   · configured —— 服务端有没有配好应用凭证（没配就展示申请步骤，而不是死按钮）
 *   · linked     —— 当前用户是否已授权、是否过期
 *
 * **绝不返回 app_secret / access_token**：只有"配没配"和回调地址（不是秘密）。
 */
export async function GET() {
  const me = await resolveIdentity();
  const configured = providerConfigStatus();
  const linked = me?.userId ? await listLinkedAccounts(me.userId) : [];
  const byProvider = new Map(linked.map((l) => [l.provider, l] as const));

  const providers = {} as Record<
    OAuthProvider,
    {
      meta: (typeof PROVIDER_META)[OAuthProvider];
      configured: boolean;
      redirectUri: string;
      envKeys: { appId: string; appSecret: string; redirectUri: string };
      linked: { displayName: string | null; expired: boolean } | null;
    }
  >;

  for (const p of OAUTH_PROVIDERS) {
    const l = byProvider.get(p);
    providers[p] = {
      meta: PROVIDER_META[p],
      configured: configured[p].configured,
      redirectUri: configured[p].redirectUri,
      envKeys: configured[p].envKeys,
      linked: l ? { displayName: l.displayName, expired: l.expired } : null,
    };
  }

  return NextResponse.json({ ok: true, providers });
}
