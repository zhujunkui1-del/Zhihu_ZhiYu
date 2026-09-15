/**
 * 平台应用凭证的读取与保存（飞书 / 钉钉）。
 *
 * ── 为什么凭证存库而不是只认环境变量 ────────────────────────────────────
 * 存环境变量意味着"要先去 Vercel 后台加三个变量"—— 对运营者是多一步、
 * 对访客则是"这个按钮点了没用"。用户明确要求「能不让用户动手就不要让用户做」，
 * 所以：**凭证在设置页填一次**（加密落库），之后所有访客点「同步数据」
 * 都能直接走授权。
 *
 * 读取顺序：**库里的优先**，没有再回落到环境变量 ——
 * 这样已有的环境变量配置不会因为这次改动失效（Vercel 上仍然可用）。
 *
 * app_secret 用 AES-256-GCM 加密（lib/crypto.ts），
 * **任何接口都不回传明文**，只回"配没配"与 App ID（App ID 不是秘密）。
 */

import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "./store";
import {
  PROVIDER_META,
  isOAuthProvider,
  readProviderEnv,
  type OAuthProvider,
  type ProviderEnv,
} from "./platforms";

/** 读某个平台的应用凭证：先库、后环境变量；都没有返回 null */
export async function resolveProviderEnv(provider: OAuthProvider): Promise<ProviderEnv | null> {
  const row = await prisma.platformApp.findUnique({ where: { provider } });
  if (row) {
    let secret = "";
    try {
      secret = decryptToken(row.appSecretEnc);
    } catch {
      /* 解密失败（换过密钥）→ 当作没配，引导重新填，而不是抛 500 */
      return null;
    }
    if (row.appId && secret) {
      return {
        provider,
        appId: row.appId,
        appSecret: secret,
        /* 回调地址按当前站点推；库里存的那份只用于界面回显 */
        redirectUri: readProviderEnv(provider)?.redirectUri ?? row.redirectUri ?? "",
      };
    }
  }
  return readProviderEnv(provider);
}

/** 回调地址：优先环境变量（线上显式配置过），否则按请求 origin 推导 */
export function redirectUriFor(provider: OAuthProvider, origin: string): string {
  return (
    readProviderEnv(provider)?.redirectUri ??
    `${origin.replace(/\/$/, "")}/api/oauth/${provider}/callback`
  );
}

export interface PlatformAppView {
  provider: OAuthProvider;
  configured: boolean;
  /** App ID 不是秘密，回显出来便于对照平台后台 */
  appId: string | null;
  redirectUri: string;
  /** 凭证来源：db=设置页填的，env=环境变量 */
  source: "db" | "env" | null;
}

/** 给界面用的状态（**不含 secret**） */
export async function platformAppStatus(origin: string): Promise<Record<OAuthProvider, PlatformAppView>> {
  const rows = await prisma.platformApp.findMany();
  const byProvider = new Map(rows.map((r) => [r.provider, r] as const));
  const out = {} as Record<OAuthProvider, PlatformAppView>;

  for (const p of ["feishu", "dingtalk"] as OAuthProvider[]) {
    const row = byProvider.get(p);
    const env = readProviderEnv(p);
    out[p] = {
      provider: p,
      configured: Boolean(row) || Boolean(env),
      appId: row?.appId ?? env?.appId ?? null,
      redirectUri: env?.redirectUri ?? row?.redirectUri ?? redirectUriFor(p, origin),
      source: row ? "db" : env ? "env" : null,
    };
  }
  return out;
}

/** 保存凭证（设置页调用）。appId/secret 任一为空则视为"清除配置" */
export async function savePlatformApp(
  provider: string,
  appId: string,
  appSecret: string,
  redirectUri: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (!isOAuthProvider(provider)) return { ok: false, error: "未知平台" };
  const id = appId.trim();
  const secret = appSecret.trim();

  if (!id && !secret) {
    await prisma.platformApp.deleteMany({ where: { provider } });
    return { ok: true };
  }
  if (!id || !secret) {
    return { ok: false, error: `${PROVIDER_META[provider].label}需要同时填 App ID 与 App Secret` };
  }

  const data = {
    appId: id,
    appSecretEnc: encryptToken(secret),
    redirectUri: redirectUri?.trim() || null,
  };
  await prisma.platformApp.upsert({
    where: { provider },
    update: data,
    create: { provider, ...data },
  });
  return { ok: true };
}
