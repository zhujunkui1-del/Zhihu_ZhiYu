import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, keyMask } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ ok: false, error: "缺少 userId" }, { status: 400 });
  }
  const list = await prisma.llmProviderConfig.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  const items = list.map((c) => {
    let mask = "****";
    try {
      mask = keyMask(decryptSecret(c.apiKeyEnc));
    } catch {
      // 未配置加密密钥时只返回掩码占位
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
  const body = (await req.json()) as {
    id?: string;
    userId: string;
    type?: string;
    providerKey?: string;
    displayName: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    isDefault?: boolean;
  };
  if (!body.userId || !body.displayName || !body.baseUrl || !body.model) {
    return NextResponse.json(
      { ok: false, error: "缺少 userId / displayName / baseUrl / model" },
      { status: 400 },
    );
  }

  let apiKeyEnc: string;
  if (body.apiKey) {
    try {
      apiKeyEnc = encryptSecret(body.apiKey);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `加密失败：${(e as Error).message}` },
        { status: 500 },
      );
    }
  } else {
    const existing = body.id
      ? await prisma.llmProviderConfig.findUnique({ where: { id: body.id } })
      : null;
    if (!existing) {
      return NextResponse.json({ ok: false, error: "新建配置必须提供 apiKey" }, { status: 400 });
    }
    apiKeyEnc = existing.apiKeyEnc;
  }

  const data = {
    userId: body.userId,
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
        where: { userId: body.userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return body.id
      ? tx.llmProviderConfig.update({ where: { id: body.id }, data })
      : tx.llmProviderConfig.create({ data });
  });

  return NextResponse.json({ ok: true, id: saved.id }, { status: body.id ? 200 : 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const userId = req.nextUrl.searchParams.get("userId");
  if (!id || !userId) {
    return NextResponse.json({ ok: false, error: "缺少 id / userId" }, { status: 400 });
  }
  await prisma.llmProviderConfig.deleteMany({ where: { id, userId } });
  return NextResponse.json({ ok: true });
}
