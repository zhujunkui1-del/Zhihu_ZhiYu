import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, keyMask } from "@/lib/crypto";
import { resolveIdentity } from "@/lib/auth/current-user";
import { denyIfCrossSite } from "@/lib/auth/csrf";

export const dynamic = "force-dynamic";

/**
 * BYOK 大模型接入配置。
 *
 * 身份**只**来自 `resolveIdentity()`（HttpOnly 会话）。
 * 之前这里接受 `?userId=` —— API Key 是**用户自己的密钥**，
 * 换个 id 就能读写别人的 Key，比读通知更严重。
 */

export async function GET() {
  const me = await resolveIdentity();
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  const list = await prisma.llmProviderConfig.findMany({
    where: { userId: me.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  const items = list.map((c) => {
    let mask = "****";
    try {
      mask = keyMask(decryptSecret(c.apiKeyEnc));
    } catch {
      /* 解不开就只给占位掩码，绝不回吐密文 */
    }
    return {
      id: c.id,
      type: c.type,
      providerKey: c.providerKey,
      displayName: c.displayName,
      baseUrl: c.baseUrl,
      model: c.model,
      isDefault: c.isDefault,
      keyMask: mask,
      lastTestAt: c.lastTestAt,
      lastTestOk: c.lastTestOk,
      latencyMs: c.latencyMs,
    };
  });

  return NextResponse.json({ ok: true, items });
}

export async function POST(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  let body: {
    id?: string;
    type?: string;
    providerKey?: string;
    displayName?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    isDefault?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body.displayName || !body.baseUrl || !body.model) {
    return NextResponse.json(
      { ok: false, error: "缺少 displayName / baseUrl / model" },
      { status: 400 },
    );
  }

  let apiKeyEnc: string;
  if (body.apiKey) {
    try {
      apiKeyEnc = encryptSecret(body.apiKey);
    } catch (e) {
      /* 生产环境未配加密密钥时，这里会明确报出缺哪个变量 */
      return NextResponse.json(
        { ok: false, code: "ENCRYPT_FAILED", error: `加密失败：${(e as Error).message}` },
        { status: 500 },
      );
    }
  } else {
    /* 不传 apiKey = 只改其它字段，沿用原密文。
       注意必须校验这条配置属于当前用户，否则可以改别人的。 */
    const existing = body.id
      ? await prisma.llmProviderConfig.findFirst({
          where: { id: body.id, userId: me.userId },
        })
      : null;
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "新建配置必须提供 apiKey" },
        { status: 400 },
      );
    }
    apiKeyEnc = existing.apiKeyEnc;
  }

  const data = {
    userId: me.userId,
    type: body.type === "custom" ? "custom" : "preset",
    providerKey: body.providerKey ?? null,
    displayName: body.displayName,
    baseUrl: body.baseUrl,
    apiKeyEnc,
    model: body.model,
    isDefault: body.isDefault ?? false,
  };

  const saved = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.llmProviderConfig.updateMany({
        where: { userId: me.userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    if (body.id) {
      /* 用 updateMany + userId 条件，防止改到别人的配置 */
      const r = await tx.llmProviderConfig.updateMany({
        where: { id: body.id, userId: me.userId },
        data,
      });
      if (r.count === 0) throw new Error("配置不存在或不属于当前用户");
      return tx.llmProviderConfig.findUniqueOrThrow({ where: { id: body.id } });
    }
    return tx.llmProviderConfig.create({ data });
  });

  return NextResponse.json({ ok: true, id: saved.id }, { status: body.id ? 200 : 201 });
}

export async function DELETE(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
  }

  /* 带上 userId 条件：只能删自己的 */
  const r = await prisma.llmProviderConfig.deleteMany({ where: { id, userId: me.userId } });
  if (r.count === 0) {
    return NextResponse.json({ ok: false, error: "配置不存在或不属于当前用户" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
