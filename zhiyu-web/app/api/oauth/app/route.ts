import { NextRequest, NextResponse } from "next/server";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";
import { platformAppStatus, redirectUriFor, savePlatformApp } from "@/lib/oauth/apps";
import { isOAuthProvider, PROVIDER_META } from "@/lib/oauth/platforms";

export const dynamic = "force-dynamic";

/**
 * 平台应用凭证的查询与保存（设置页用）。
 *
 * GET  —— 回"配没配 + App ID + 回调地址"，**绝不回 app_secret**
 * POST —— 保存（加密落库）
 *
 * 权限：这里改的是**站点级**配置（不是某个用户的）。当前站点没有角色体系，
 * 所以只要求已登录；上线给多人用时应当收窄到管理员账号。
 */
export async function GET(req: NextRequest) {
  const status = await platformAppStatus(req.nextUrl.origin);
  /* 每个平台附带"该往哪儿填"的直达链接，界面直接当按钮用 */
  const links = Object.fromEntries(
    (["feishu", "dingtalk"] as const).map((p) => [
      p,
      {
        consoleUrl: PROVIDER_META[p].consoleUrl,
        scope: PROVIDER_META[p].scope,
        redirectUri: redirectUriFor(p, req.nextUrl.origin),
        label: PROVIDER_META[p].label,
      },
    ]),
  );
  return NextResponse.json({ ok: true, apps: status, links });
}

export async function POST(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me?.userId) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    appId?: string;
    appSecret?: string;
    redirectUri?: string;
  };
  if (!isOAuthProvider(String(body.provider ?? ""))) {
    return NextResponse.json({ ok: false, error: "未知平台" }, { status: 400 });
  }
  const provider = String(body.provider);

  const saved = await savePlatformApp(
    provider,
    String(body.appId ?? ""),
    String(body.appSecret ?? ""),
    body.redirectUri ? String(body.redirectUri) : redirectUriFor(provider as never, req.nextUrl.origin),
  );
  if (!saved.ok) {
    return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
  }

  const status = await platformAppStatus(req.nextUrl.origin);
  return NextResponse.json({ ok: true, app: status[provider as never] });
}
