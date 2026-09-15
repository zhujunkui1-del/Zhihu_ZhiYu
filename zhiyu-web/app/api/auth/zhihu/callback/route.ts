import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  exchangeToken,
  extractCode,
  fetchProfile,
  isConfigured,
  readConfigFromEnv,
  ZhihuOAuthError,
} from "@/lib/auth/zhihu-oauth";
import {
  consumeState,
  createSession,
  decideStateAction,
  getSession,
  saveStateResult,
  sessionCookieOptions,
  destroyUserSessions,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * 知乎授权回调。
 *
 * 流程：校验并原子消费 state → 用 authorization_code 换 token →
 *       读基础信息 → upsert 用户与 persona → 建会话 → 种 HttpOnly Cookie → 跳回。
 *
 * 失败一律跳回登录页并带 `?oauth=<原因>`，**不把任何 token 或 app_key 放进 URL / 日志**。
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const params = req.nextUrl.searchParams;

  const fail = (reason: string, detail?: string) => {
    const back = new URL("/", origin);
    back.searchParams.set("oauth", reason);
    if (detail && process.env.NODE_ENV !== "production") {
      /* 开发环境带上细节便于排查；生产不带，避免泄密 */
      back.searchParams.set("detail", detail.slice(0, 160));
    }
    return NextResponse.redirect(back);
  };

  const cfg = readConfigFromEnv();
  if (!isConfigured(cfg)) return fail("unconfigured");

  /* ① 用户可能点了"拒绝授权"或平台直接回错误 */
  const errParam = params.get("error") ?? params.get("error_code");
  if (errParam) return fail("denied", String(errParam));

  /* ② 校验并原子消费 state */
  const returnedState = params.get("state");
  const check = await consumeState(returnedState);

  if (!check.ok) {
    /* 留下可诊断的痕迹：只记 state 前 8 位 + 原因 + 行是否存在，
       绝不打完整 state / code / token */
    console.warn(
      "[zhihu-oauth] state 校验未通过",
      JSON.stringify({
        reason: check.reason,
        statePrefix: returnedState ? `${returnedState.slice(0, 8)}…` : null,
        exists: check.exists,
        consumedAgoMs: check.consumedAgoMs,
        hasResult: Boolean(check.resultSessionToken),
      }),
    );
  }

  if (!check.ok) {
    /* 回调是 GET，手机端被请求第二次非常常见（下拉刷新、预取、前进后退）。
       第一次已经把 state 消费掉、把一次性 code 换成会话了，第二次必然失败。
       这时把第一次的会话原样再种一遍 —— 对用户就是"刷新了一下"而不是报错。 */
    const replay = decideStateAction(check, {
      sessionAlive: check.resultSessionToken
        ? Boolean(await getSession(check.resultSessionToken))
        : false,
    });
    if (replay.kind === "replay") {
      console.warn("[zhihu-oauth] 检测到重复回调，复用上一次会话（幂等重放）");
      const res = NextResponse.redirect(new URL(check.returnTo ?? "/home", origin));
      res.cookies.set(sessionCookieOptions(replay.sessionToken));
      return res;
    }

    /* state 没回传是历史已知问题（通用 OAuth 文档记录 2077 实测不返 state）。
       黑客松文档则声明已支持透传。这里采取：
         · 回传了就严格校验（不匹配/过期/重放一律拒绝）
         · 完全没回传时不阻断，但记录 —— 否则在"确实不返 state"的环境下无法登录 */
    if (replay.kind === "reject") return fail(replay.reason);
    console.warn("[zhihu-oauth] 回调未携带 state，已按兼容路径继续（建议向平台确认）");
  }

  /* ③ 授权码：字段名是 authorization_code（兼容 code） */
  const code = extractCode(params);
  if (!code) return fail("code_missing");

  let accessToken = "";
  let expiresIn: number | null = null;
  let profile;
  try {
    const token = await exchangeToken(cfg, code);
    accessToken = token.accessToken;
    expiresIn = token.expiresIn;
    profile = await fetchProfile(cfg, accessToken);
  } catch (e) {
    const code2 = e instanceof ZhihuOAuthError ? e.code : "unknown";
    return fail("exchange_failed", `${code2}: ${(e as Error).message}`);
  }

  if (!profile.uid) return fail("no_uid");

  /* ④ upsert 用户：以知乎 uid 为身份锚点 */
  const displayName = profile.fullname || `知乎用户${profile.uid.slice(-4)}`;
  const user = await prisma.user.upsert({
    where: { zhihuOpenId: profile.uid },
    update: {
      displayName,
      avatarUrl: profile.avatarPath,
      zhihuHashId: profile.hashId,
      zhihuAuthorized: true,
    },
    create: {
      zhihuOpenId: profile.uid,
      zhihuHashId: profile.hashId,
      displayName,
      avatarUrl: profile.avatarPath,
      zhihuAuthorized: true,
    },
  });

  /* ⑤ 建/补 persona：真人类型，把知乎作为「公共表达」来源注入 */
  const existingPersona = await prisma.persona.findUnique({ where: { userId: user.id } });
  const persona = existingPersona
    ? await prisma.persona.update({
        where: { id: existingPersona.id },
        data: { displayName },
      })
    : await prisma.persona.create({
        data: { userId: user.id, kind: "human", displayName },
      });

  await prisma.personaSource.upsert({
    where: { personaId_type: { personaId: persona.id, type: "zhihu" } },
    update: { status: "injected", importedAt: new Date() },
    create: {
      personaId: persona.id,
      type: "zhihu",
      status: "injected",
      importedAt: new Date(),
      meta: { uid: profile.uid, hashId: profile.hashId, headline: profile.headline },
    },
  });

  await prisma.communicationPrefs.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  /* ⑥ 重新授权时清掉该用户旧会话，避免旧 token 残留 */
  await destroyUserSessions(user.id);

  const sessionToken = await createSession({
    userId: user.id,
    zhihuToken: accessToken,
    tokenExpiresIn: expiresIn,
  });

  /* ⑦ 把这把会话记回 state 行：重复回调（刷新/预取）时可以原样重放，
        不会因为一次性 code 已被用掉而把用户挡在「授权状态校验失败」 */
  if (check.ok && returnedState) await saveStateResult(returnedState, sessionToken);

  const dest = new URL(check.ok ? (check.returnTo ?? "/home") : "/home", origin);
  const res = NextResponse.redirect(dest);
  res.cookies.set(sessionCookieOptions(sessionToken));
  return res;
}
