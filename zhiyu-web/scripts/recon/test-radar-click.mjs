#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 用「真实鼠标事件」和「JS .click()」分别测雷达点头像，找出差异
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "radar-click");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

await page.goto(BASE + "zhiyu-find.html", { waitUntil: "load" });
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('[data-view-seg="search"] button[data-view="radar"]').click());
await page.waitForTimeout(900);

/* 装一个探针，记录 click 是否到达头像 */
await page.evaluate(() => {
  window.__probe = { pointerdown: 0, pointerup: 0, clickOnAvatar: 0, clickOnViewport: 0, openProfileCalls: 0 };
  const vp = document.querySelector("#radar-search .radar-viewport");
  vp.addEventListener("pointerdown", () => { window.__probe.pointerdown += 1; }, true);
  vp.addEventListener("pointerup", () => { window.__probe.pointerup += 1; }, true);
  vp.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest(".radar-avatar")) window.__probe.clickOnAvatar += 1;
    else window.__probe.clickOnViewport += 1;
  }, true);
  const orig = window.openProfile;
  window.openProfile = function (id) { window.__probe.openProfileCalls += 1; return orig.apply(this, arguments); };
});

/* 找一个头像的屏幕坐标 */
const target = await page.evaluate(() => {
  const av = document.querySelector("#radar-search .radar-node .radar-avatar");
  if (!av) return null;
  const r = av.getBoundingClientRect();
  return {
    name: av.closest(".radar-node").querySelector(".radar-name").textContent,
    cx: Math.round(r.left + r.width / 2),
    cy: Math.round(r.top + r.height / 2),
    w: Math.round(r.width),
    h: Math.round(r.height),
    inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    /* 该坐标上真正命中的元素是谁 */
    hit: (() => { const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); return el ? el.tagName + "." + String(el.className).split(/\s+/).slice(0, 2).join(".") : null; })(),
  };
});
console.log("=== 目标头像 ===");
console.log(JSON.stringify(target, null, 2));

/* ── 1. 真实鼠标点击 ── */
await page.evaluate(() => { document.getElementById("persona-modal").classList.remove("open"); });
await page.mouse.move(target.cx, target.cy);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(600);

const realResult = await page.evaluate(() => ({
  probe: { ...window.__probe },
  modalOpen: document.getElementById("persona-modal").classList.contains("open"),
  modalTitle: document.getElementById("modal-title").textContent,
}));
console.log("\n=== 真实鼠标点击 ===");
console.log(JSON.stringify(realResult, null, 2));

/* ── 2. JS .click() ── */
await page.evaluate(() => { document.getElementById("persona-modal").classList.remove("open"); window.__probe = { pointerdown: 0, pointerup: 0, clickOnAvatar: 0, clickOnViewport: 0, openProfileCalls: 0 }; });
await page.evaluate(() => {
  document.querySelector("#radar-search .radar-node .radar-avatar").click();
});
await page.waitForTimeout(500);
const jsResult = await page.evaluate(() => ({
  probe: { ...window.__probe },
  modalOpen: document.getElementById("persona-modal").classList.contains("open"),
  modalTitle: document.getElementById("modal-title").textContent,
}));
console.log("\n=== JS .click() ===");
console.log(JSON.stringify(jsResult, null, 2));

await page.screenshot({ path: path.join(OUT, "after-real-click.png") });

console.log("\n=== JS 报错 ===");
console.log(errs.length ? errs.slice(0, 5).join("\n") : "（无）");

await browser.close();
