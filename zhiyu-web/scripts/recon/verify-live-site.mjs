#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * 线上浏览器验收（走真实用户路径）。
 *
 * 为什么不用纯 HTTP 断言：生产环境对未登录用户**跳登录页**（307）是预期行为，
 * 纯 HTTP 检查会把「正确」判成「失败」。用浏览器才能走完
 * 登录 → 各页面 → 交互 的完整链路。
 *
 * 用法：node RECON/verify-live-site.mjs
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "https://www.zhiyuapp.site";
const OUT = path.join(RECON_DIR, "shots-online");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

const snap = () =>
  page.evaluate(() => ({
    path: location.pathname,
    heading:
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("h2")?.textContent?.trim() ||
      "",
    textLen: (document.body.innerText || "").trim().length,
    body: (document.body.innerText || "").slice(0, 400),
  }));

console.log(`线上浏览器验收：${BASE}`);
console.log("=".repeat(82));

/* ① 未登录时受保护页应跳登录页（安全行为，不是 bug） */
{
  await page.goto(`${BASE}/notify`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  const s = await snap();
  rec("未登录访问 /notify 跳回登录页（不泄露数据）",
    s.path === "/" && !s.body.includes("消息流"),
    `最终路径 ${s.path}，标题「${s.heading}」`);
}

/* ② 登录页 */
{
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);
  const s = await snap();
  rec("登录页渲染", s.path === "/" && s.textLen > 200,
    `标题「${s.heading}」，正文 ${s.textLen} 字`);
  const hasDemoBtn = await page.evaluate(() =>
    /* 线上按钮文案是「使用知乎账号登录」（未配置 OAuth 时它走服务端演示登录），
       所以匹配「知乎」而不是「演示」——之前按「演示」找，白白误判成没有入口。 */
    [...document.querySelectorAll("button")].some((b) => /知乎|登录/.test(b.textContent)),
  );
  rec("登录页有登录入口", hasDemoBtn);
  await page.screenshot({ path: path.join(OUT, "01-login.png") });
}

/* ③ 点登录 */
{
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /知乎|登录/.test(x.textContent));
    if (b) {
      b.scrollIntoView({ block: "center" });
      b.click();
    }
  });
  await page.waitForTimeout(8000);
  const s = await snap();
  rec("点登录后不再停在登录页", s.path !== "/",
    `最终路径 ${s.path}`);
  console.log(`      正文片段：${s.body.replace(/\s+/g, " ").slice(0, 110)}`);
  await page.screenshot({ path: path.join(OUT, "02-after-login.png") });
}

/* ④ 逐页访问 */
const PAGES = [
  ["首页", "/home", "03-home"],
  ["发现页", "/find", "04-find"],
  ["我的人格", "/persona", "05-persona"],
  ["Agent 匹配", "/agent-match", "06-agent-match"],
  ["通知", "/notify", "07-notify"],
  ["设置", "/settings", "08-settings"],
];
for (const [name, p, shot] of PAGES) {
  await page.goto(BASE + p, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2800);
  const s = await snap();
  const stuck = s.path === "/" && p !== "/";
  rec(`${name} ${p}`, !stuck && s.textLen > 150,
    `路径 ${s.path}，标题「${s.heading}」，正文 ${s.textLen} 字`);
  if (stuck) {
    console.log(`      ⚠ 被跳回登录页，正文：${s.body.replace(/\s+/g, " ").slice(0, 130)}`);
  }
  await page.screenshot({ path: path.join(OUT, `${shot}.png`) });
}

/* ⑤ 数据是否真的在 */
{
  await page.goto(`${BASE}/find`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2800);
  const info = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      nodes: document.querySelectorAll("[data-id]").length,
      says16: t.includes("16"),
      head: t.replace(/\s+/g, " ").slice(0, 160),
    };
  });
  rec("发现页有候选数据", info.nodes > 0 || info.says16,
    `候选元素 ${info.nodes} 个，含"16"=${info.says16}｜${info.head}`);
}

/* ⑥ 静态资源 */
{
  const failed = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2800);
  rec("页面加载无资源失败", failed.length === 0, failed.slice(0, 4).join(" | ") || "全部成功");
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));

await browser.close();
console.log("=".repeat(82));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
console.log("截图已存到 RECON/shots-online/");
process.exit(fail ? 1 : 0);
