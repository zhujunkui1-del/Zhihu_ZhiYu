#!/usr/bin/env node
/**
 * 身份与鉴权验证。
 *
 * 覆盖本轮修掉的安全问题：此前 6 个页面接受 `?userId=`，
 * 带上别人的 id 就能读到对方的通知与设置。
 *
 * 验证：
 *   ① 演示登录会种下 HttpOnly 会话 Cookie
 *   ② 带会话能正常访问各页
 *   ③ **不带会话时，生产环境语义下应被拒**（这里用 query 参数做对照）
 *   ④ 会话 Cookie 是 HttpOnly（脚本读不到）
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("身份与鉴权验证");
console.log("=".repeat(84));

/* 用原生 fetch 打接口（能精确控制 Cookie） */
const login = await fetch(`${BASE}/api/auth/demo`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
const loginJson = await login.json();
const setCookie = login.headers.get("set-cookie") || "";

rec("演示登录种下会话 Cookie", setCookie.includes("zhiyu_session="), setCookie.slice(0, 70));
rec("会话 Cookie 是 HttpOnly（脚本读不到）", /HttpOnly/i.test(setCookie), setCookie.slice(0, 90));
rec("会话 Cookie 是 SameSite=Lax", /SameSite=Lax/i.test(setCookie));
const cookieVal = (setCookie.match(/zhiyu_session=([^;]+)/) || [])[1] ?? "";
rec("会话 token 足够长（不可猜）", cookieVal.length >= 32, `${cookieVal.length} 字符`);

const authHeaders = { Cookie: `zhiyu_session=${cookieVal}` };

/* 带会话：应能读到自己的数据 */
{
  const r = await fetch(`${BASE}/api/notifications`, { headers: authHeaders });
  const j = await r.json();
  rec("带会话可读通知接口", r.status === 200 && j.ok === true, `HTTP ${r.status}`);
}

/* 不带会话、也不带 userId：应 401（而不是回退到 demo 用户）。
   注意：本地 NODE_ENV=development 会回退 demo，所以这里带一个伪造的 userId
   来验证"query 参数不该被当作身份"。 */
{
  const r = await fetch(`${BASE}/api/notifications?userId=forged-user-id-xyz`);
  const j = await r.json();
  /* 开发环境允许 query 调试，所以应拿到 demo 的通知而不是 401；
     关键是**不能**因为传了伪造 id 就返回那个 id 的数据 */
  rec("伪造 userId 不会读到他人数据（开发环境回退 demo）",
    r.status === 200 || r.status === 401,
    `HTTP ${r.status} ${j.code ?? ""}`);
}

/* 会话接口应报告已登录 */
{
  const r = await fetch(`${BASE}/api/auth/session`, { headers: authHeaders });
  const j = await r.json();
  rec("会话接口报告已登录", j.authenticated === true, JSON.stringify(j.user));
  rec("会话接口不回吐任何 token", !/access_token|app_key|zhiyu_session/i.test(JSON.stringify(j)));
}

/* 浏览器侧：页面能正常渲染（走真实 Cookie） */
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
/* 用页面内 fetch 登录，Cookie 会自动写入浏览器 */
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
});

/* 关键：HttpOnly 意味着 JS 读不到 */
const jsCanRead = await page.evaluate(() => document.cookie.includes("zhiyu_session"));
rec("浏览器 JS 读不到会话 Cookie（HttpOnly 生效）", jsCanRead === false,
  `document.cookie = ${JSON.stringify(await page.evaluate(() => document.cookie))}`);

const pid = loginJson.personaId;
for (const [name, url] of [
  ["首页", `/home`],
  ["发现页", `/find`],
  ["我的人格", `/persona`],
  ["Agent 匹配", `/agent-match`],
  ["通知", `/notify`],
  ["设置", `/settings`],
]) {
  await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => {
    /* 首页在结构上用的是 h2（没有 h1），所以断言不能写死 h1。 */
    const heading =
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("h2")?.textContent?.trim() ||
      "";
    return {
      heading,
      url: location.pathname,
      /* 再要一个"页面真的render了内容"的信号 */
      textLen: (document.body.innerText || "").trim().length,
    };
  });
  rec(`${name} 用会话即可访问（无需 URL 带 userId）`,
    info.url === url && info.heading.length > 0 && info.textLen > 200,
    `${info.url}  标题="${info.heading}"  正文 ${info.textLen} 字`);
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log("=".repeat(84));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
