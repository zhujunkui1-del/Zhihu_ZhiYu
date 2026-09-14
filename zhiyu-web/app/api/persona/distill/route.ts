import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveIdentity } from "@/lib/auth/current-user";
import { distillPersona, distillReadiness } from "@/lib/persona/distill";

export const dynamic = "force-dynamic";

/**
 * 人格蒸馏。
 *
 * 在这之前「开始蒸馏」按钮点了没反应 —— 因为**后端不存在**，
 * 界面上只标了"蒸馏服务尚未接入（演示占位）"。本路由把它补上。
 *
 * 安全边界：
 *   · 身份只来自会话（不接受 ?userId=）
 *   · **只能蒸馏自己的 Persona** —— 否则可以改别人的画像
 *   · 模型优先用用户 BYOK，否则用平台 AI_API_KEY
 */

/** 查询是否具备蒸馏条件（给页面做前置提示，不触发实际调用） */
export async function GET() {
  const me = await resolveIdentity();
  if (!me) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或会话已过期" },
      { status: 401 },
    );
  }
  const readiness = distillReadiness();

  /* 看该用户有没有接入自己的模型 */
  const byokCount = await prisma.llmProviderConfig.count({
    where: { userId: me.userId },
  });

  return NextResponse.json({
    ok: true,
    /** 平台是否提供了可用的大模型（#7 的免费额度走这条） */
    platformLlm: readiness.platformLlm,
    /** 用户自己接入的模型数量 */
    byokCount,
    /** 两者都没有时，蒸馏会退化成规则归并 */
    canUseLlm: readiness.platformLlm || byokCount > 0,
    encryption: readiness.encryption,
  });
}

export async function POST(req: NextRequest) {
  const me = await resolveIdentity();
  if (!me?.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或没有可蒸馏的人格" },
      { status: 401 },
    );
  }

  let body: { personaId?: string; useByok?: boolean } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 允许空 body：默认蒸自己 */
  }

  const targetId = body.personaId ?? me.ownPersonaId;

  /* 越权保护：只能蒸自己的 */
  if (targetId !== me.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", error: "只能蒸馏自己的人格" },
      { status: 403 },
    );
  }

  /* 取模型：默认走平台 AI_API_KEY；显式要求且用户配了 BYOK 时用用户的 */
  let provider: { baseUrl: string; apiKey: string; model: string } | undefined;
  if (body.useByok) {
    const cfg = await prisma.llmProviderConfig.findFirst({
      where: { userId: me.userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (cfg) {
      try {
        const { decryptSecret } = await import("@/lib/crypto");
        provider = {
          baseUrl: cfg.baseUrl,
          apiKey: decryptSecret(cfg.apiKeyEnc),
          model: cfg.model,
        };
      } catch (e) {
        return NextResponse.json(
          { ok: false, code: "BYOK_DECRYPT_FAILED", error: `读取你的模型配置失败：${(e as Error).message}` },
          { status: 500 },
        );
      }
    }
  }

  try {
    const result = await distillPersona(targetId, provider);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, code: "DISTILL_FAILED", error: (e as Error).message },
      { status: 500 },
    );
  }
}
