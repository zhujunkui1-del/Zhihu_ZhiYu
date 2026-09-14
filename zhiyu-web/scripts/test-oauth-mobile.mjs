#!/usr/bin/env node
/**
 * #2「手机端授权后跳回登录页」修复 + CSRF 补强的验证。
 *
 * 背景：手机端"授权完又回到登录页"的根因是 **Safari 在 OAuth 回跳流程里
 * 不发送 `SameSite=Lax` 的 Cookie**（WebKit bug 219650）。修法是生产环境
 * 改用 `SameSite=None; Secure`。
 *
 * 这带来一个新风险：Cookie 这条隐式 CSRF 防线没了。所以同一批改动里
 * 必须补上显式的同源校验（lib/auth/csrf.ts），本文件两块都验。
 *
 * ⚠️ 关键：`sessionCookieOptions()` 读的是进程的 `NODE_ENV`，
 *    必须在 **import 之前** 设定，否则测的还是同一个分支。
 *
 * 用法：node scripts/test-oauth-mobile.mjs
 */
import assert from "node:assert/strict";

/* Cookie 属性放在无依赖的模块里，正是为了能这样直接 import */
let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/* ── 生产环境下的 Cookie 属性 ─────────────────────────────────────────── */
console.log("\n== 生产环境：会话 Cookie 必须是 SameSite=None; Secure ==");
process.env.NODE_ENV = "production";
/* 注意：必须 import 无依赖的 ./cookie，不能 import ./session
   —— 后者会拉进 Prisma 与 `@/` 别名，纯 Node 解析不了。 */
const {
  sessionCookieOptions,
  clearedSessionCookieOptions,
  SESSION_COOKIE,
} = await import("../lib/auth/cookie.ts");

{
  const o = sessionCookieOptions("tok-abc");
  rec("name 是 zhiyu_session", o.name === SESSION_COOKIE, o.name);
  rec(
    "SameSite=None（Safari OAuth 回跳的关键）",
    o.sameSite === "none",
    `sameSite=${o.sameSite}`,
  );
  rec("Secure=true（SameSite=None 的必要条件）", o.secure === true, `secure=${o.secure}`);
  rec("HttpOnly=true（脚本读不到）", o.httpOnly === true, `httpOnly=${o.httpOnly}`);
  rec("Path=/", o.path === "/", o.path);
  rec("maxAge 约 30 天", o.maxAge === 30 * 24 * 60 * 60, `${o.maxAge}s`);

  const c = clearedSessionCookieOptions();
  rec(
    "清除 Cookie 的属性与写入时一致（否则删不掉 → 退不出去）",
    c.sameSite === o.sameSite && c.secure === o.secure && c.path === o.path,
    `sameSite=${c.sameSite} secure=${c.secure} path=${c.path}`,
  );
  rec("清除时 maxAge=0", c.maxAge === 0, `${c.maxAge}`);
}

/* ── CSRF 同源校验 ───────────────────────────────────────────────────── */
console.log("\n== CSRF：同源校验（补上 SameSite 削弱后的防线） ==");
/* 同样只 import 无框架依赖的纯判定模块 */
const { sameOriginVerdict } = await import("../lib/auth/same-origin.ts");

const SELF = "https://www.zhiyuapp.site";
/** 造一个最小的请求替身；headers.get 只认小写键（与 Headers 行为一致） */
const mk = (headers) => {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return { origin: SELF, headers: { get: (n) => lower[n.toLowerCase()] ?? null } };
};

{
  const v = sameOriginVerdict(mk({ origin: SELF }));
  rec("同源 Origin → 放行", v.ok === true, `${v.ok} ${v.seen ?? ""}`);
}
{
  const v = sameOriginVerdict(mk({ origin: "https://evil.example" }));
  rec("跨站 Origin → 拒绝", v.ok === false, `${v.reason} (${v.seen})`);
}
{
  const v = sameOriginVerdict(mk({ origin: "https://www.zhiyuapp.site.evil.com" }));
  rec(
    "后缀伪装域名（zhiyuapp.site.evil.com）→ 拒绝",
    v.ok === false,
    `${v.reason} (${v.seen})`,
  );
}
{
  const v = sameOriginVerdict(mk({ origin: "http://www.zhiyuapp.site" }));
  rec("协议降级（http）→ 拒绝", v.ok === false, `${v.reason} (${v.seen})`);
}
{
  const v = sameOriginVerdict(mk({ origin: "https://zhiyuapp.site" }));
  rec(
    "apex 与 www 视为不同源 → 拒绝（避免跨主机名 CSRF）",
    v.ok === false,
    `${v.reason} (${v.seen})`,
  );
}
{
  const v = sameOriginVerdict(mk({ referer: `${SELF}/settings` }));
  rec("无 Origin、Referer 同源 → 放行", v.ok === true, `${v.ok} ${v.seen ?? ""}`);
}
{
  const v = sameOriginVerdict(mk({ referer: "https://evil.example/x" }));
  rec("无 Origin、Referer 跨站 → 拒绝", v.ok === false, `${v.reason}`);
}
{
  const v = sameOriginVerdict(mk({}));
  rec("两者都没有 → 拒绝（不静默放行）", v.ok === false, `${v.reason}`);
}
{
  const v = sameOriginVerdict(mk({ referer: "不是个 URL" }));
  rec("Referer 无法解析 → 拒绝", v.ok === false, `${v.reason}`);
}
{
  /* Origin 优先于 Referer：伪造网关场景下 Origin 是权威 */
  const v = sameOriginVerdict(mk({ origin: SELF, referer: "https://evil.example/x" }));
  rec("Origin 同源但有跨站 Referer → 以 Origin 为准放行", v.ok === true, `${v.ok}`);
}
{
  const v = sameOriginVerdict(mk({ origin: "https://evil.example", referer: `${SELF}/x` }));
  rec("Origin 跨站但 Referer 同源 → 以 Origin 为准拒绝", v.ok === false, `${v.reason}`);
}

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
process.exit(fail ? 1 : 0);
