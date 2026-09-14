#!/usr/bin/env node
/**
 * 认证路由的 HTTP 集成测试。
 *
 * 为什么不直接 import lib 测：`lib/auth/session.ts` 用了 `@/lib/db` 路径别名，
 * 裸 Node 解析不了。走真实 HTTP 反而更接近真实集成 ——
 * 连带把「Cookie 是否 HttpOnly / 是否正确清除 / 未配置时是否回退」一起验证了。
 *
 * 用法：node --env-file=.env scripts/test-auth-routes.mjs [BASE]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

const TAG = `rt${Date.now().toString(36)}`;
const COOKIE = "zhiyu_session";
let userId = "";

console.log("认证路由 HTTP 集成测试");
console.log("=".repeat(80));

try {
  /* 准备一个测试用户 */
  const u = await prisma.user.create({ data: { username: `oauth-test-${TAG}` } });
  userId = u.id;

  /* ── ① 会话查询：未登录 ─────────────────────────────────────────────── */
  {
    const r = await fetch(`${BASE}/api/auth/session`);
    const j = await r.json();
    rec("GET /api/auth/session 返回 200", r.status === 200, `HTTP ${r.status}`);
    rec("未登录时 authenticated 为 false", j.authenticated === false, JSON.stringify(j));
    rec("回吐 oauthConfigured 供前端决定是否回退演示登录",
      typeof j.oauthConfigured === "boolean", `oauthConfigured=${j.oauthConfigured}`);
    rec("未登录时不回吐任何用户信息", j.user === null);
    const body = JSON.stringify(j);
    rec("响应体不含 token 字段",
      !/access_token|app_key|token/i.test(body), body.slice(0, 90));
  }

  /* ── ② 伪造 Cookie 无效 ─────────────────────────────────────────────── */
  {
    const r = await fetch(`${BASE}/api/auth/session`, {
      headers: { Cookie: `${COOKIE}=forged-token-${TAG}` },
    });
    const j = await r.json();
    rec("伪造的会话 Cookie 不被认可", j.authenticated === false, JSON.stringify(j));
  }

  /* ── ③ 真实会话：读得到 ─────────────────────────────────────────────── */
  {
    const token = `e2e-${TAG}-valid`;
    await prisma.authSession.create({
      data: {
        token,
        userId,
        /* 不设 zhihuTokenEnc：这条测的是会话读取本身 */
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { displayName: `路由测试用户${TAG}`, zhihuAuthorized: true },
    });

    const r = await fetch(`${BASE}/api/auth/session`, {
      headers: { Cookie: `${COOKIE}=${token}` },
    });
    const j = await r.json();
    rec("有效会话被识别为已登录", j.authenticated === true, JSON.stringify(j.user));
    rec("回吐展示所需的最小信息",
      j.user?.userId === userId && j.user?.displayName === `路由测试用户${TAG}`,
      `${j.user?.displayName}`);
    rec("zhihuAuthorized 透传正确", j.user?.zhihuAuthorized === true);
    rec("响应体仍不含 token", !/access_token|app_key/i.test(JSON.stringify(j)));
  }

  /* ── ④ 过期会话不被认可 ─────────────────────────────────────────────── */
  {
    const token = `e2e-${TAG}-expired`;
    await prisma.authSession.create({
      data: { token, userId, expiresAt: new Date(Date.now() - 1000) },
    });
    const r = await fetch(`${BASE}/api/auth/session`, {
      headers: { Cookie: `${COOKIE}=${token}` },
    });
    const j = await r.json();
    rec("过期会话不被认可", j.authenticated === false, JSON.stringify(j));

    const gone = await prisma.authSession.findUnique({ where: { token } });
    rec("过期会话被顺带清理出库", gone === null);
  }

  /* ── ⑤ 退出登录：服务端删除 + 清 Cookie ─────────────────────────────── */
  {
    const token = `e2e-${TAG}-logout`;
    await prisma.authSession.create({
      data: { token, userId, expiresAt: new Date(Date.now() + 3600_000) },
    });

    const r = await fetch(`${BASE}/api/auth/session`, {
      method: "DELETE",
      headers: { Cookie: `${COOKIE}=${token}` },
    });
    const j = await r.json();
    rec("DELETE /api/auth/session 返回 ok", r.status === 200 && j.ok === true, JSON.stringify(j));

    const setCookie = r.headers.get("set-cookie") || "";
    rec("响应要求清除会话 Cookie",
      setCookie.includes(`${COOKIE}=`) && /Max-Age=0/i.test(setCookie),
      setCookie.slice(0, 80));
    rec("清除时仍带 HttpOnly", /HttpOnly/i.test(setCookie), setCookie.slice(0, 80));

    const gone = await prisma.authSession.findUnique({ where: { token } });
    rec("服务端会话记录已删除", gone === null);
  }

  /* ── ⑥ /api/auth/zhihu 的两种状态 ───────────────────────────────────── */
  {
    /* 这个端点的行为**取决于服务端是否配好 OAuth**，所以两种都要覆盖：
       · 配好了 → 302/307 到知乎授权页（这一条才是真实上线后的行为）
       · 没配好 → 回登录页并带 oauth=unconfigured 标记（保证站点仍可用）
       之前只断言后者，OAuth 一配上就误报失败。 */
    const r = await fetch(`${BASE}/api/auth/zhihu`, { redirect: "manual" });
    const loc = r.headers.get("location") || "";

    rec("/api/auth/zhihu 返回重定向（不 500）",
      r.status >= 300 && r.status < 400 && loc.length > 0,
      `HTTP ${r.status} → ${loc.slice(0, 70)}`);

    const toZhihu = loc.startsWith("https://openapi.zhihu.com/authorize");
    const toLogin = loc.includes("oauth=unconfigured");

    rec("已配置 OAuth 时跳知乎授权页；未配置时回登录页并标记",
      toZhihu || toLogin,
      toZhihu ? `→ 知乎授权页（已配置）` : toLogin ? `→ 登录页标记（未配置）` : loc.slice(0, 90));

    if (toZhihu) {
      const u = new URL(loc);
      rec("授权 URL 带 app_id / response_type / state 三项",
        Boolean(u.searchParams.get("app_id")) &&
          u.searchParams.get("response_type") === "code" &&
          (u.searchParams.get("state") ?? "").length >= 32,
        `app_id=${u.searchParams.get("app_id")} state长度=${(u.searchParams.get("state") ?? "").length}`);
    }
  }

  /* ── ⑦ 回调的兜底处理 ──────────────────────────────────────────────── */
  {
    /* 不带 code / state 直接打回调：无论 OAuth 是否配置，都必须**返回重定向**
       而不是 500（否则用户从知乎回来会看到白页）。 */
    const r = await fetch(`${BASE}/api/auth/zhihu/callback`, { redirect: "manual" });
    const loc = r.headers.get("location") || "";
    rec("回调缺参数时不 500，而是重定向回登录页",
      r.status >= 300 && r.status < 400 && loc.includes("oauth="),
      `HTTP ${r.status} → ${loc.slice(0, 80)}`);
  }
} catch (e) {
  console.error("测试异常:", e.message);
  fail += 1;
} finally {
  try {
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.persona.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  } catch (e) {
    console.warn("清理失败（不影响结论）:", e.message);
  }
  await prisma.$disconnect();
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
