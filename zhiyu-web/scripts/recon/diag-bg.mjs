#!/usr/bin/env node
// 量报告弹窗里各层的实际背景色，找出"纯色带 vs 纸纹底"的错位
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = "http://127.0.0.1:4188/";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE + "zhiyu-agent-match.html", { waitUntil: "load" });
await page.waitForTimeout(700);
await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById("tab-reports").click();
  await wait(300);
  const b = document.querySelector("#rep-list button");
  if (b) { b.click(); await wait(600); }
});

const rows = await page.evaluate(() => {
  const sel = [
    ".modal-backdrop", ".modal-dialog",
    ".rep-head", ".rep-top", ".rep-row", ".rep-main", ".rep-quote",
    ".score-badge", ".radar-wrap",
    ".rep-dims", ".dim-list", ".dim-item", ".dim-item .dtop",
    ".dim-item .track", ".dim-item .dr",
    ".trait-list", ".trait-row",
    ".hl-list", ".hl-list li",
    ".modal-actions",
  ];
  return sel.map((s) => {
    const el = document.querySelector(".modal.open " + s) || document.querySelector(s);
    if (!el) return { sel: s, missing: true };
    const cs = getComputedStyle(el);
    return {
      sel: s,
      bg: cs.backgroundColor,
      img: cs.backgroundImage === "none" ? "none" : cs.backgroundImage.slice(0, 60),
      box: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      pad: cs.padding,
      radius: cs.borderRadius,
      border: cs.borderTopWidth + " " + cs.borderTopColor,
    };
  });
});

console.log("选择器".padEnd(26), "背景色".padEnd(30), "底图".padEnd(10), "盒子");
console.log("-".repeat(96));
for (const r of rows) {
  if (r.missing) { console.log(r.sel.padEnd(26), "(不存在)"); continue; }
  console.log(
    r.sel.padEnd(26),
    r.bg.padEnd(30),
    (r.img === "none" ? "无" : "有").padEnd(10),
    r.box.padEnd(12),
    "pad=" + r.pad,
  );
}

await browser.close();
