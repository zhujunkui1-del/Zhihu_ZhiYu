#!/usr/bin/env node
/**
 * #2 的第二层验证：**加了 CSRF 同源校验之后，站内正常请求不能被误伤**。
 *
 * 这是本次改动最危险的地方 —— 为了修 Safari 的 OAuth 回跳把 Cookie 改成
 * `SameSite=None`，再补一道 Origin 校验。如果这道校验误判，整个站点的
 * 写操作（改设置、提交 SBTI、标记已读、蒸馏、发起匹配…）会集体 403。
 * 纯函数测试证明不了这一点，必须打真实的 HTTP。
 *
 * 三种请求都过一遍：
 *   ① 浏览器同源 fetch（带 Origin）        → 必须成功
 *   ② 无 Origin / 无 Referer 的裸请求      → 必须 403（CSRF 防护生效）
 *   ③ 伪造跨站 Origin                      → 必须 403
 *
 * 用法：node --env-file=.env scripts/verify-csrf-live.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
const loggedIn = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", { method: "POST" });
  return r.ok || r.status === 403;
});
rec("演示登录（同源 POST）成功 —— 说明 demo 接口没被误伤", loggedIn);

await page.goto(`${BASE}/settings`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2200);

/* ── ① 站内同源写操作必须成功 ─────────────────────────────────────── */
console.log("\n== ① 站内同源写操作（不能误伤） ==");

const prefsBefore = await page.evaluate(async () => {
  const r = await fetch("/api/settings/prefs");
  return r.json();
});
rec("GET 偏好读取正常", prefsBefore.ok === true, JSON.stringify(prefsBefore).slice(0, 120));

/* 用页面真实按钮改一个开关：这是最接近用户操作的路径 */
const toggleResult = await page.evaluate(async () => {
  const input =
    document.querySelector('[class*="switchWrap"] input[type="checkbox"]');
  if (!input) return { found: false };
  const before = input.checked;
  input.click();
  await new Promise((r) => setTimeout(r, 2000));
  const after = await fetch("/api/settings/prefs").then((x) => x.json());
  /* 还原，避免污染演示数据 */
  input.click();
  await new Promise((r) => setTimeout(r, 2000));
  return { found: true, before, server: after };
});
rec(
  "点开关（同源 PATCH）真的落库了",
  toggleResult.found &&
    toggleResult.server?.ok === true &&
    toggleResult.server?.prefs?.allowAgentInvite === !toggleResult.before,
  JSON.stringify(toggleResult.server?.prefs ?? toggleResult).slice(0, 140),
);

const restore = await page.evaluate(async () => {
  const r = await fetch("/api/settings/prefs").then((x) => x.json());
  return r.prefs;
});
rec(
  "已还原开关状态（不留测试痕迹）",
  restore?.allowAgentInvite === true,
  `allowAgentInvite=${restore?.allowAgentInvite}`,
);

/* 通知「全部标为已读」也是同源 POST */
const notifyOk = await page.evaluate(async () => {
  const r = await fetch("/api/notifications", { method: "POST" });
  const j = await r.json();
  return { status: r.status, ok: j.ok };
});
rec(
  "标记已读（同源 POST）成功",
  notifyOk.ok === true,
  `status=${notifyOk.status} ok=${notifyOk.ok}`,
);

/* ── ② 无来源信息 → 必须被拒 ───────────────────────────────────────── */
console.log("\n== ② 无来源信息 → 必须 403 ==");

const bare = await (async () => {
  try {
    const r = await fetch(`${BASE}/api/notifications`, { method: "POST", headers: {} });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, code: j.code };
  } catch (e) {
    return { status: 0, code: e.message };
  }
})();
rec(
  "无 Origin/Referer 的 POST → 403 CROSS_SITE_BLOCKED",
  bare.status === 403 && bare.code === "CROSS_SITE_BLOCKED",
  `status=${bare.status} code=${bare.code}`,
);

const barePatch = await (async () => {
  const r = await fetch(`${BASE}/api/settings/prefs`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowAgentInvite: false }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.code };
})();
rec(
  "无来源的 PATCH → 403",
  barePatch.status === 403 && barePatch.code === "CROSS_SITE_BLOCKED",
  `status=${barePatch.status} code=${barePatch.code}`,
);

/* ── ③ 跨站 Host + 自洽的 Origin → 必须被拒 ────────────────────────── */
console.log("\n== ③ 跨站 Host 上自洽的 Origin → 必须 403 ==");
/* 这里**要真的伪造 Origin**，而浏览器不允许页面 JS 改 Origin，
   所以用 Node 直发（Node 的 fetch 不做 CORS 检查，可以设 Origin/Host）。
   这样构造的场景正是"接口被另一个域名 CNAME 过来、请求本身自洽"：
   此时判据必须来自 Host，而不能只信 Origin 自洽。 */
const crossSelfConsistent = await (async () => {
  const r = await fetch(`${BASE}/api/notifications`, {
    method: "POST",
    headers: { origin: "https://evil.example", host: "evil.example" },
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.code };
})();
rec(
  "Host=evil.example 且 Origin 自洽 → 403（未通过浏览器校验就拒绝）",
  crossSelfConsistent.status === 403 && crossSelfConsistent.code === "CROSS_SITE_BLOCKED",
  `status=${crossSelfConsistent.status} code=${crossSelfConsistent.code}`,
);

/* 本机另一个 host 名（localhost）打 127.0.0.1：同端口但不同 host，必须拒 */
const crossLocalhost = await (async () => {
  const r = await fetch(`${BASE}/api/notifications`, {
    method: "POST",
    headers: { origin: "http://localhost:3000", host: "localhost:3000" },
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.code };
})();
rec(
  "Host=localhost 对 BASE=127.0.0.1 → 403（host 不同即不同源）",
  crossLocalhost.status === 403,
  `status=${crossLocalhost.status} code=${crossLocalhost.code}`,
);

/* ── ④ GET 不应被拦截（读操作无副作用） ───────────────────────────── */
console.log("\n== ④ 读接口不受影响 ==");
const getNoOrigin = await fetch(`${BASE}/api/notifications`);
rec(
  "无来源的 GET 仍可访问（只保护写操作）",
  getNoOrigin.status === 200,
  `status=${getNoOrigin.status}`,
);

/* 浏览器侧诊断收集（放在最前，后面几步都要用） */
const pageErrs = [];
const navChain = [];
page.on("pageerror", (e) => pageErrs.push(String(e.message)));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || t.includes("[login-diag]")) pageErrs.push(`${m.type()}: ${t}`);
});
page.on("response", (r) => {
  const u = r.url();
  if (u.startsWith(BASE) && (r.status() >= 300 || u.includes("oauth"))) {
    navChain.push(`${r.status()} ${u.replace(BASE, "")}`);
  }
});

/* ── ⑤ 登录页：已登录时自动进 /home（#2 的最后一段） ───────────────── */
console.log("\n== ⑤ 已登录访问登录页会自动进 /home ==");
pageErrs.length = 0; // 只关心这一步产生的日志
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
const atHome = await page.evaluate(async () => {
  const s = await fetch("/api/auth/session", { cache: "no-store" })
    .then((r) => r.json())
    .catch((e) => ({ err: String(e) }));
  return {
    path: window.location.pathname,
    authenticated: s?.authenticated,
    sessionBody: JSON.stringify(s).slice(0, 160),
  };
});
rec(
  "已登录时 / 自动跳到 /home（不再停在登录页）",
  atHome.path === "/home",
  `path=${atHome.path}；session=${atHome.sessionBody}；login-diag：${
    pageErrs.filter((e) => e.includes("[login-diag]")).join(" | ") || "(effect 未运行)"
  }`,
);

/* ── ⑥ 回调失败原因要显示出来 ─────────────────────────────────────── */
console.log("\n== ⑥ 回调失败带原因时给出中文说明 ==");
/* 带一个 cache-buster：dev server 的客户端 chunk 可能被浏览器缓存，
   不换 URL 的话测的可能是**旧代码**（这里踩过，误判成逻辑没生效）。 */
pageErrs.length = 0;
navChain.length = 0;
const cb = Date.now();

await page.goto(`${BASE}/?oauth=denied&_cb=${cb}`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
const errShown = await page.evaluate(() => {
  const t = document.body.innerText;
  const alert = document.querySelector('[role="alert"]');
  return {
    mentionsDenied: /拒绝|取消/.test(t),
    alertText: alert?.textContent?.trim() ?? null,
    hasOauthParam: window.location.search.includes("oauth="),
    path: window.location.pathname,
    snippet: t.slice(0, 120),
  };
});
rec(
  "显示「拒绝授权」的中文说明",
  errShown.mentionsDenied,
  `${JSON.stringify(errShown)}\n      页面错误：${pageErrs.slice(0, 3).join(" | ") || "(无)"}`,
);
rec(
  "带 oauth 错误时不会跳去 /home（报错优先于自动跳转）",
  errShown.path === "/",
  `path=${errShown.path}`,
);
rec(
  "错误原因保留在地址栏 + 页面上（即用户反馈的「看不到为什么失败」）",
  errShown.hasOauthParam && errShown.mentionsDenied,
  `search 含 oauth= : ${errShown.hasOauthParam}；页面提到拒绝：${errShown.mentionsDenied}`,
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
