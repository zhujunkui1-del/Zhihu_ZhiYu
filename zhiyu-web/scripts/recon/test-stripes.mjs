#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 验证三处「匹配结果 / 匹配报告」背景已从条纹纹理改为纯色 #FDF6E8
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "stripes-verify");
fs.mkdirSync(OUT, { recursive: true });

const WANT = "rgb(253, 246, 232)"; // #FDF6E8（独立成块的区域）
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const out = [];

/**
 * 断言口径随最终方案调整：
 *  · .quick-result 是独立区块 → 应有自己的底色 #FDF6E8
 *  · .rep-dims / .dim-list 在弹窗内 → 应为透明，让弹窗自己的纸底贯通
 *    （给弹窗内的容器加纯色会在 padding 区露出硬边色带，
 *      看起来就像「容器到一半、文字在外面」，这是实测踩过的坑）
 *  · 一律不得再有 stripes.png
 */
async function probe(file, label, steps) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(BASE + file, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const r = await page.evaluate(steps);
  out.push({ label, file, ...r, errs });
  await page.screenshot({ path: path.join(OUT, path.basename(file, ".html") + ".png") });
  await page.close();
}

/* ① 发现页：快速匹配结果（独立区块，应为纯色 #FDF6E8） */
await probe("zhiyu-find.html", "发现页 · 快速匹配结果（独立区块）", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('[data-tab="quick"]').click();
  await wait(250);
  document.getElementById("quick-run").click();
  await wait(1800);
  const el = document.getElementById("quick-result");
  const cs = getComputedStyle(el);
  return {
    bgColor: cs.backgroundColor,
    bgImage: cs.backgroundImage,
    ok: cs.backgroundColor === "rgb(253, 246, 232)" && cs.backgroundImage === "none",
  };
});

/* ② Agent 匹配页：报告弹窗（容器应透明，弹窗纸底贯通） */
await probe("zhiyu-agent-match.html", "Agent 匹配页 · 报告容器透明", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById("tab-reports").click();
  await wait(300);
  const btn = document.querySelector("#rep-list button");
  if (btn) { btn.click(); await wait(500); }
  const dims = document.querySelector(".modal.open .rep-dims");
  const list = document.querySelector(".modal.open .dim-list");
  const dialog = document.querySelector(".modal.open .modal-dialog");
  const clean = (el) => el && getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(el).backgroundImage === "none";
  return {
    found: !!dims,
    dimsBg: dims ? getComputedStyle(dims).backgroundColor : null,
    dimsImg: dims ? getComputedStyle(dims).backgroundImage : null,
    listBg: list ? getComputedStyle(list).backgroundColor : null,
    dialogBg: dialog ? getComputedStyle(dialog).backgroundColor : null,
    ok: clean(dims) && clean(list),
  };
});

/* ③ 通知页：报告弹窗 */
await probe("zhiyu-notify.html", "通知页 · 报告容器透明", async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const item = document.querySelector("#n-list > *");
  if (item) { item.click(); await wait(500); }
  const modal = document.querySelector(".modal.open");
  const dims = modal ? modal.querySelector(".rep-dims") : null;
  const list = modal ? modal.querySelector(".dim-list") : null;
  const clean = (el) => el && getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(el).backgroundImage === "none";
  return {
    modal: modal ? modal.id : null,
    found: !!dims,
    dimsBg: dims ? getComputedStyle(dims).backgroundColor : null,
    dimsImg: dims ? getComputedStyle(dims).backgroundImage : null,
    listBg: list ? getComputedStyle(list).backgroundColor : null,
    ok: clean(dims) && clean(list),
  };
});

/* ④ 全站扫描：还有没有任何元素残留 stripes.png */
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const leftovers = [];
for (const f of ["zhiyu-find.html", "zhiyu-agent-match.html", "zhiyu-notify.html", "zhiyu-home.html", "zhiyu-persona.html", "zhiyu-settings.html", "zhiyu-login.html"]) {
  await page.goto(BASE + f, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const hit = await page.evaluate(() =>
    [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("stripes.png")).length,
  );
  if (hit) leftovers.push(`${f}: ${hit} 个元素`);
}
await page.close();

await browser.close();

console.log("背景改动验证（期望纯色 #FDF6E8 = rgb(253, 246, 232)）");
console.log("=".repeat(72));
let pass = 0;
let fail = 0;
for (const r of out) {
  if (r.ok) pass += 1; else fail += 1;
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.label}`);
  console.log(`      bgColor=${r.bgColor ?? r.dimsBg}  bgImage=${r.bgImage ?? r.dimsImg}`);
  if (r.listBg) console.log(`      .dim-list bgColor=${r.listBg}  bgImage=${r.listImg}`);
  if (r.errs.length) { console.log(`      JS 报错: ${r.errs.slice(0, 2).join(" | ")}`); fail += 1; }
}
console.log("=".repeat(72));
console.log(leftovers.length ? `残留 stripes.png：${leftovers.join("；")}` : "全站已无 stripes.png 引用");
console.log(`合计 ${out.length} 处：通过 ${pass}，失败 ${fail}`);
process.exit(fail || leftovers.length ? 1 : 0);
