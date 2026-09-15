#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 渲染 logo 尺寸验收页
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const ROOT = path.resolve("前端UI/知乎黑客松产品_知遇ZhiYu18");
const PORT = 4191;
const MIME = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
  const f = path.join(ROOT, rel);
  fs.readFile(f, (e, b) => {
    if (e) return res.writeHead(404).end("404");
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    res.end(b);
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("response", (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await page.goto(`http://127.0.0.1:${PORT}/_logo-check.html`, { waitUntil: "load" });
await page.waitForTimeout(900);
console.log("errors:", errs.length ? errs.slice(0, 6).join(" | ") : "none");

const bad = await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll("img")];
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => { i.onload = r; i.onerror = r; }))));
  return imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src"));
});
if (bad.length) console.log("未加载:", bad.join(", "));

const OUT = path.join(RECON_DIR, "logo-gen/logo-size-check.png");
await page.screenshot({ path: OUT, fullPage: true });
console.log("→", path.relative(process.cwd(), OUT));

await browser.close();
server.close();
