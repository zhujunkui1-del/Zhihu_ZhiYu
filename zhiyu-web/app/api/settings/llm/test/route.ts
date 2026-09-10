import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { chatCompletion } from "@/lib/llm/chat";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    configId?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };

  let baseUrl: string | undefined = body.baseUrl;
  let apiKey: string | undefined = body.apiKey;
  let model: string | undefined = body.model;

  if (body.configId) {
    const cfg = await prisma.llmProviderConfig.findUnique({
      where: { id: body.configId },
    });
    if (!cfg) {
      return NextResponse.json({ ok: false, error: "配置不存在" }, { status: 404 });
    }
    try {
      apiKey = decryptSecret(cfg.apiKeyEnc);
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: `解密失败：${(e as Error).message}` },
        { status: 500 },
      );
    }
    baseUrl = cfg.baseUrl;
    model = cfg.model;
  }

  if (!baseUrl || !apiKey || !model) {
    return NextResponse.json(
      { ok: false, error: "缺少 baseUrl / apiKey / model" },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const reply = await chatCompletion(
      { baseUrl, apiKey, model },
      [{ role: "user", content: "ping" }],
      { maxTokens: 8, timeoutMs: 15000 },
    );
    const latencyMs = Date.now() - started;
    return NextResponse.json({
      ok: true,
      latencyMs,
      replySnippet: reply.slice(0, 60),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message, latencyMs: Date.now() - started },
      { status: 502 },
    );
  }
}
