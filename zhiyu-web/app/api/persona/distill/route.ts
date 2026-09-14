import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveIdentity } from "@/lib/auth/current-user";
import { distillPersona, distillReadiness } from "@/lib/persona/distill";
import { platformAvailability, resolveLlmSource } from "@/lib/llm/platform";
import { denyIfCrossSite } from "@/lib/auth/csrf";

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
  /* 加密状态提前读一次即可；平台可用性统一由 lib/llm/platform.ts 判定，
     不再看 distillReadiness().platformLlm —— 那个字段不区分免费窗口与滑块。 */
  const { encryption } = distillReadiness();

  /* 看该用户有没有接入自己的模型，以及平台免费额度的状态（#7） */
  const [byokCount, prefs] = await Promise.all([
    prisma.llmProviderConfig.count({ where: { userId: me.userId } }),
    prisma.communicationPrefs.findUnique({ where: { userId: me.userId } }),
  ]);
  const avail = platformAvailability();

  /* 滑块关掉且没有 BYOK 时，蒸馏只能用规则归并 —— 这个事实要**明说**，
     而不是让用户看到一个质量下降的结果却不知道为什么。 */
  const usePlatform = prefs?.usePlatformLlm ?? true;
  const canUseLlm = byokCount > 0 || (usePlatform && avail.usable);

  return NextResponse.json({
    ok: true,
    /** 平台是否**此刻真的**可用（已配置 且 免费窗口未结束） */
    platformLlm: usePlatform && avail.usable,
    /** 平台是否配置了 Key（与上面区分：配置了但滑块关掉也算 false） */
    platformConfigured: avail.configured,
    /** 免费额度窗口 */
    freeWindowOpen: avail.freeOpen,
    freeUntil: avail.freeUntil,
    daysLeft: avail.daysLeft,
    /** 用户是否开着「使用知遇提供的大模型」滑块 */
    usePlatformLlm: usePlatform,
    /** 用户自己接入的模型数量 */
    byokCount,
    /** 两者都没有时，蒸馏会退化成规则归并 */
    canUseLlm,
    /** 不可用时的原因（可直接展示） */
    unavailableReason: canUseLlm ? undefined : (avail.usable ? "已关闭「使用知遇提供的大模型」且未接入自己的模型" : avail.reason),
    encryption,
  });
}

export async function POST(req: NextRequest) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me?.ownPersonaId) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", error: "未登录或没有可蒸馏的人格" },
      { status: 401 },
    );
  }

  let body: { personaId?: string } = {};
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

  /* 选模型：BYOK 优先，其次平台免费额度（且受设置页滑块约束）。
     这段逻辑统一走 lib/llm/platform.ts，避免这里与 Agent 对话两处判断不一致。 */
  const prefs = await prisma.communicationPrefs.findUnique({
    where: { userId: me.userId },
  });
  const byokCfg = await prisma.llmProviderConfig.findFirst({
    where: { userId: me.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  let byok: { baseUrl: string; apiKey: string; model: string } | null = null;
  if (byokCfg) {
    try {
      const { decryptSecret } = await import("@/lib/crypto");
      byok = {
        baseUrl: byokCfg.baseUrl,
        apiKey: decryptSecret(byokCfg.apiKeyEnc),
        model: byokCfg.model,
      };
    } catch (e) {
      return NextResponse.json(
        { ok: false, code: "BYOK_DECRYPT_FAILED", error: `读取你的模型配置失败：${(e as Error).message}` },
        { status: 500 },
      );
    }
  }

  const resolved = resolveLlmSource(prefs, byok);
  const provider = resolved.provider ?? undefined;

  try {
    const result = await distillPersona(targetId, provider);
    /* 把"这次用了谁的模型 / 为什么没有模型"如实带回前端 */
    return NextResponse.json(
      { ...result, llmSource: resolved.source, llmUnavailableReason: resolved.reason },
      { status: result.ok ? 200 : 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, code: "DISTILL_FAILED", error: (e as Error).message },
      { status: 500 },
    );
  }
}
