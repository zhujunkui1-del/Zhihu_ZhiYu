import { NextRequest, NextResponse } from "next/server";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";
import { readP2pChatIds, saveP2pChatIds } from "@/lib/oauth/store";

export const dynamic = "force-dynamic";

/**
 * 飞书**私聊会话 ID** 的读取与保存。
 *
 * ── 为什么需要用户手工提供 ────────────────────────────────────────────
 * 飞书没有任何"列出我的私聊"的接口（`GET /im/v1/chats` 只返回群聊）。
 * 官方文档《群 ID 说明》给了两条路取单聊 chat_id：
 *   ① 飞书客户端（≥7.60）打开该私聊 → 右上角设置 → 直接复制群 ID  ← 本站走这条
 *   ② 让机器人给对方发一条消息，从响应里拿 chat_id（会在对方聊天框留痕）
 * ①零打扰、不需要机器人能力，所以做成"用户粘一串 oc_... 进来"。
 * 拿到之后 `GET /im/v1/messages?container_id_type=chat&container_id=…`
 * 对单聊同样有效（官方文档：「包括单聊、群组」）。
 */
export async function GET() {
  const me = await resolveIdentity();
  if (!me?.userId) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
  const ids = await readP2pChatIds(me.userId, "feishu");
  return NextResponse.json({ ok: true, p2pChatIds: ids });
}

export async function POST(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me?.userId) return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const raw = Array.isArray(body.ids) ? body.ids : [];
    const { linked, saved } = await saveP2pChatIds(
      me.userId,
      "feishu",
      raw.map((x) => String(x)),
    );

    /* 私聊 ID 挂在已授权账号上：还没授权就存不了，得说清而不是 500 */
    if (!linked) {
      return NextResponse.json(
        {
          ok: false,
          code: "NOT_LINKED",
          error: "请先点「同步数据」完成飞书授权，再填私聊会话 ID。",
        },
        { status: 409 },
      );
    }

    /* 如实回报：输了但形状不对的会被丢掉，得让用户知道 */
    const dropped = raw
      .map((x) => String(x).trim())
      .filter((s) => s && !/^oc_[A-Za-z0-9]+$/.test(s));
    return NextResponse.json({
      ok: true,
      p2pChatIds: saved,
      dropped,
      hint: dropped.length
        ? "只接受 oc_ 开头的会话 ID（飞书里叫「群 ID」，单聊也有）"
        : undefined,
    });
  } catch (e) {
    /* 绝不回空响应体：前端 res.json() 只会报 "Unexpected end of JSON input" */
    console.error("[oauth/feishu/p2p] 保存失败", e);
    return NextResponse.json(
      { ok: false, code: "INTERNAL", error: `保存失败：${(e as Error).message}` },
      { status: 500 },
    );
  }
}
