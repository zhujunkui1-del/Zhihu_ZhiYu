import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { syncZhihuToPersona } from "@/lib/zhihu/sync";
import { currentZhihuToken, resolveIdentity } from "@/lib/auth/current-user";

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
    select: { id: true, userId: true },
  });
  if (!persona) {
    return NextResponse.json({ ok: false, error: "Persona 不存在" }, { status: 404 });
  }

  /* 只允许同步**自己的** Persona —— 否则可以借接口把别人的资料改掉 */
  const me = await resolveIdentity();
  if (!me || me.ownPersonaId !== personaId) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", error: "只能同步自己的人格数据" },
      { status: 403 },
    );
  }

  /* ★ 关键：授权用户必须带**他自己的** OAuth token ★
     开放平台的双凭证规则：
       · 只带 Access Secret        → 读 Access Secret 所属账号（项目所有者）的数据
       · Access Secret + 该 token  → 读这位授权用户本人的数据
     这里若写死 null，别人授权后同步到的会是**项目所有者**的创作，
     并写进他的 Persona —— 数据污染 + 越权。所以：
       ① 有 token → 带上去读他自己的数据
       ② 没 token 且他**已经**授权过（zhihuAuthorized）→ token 过期，明确拒绝
       ③ 没 token 且从没授权 → 回退读 Access Secret 账号（本地/演示场景） */
  const oauthToken = await currentZhihuToken();
  const user = await prisma.user.findUnique({
    where: { id: persona.userId ?? "" },
    select: { zhihuAuthorized: true },
  });

  if (!oauthToken && user?.zhihuAuthorized) {
    return NextResponse.json(
      {
        ok: false,
        code: "TOKEN_EXPIRED",
        error: "知乎授权已过期，请重新登录后再同步",
      },
      { status: 401 },
    );
  }

  try {
    const result = await syncZhihuToPersona({
      personaId,
      accessSecret,
      oauthToken,
    });
    return NextResponse.json({ ...result, identity: oauthToken ? "oauth-user" : "access-secret-owner" });
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
