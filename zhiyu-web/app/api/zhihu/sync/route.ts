import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncZhihuToPersona } from "@/lib/zhihu/sync";

export const dynamic = "force-dynamic";

/**
 * 同步知乎公开数据到 Persona。
 *
 * Access Secret **只在服务端使用**，绝不下发到浏览器；
 * 响应体里也不包含任何凭证。
 *
 * 两种身份（见官方 user-api.md「身份模型」）：
 *   · 默认：该 Access Secret 所属账号**本人**的数据
 *   · 若请求带 oauthUserId，则用该用户会话里的 OAuth token 代表他访问
 *     （需要用户已通过知乎 OAuth 授权，token 在服务端加密存储）
 */
export async function POST(req: NextRequest) {
  let body: { personaId?: string; oauthUserId?: string };
  try {
    body = (await req.json()) as { personaId?: string; oauthUserId?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const personaId = body.personaId?.trim();
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }

  const accessSecret = (process.env.ZHIHU_ACCESS_SECRET ?? "").trim();
  if (!accessSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "服务端未配置 ZHIHU_ACCESS_SECRET，无法读取知乎数据",
        code: "NO_ACCESS_SECRET",
      },
      { status: 503 },
    );
  }

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true },
  });
  if (!persona) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  try {
    const result = await syncZhihuToPersona({
      personaId,
      accessSecret,
      /* 代表他人访问时才需要 X-OAuth-Token；本期演示走本人身份 */
      oauthToken: null,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

/** 查询上次同步状态（不触发新请求） */
export async function GET(req: NextRequest) {
  const personaId = req.nextUrl.searchParams.get("personaId");
  if (!personaId) {
    return NextResponse.json({ ok: false, error: "缺少 personaId" }, { status: 400 });
  }
  const row = await prisma.personaSource.findUnique({
    where: { personaId_type: { personaId, type: "zhihu" } },
  });
  return NextResponse.json({
    ok: true,
    configured: Boolean((process.env.ZHIHU_ACCESS_SECRET ?? "").trim()),
    injected: row?.status === "injected",
    importedAt: row?.importedAt ?? null,
    meta: row?.meta ?? null,
  });
}
