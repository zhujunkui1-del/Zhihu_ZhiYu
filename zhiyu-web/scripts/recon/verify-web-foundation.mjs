#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * zhiyu-web 地基验证：新设计 token + 共享壳
 *
 * 重要：/home 与 /persona 带**会话守卫**——无会话时 router.replace("/")。
 * 因此必须先用真实接口建立会话（模拟用户从登录页进入），
 * 否则会把"守卫正常工作"误判成"侧栏没渲染"。
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = path.join(RECON_DIR, "web-foundation");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const errs = [];
const failed = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

/* 先建立演示会话：必须先落到同源页面，相对 fetch 才有正确 origin。
   （在 about:blank 上 evaluate 会因跨源失败——这个坑实际踩过。） */
await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(500);
const session = await page.evaluate(async () => {
  const resp = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "地基验证用户" }),
  });
  return resp.json();
}).catch(() => null);

console.log("zhiyu-web 地基验证（新 token + 共享壳）");
console.log("=".repeat(84));
if (session && session.ok) {
  console.log(`会话已建立：userId=${String(session.userId).slice(0, 12)}… personaId=${String(session.personaId).slice(0, 12)}…`);
} else {
  console.log("⚠ 未能建立会话，受保护页面会被守卫重定向");
}

const rows = [];
for (const route of ["/", "/home", "/find", "/persona", "/agent-match", "/notify"]) {
  /* 每个路由前确保 localStorage 里有会话 */
  if (session && session.ok) {
    await page.evaluate((s) => {
      try {
        localStorage.setItem("zhiyu_demo", JSON.stringify({ userId: s.userId, personaId: s.personaId }));
      } catch { /* ignore */ }
    }, session);
  }
  const before = errs.length;
  await page.goto(BASE + route, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const sidebar = document.querySelector("aside");
    const navLinks = sidebar ? [...sidebar.querySelectorAll("a")].map((a) => a.textContent.trim()) : [];
    const brandImg = document.querySelector('aside img[src*="/assets/logo/"]');
    const signboard = document.querySelector('aside img[src*="/assets/decor/"]');
    const plate = brandImg ? brandImg.parentElement : null;
    return {
      tokens: {
        bg: cs.getPropertyValue("--bg").trim(),
        accent: cs.getPropertyValue("--accent").trim(),
        fg: cs.getPropertyValue("--fg").trim(),
        zhihu: cs.getPropertyValue("--zhihu-blue").trim(),
      },
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hasPaper: getComputedStyle(document.body).backgroundImage.includes("paper.png"),
      hasSidebar: !!sidebar,
      navLinks,
      brandLoaded: brandImg ? brandImg.complete && brandImg.naturalWidth > 0 : null,
      plateBox: plate ? (() => { const b = plate.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; })() : null,
      signboardLoaded: signboard ? signboard.complete && signboard.naturalWidth > 0 : null,
      h1Font: document.querySelector("h1") ? getComputedStyle(document.querySelector("h1")).fontFamily.split(",")[0] : null,
      path: location.pathname,
    };
  });

  rows.push({ route, ...info, newErrs: errs.length - before });
  await page.screenshot({ path: path.join(OUT, `route-${route.replace(/\//g, "_") || "_root"}.png`) });
}

await browser.close();

let pass = 0;
let fail = 0;
for (const r of rows) {
  const tokenOk = r.tokens.bg === "#f8f0df" && r.tokens.accent === "#e2664f" && r.tokens.fg === "#381508";
  const shouldHaveShell = r.route !== "/";
  const stayedOnRoute = r.path === r.route;
  const shellOk = shouldHaveShell ? r.hasSidebar && stayedOnRoute : true;
  const ok = tokenOk && shellOk && r.newErrs === 0 && r.brandLoaded !== false && r.signboardLoaded !== false;
  if (ok) pass += 1; else fail += 1;
  console.log(`\n${ok ? "✓" : "✗"} ${r.route}${stayedOnRoute ? "" : `  ← 被重定向到 ${r.path}`}`);
  console.log(`   token  bg=${r.tokens.bg} accent=${r.tokens.accent} fg=${r.tokens.fg} 知乎蓝=${r.tokens.zhihu}`);
  console.log(`   body   bgColor=${r.bodyBg} 纸纹=${r.hasPaper ? "有" : "无"}  h1字体=${r.h1Font}`);
  console.log(`   壳     侧栏=${r.hasSidebar ? "有" : "无"}  品牌标=${r.plateBox ?? "无"}  导航项=${r.navLinks.length}`);
  console.log(`   资源   logo=${r.brandLoaded === null ? "该页无" : r.brandLoaded ? "OK" : "破图"}  木牌=${r.signboardLoaded === null ? "该页无" : r.signboardLoaded ? "OK" : "破图"}  新增报错=${r.newErrs}`);
}

console.log("\n" + "=".repeat(84));
console.log(`合计 ${rows.length} 个路由：通过 ${pass}，失败 ${fail}`);
if (errs.length) { console.log("\n页面报错："); errs.slice(0, 6).forEach((e) => console.log("  " + e.slice(0, 160))); }
if (failed.length) { console.log("\n资源失败："); [...new Set(failed)].slice(0, 8).forEach((e) => console.log("  " + e)); }
process.exit(fail ? 1 : 0);
