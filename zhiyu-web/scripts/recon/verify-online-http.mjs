/**
 * 线上站点验收。
 *
 * 覆盖：可达性 / 7 页面 / 关键接口 / 身份与安全 / 静态资源自托管。
 */
const BASE = process.env.BASE || "https://www.zhiyuapp.site";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

async function get(path, init) {
  try {
    const r = await fetch(BASE + path, { redirect: "manual", ...init });
    const text = await r.text().catch(() => "");
    return { status: r.status, headers: r.headers, text };
  } catch (e) {
    return { status: 0, headers: new Headers(), text: "", err: e.message };
  }
}

console.log(`线上验收：${BASE}`);
console.log("=".repeat(82));

/* ① 可达性 */
{
  const r = await get("/");
  rec("首页可达", r.status === 200, `HTTP ${r.status}`);
  rec("返回的是 HTML（不是静态占位）",
    (r.headers.get("content-type") ?? "").includes("text/html"),
    r.headers.get("content-type") ?? "");
  rec("由 Vercel 提供服务", (r.headers.get("server") ?? "").includes("Vercel"),
    r.headers.get("server") ?? "");
  rec("首页含产品标识「知遇」", r.text.includes("知遇"),
    `HTML ${r.text.length} 字`);
  rec("页面有 Next.js 产物引用（说明框架路由生效）",
    r.text.includes("/_next/"), "找到 /_next/ 引用");
}

/* ② 七个页面 */
const PAGES = [
  ["登录页", "/"],
  ["首页", "/home"],
  ["发现页", "/find"],
  ["我的人格", "/persona"],
  ["Agent 匹配", "/agent-match"],
  ["通知", "/notify"],
  ["设置", "/settings"],
];
for (const [name, path] of PAGES) {
  const r = await get(path);
  const isHtml = (r.headers.get("content-type") ?? "").includes("text/html");
  rec(`${name} ${path}`, r.status === 200 && isHtml, `HTTP ${r.status}`);
}

/* ③ 关键接口 */
{
  const r = await get("/api/health");
  rec("/api/health", r.status === 200, `HTTP ${r.status}  ${r.text.slice(0, 80)}`);
  const s = await get("/api/auth/session");
  let j = null;
  try { j = JSON.parse(s.text); } catch { /* 忽略 */ }
  rec("/api/auth/session 返回 JSON", s.status === 200 && j !== null, `HTTP ${s.status}`);
  rec("会话接口未登录时 authenticated=false", j?.authenticated === false, JSON.stringify(j));
  rec("会话接口不回吐 token", !/access_token|app_key/i.test(s.text));
}

/* ④ 静态资源自托管（AGENTS.md 硬约束） */
{
  const r = await get("/assets/brand/logo-zhiyu.png");
  rec("站点 logo 可访问（静态资源自托管）",
    r.status === 200 && (r.headers.get("content-type") ?? "").includes("image"),
    `HTTP ${r.status} ${r.headers.get("content-type")}`);

  const home = await get("/");
  const FOREIGN = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com", "googletagmanager", "google-analytics"];
  const found = FOREIGN.filter((d) => home.text.includes(d));
  rec("首页未引用境外第三方资源", found.length === 0, found.join(", ") || "无");
}

/* ⑤ 域名与跳转 */
{
  const apex = await fetch("https://zhiyuapp.site/", { redirect: "manual" });
  rec("裸域 301/308 跳到 www",
    apex.status === 308 || apex.status === 301,
    `HTTP ${apex.status} → ${apex.headers.get("location") ?? "-"}`);
}

/* ⑥ 演示登录能建立会话 */
{
  const r = await fetch(`${BASE}/api/auth/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    redirect: "manual",
  });
  const setCookie = r.headers.get("set-cookie") ?? "";
  rec("演示登录可用", r.status === 200, `HTTP ${r.status}`);
  rec("演示登录种下 HttpOnly 会话 Cookie",
    setCookie.includes("zhiyu_session=") && /HttpOnly/i.test(setCookie),
    setCookie.slice(0, 90));
  rec("生产环境 Cookie 带 Secure", /Secure/i.test(setCookie),
    /Secure/i.test(setCookie) ? "有" : "⚠ 无 Secure");

  const token = (setCookie.match(/zhiyu_session=([^;]+)/) || [])[1] ?? "";
  if (token) {
    const n = await fetch(`${BASE}/api/notifications`, {
      headers: { Cookie: `zhiyu_session=${token}` },
    });
    rec("带会话可读通知接口", n.status === 200, `HTTP ${n.status}`);
  }
}

console.log("=".repeat(82));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
