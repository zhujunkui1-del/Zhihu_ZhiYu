import { NextRequest, NextResponse } from "next/server";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";
import { isOAuthProvider, type OAuthProvider } from "@/lib/oauth/platforms";
import { SyncError, syncProvider } from "@/lib/oauth/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ provider: string }> };

/**
 * 「同步数据」按钮的后端。
 *
 * 固定 **append（只加不删）**：用户明确要求同步是"添加功能，只加不删不覆盖"。
 *
 * 另外把同步逻辑放在 `lib/oauth/sync.ts`，因为授权回调也会调它
 * （授权回来自动同步，用户不用再点一次）。
 */
export async function POST(req: NextRequest, { params }: Params) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const { provider: raw } = await params;
  if (!isOAuthProvider(raw)) {
    return NextResponse.json({ ok: false, error: "未知平台" }, { status: 400 });
  }
  const provider: OAuthProvider = raw;

  const me = await resolveIdentity();
  if (!me?.userId || !me.ownPersonaId) {
    return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  }

  try {
    const r = await syncProvider(me.userId, me.ownPersonaId, provider, "append");
    return NextResponse.json({
      ok: true,
      provider,
      mode: "append",
      counts: { pulled: r.pulled, written: r.written, total: r.total },
      skipped: r.skipped,
      detail: r.detail,
    });
  } catch (e) {
    const err = e as SyncError;
    const code = err.code ?? "SYNC_FAILED";
    const status = code === "NOT_LINKED" || code === "TOKEN_EXPIRED" ? 409 : 400;
    return NextResponse.json({ ok: false, code, error: err.message }, { status });
  }
}
