#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 相遇雷达：首屏 + 切换 + 拖拽 + 缩放 + 点头像开人格卡 的可视化验证
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "radar-verify");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await chromium.launch ? await launchChromium(chromium) : null;

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });

await page.goto(BASE + "zhiyu-find.html", { waitUntil: "load" });
await page.waitForTimeout(1200);

console.log("=== 报错 ===");
console.log(errs.length ? errs.slice(0, 8).join("\n") : "（无）");

/* 1. 初始状态 */
const init = await page.evaluate(() => ({
  cards: document.querySelectorAll("#search-results .persona-card").length,
  count: document.getElementById("result-count").textContent,
  viewSegs: document.querySelectorAll("[data-view-seg]").length,
  radarRendered: !!document.querySelector("#radar-search .radar-canvas"),
  hasZhiyuRadar: typeof window.ZhiyuRadar === "object",
  hasOpenProfile: typeof window.openProfile === "function",
}));
console.log("\n=== 初始 ===");
console.log(JSON.stringify(init, null, 2));

await page.screenshot({ path: path.join(OUT, "01-initial-grid.png") });

/* 2. 切到雷达 */
await page.evaluate(() => {
  document.querySelector('[data-view-seg="search"] button[data-view="radar"]').click();
});
await page.waitForTimeout(900);

const radar = await page.evaluate(() => {
  const stage = document.getElementById("radar-search");
  const nodes = [...stage.querySelectorAll(".radar-node")];
  const me = stage.querySelector(".radar-me");
  const vp = stage.querySelector(".radar-viewport");
  const canvas = stage.querySelector(".radar-canvas");
  const rect = vp ? vp.getBoundingClientRect() : null;
  return {
    nodes: nodes.length,
    names: nodes.map((n) => n.querySelector(".radar-name").textContent),
    types: nodes.map((n) => n.querySelector(".radar-type").textContent),
    sims: nodes.map((n) => n.querySelector(".radar-sim").textContent),
    avatarSrcs: [...new Set(nodes.map((n) => n.querySelector(".radar-avatar img").getAttribute("src")))],
    avatarsLoaded: nodes.every((n) => {
      const i = n.querySelector(".radar-avatar img");
      return i && i.complete && i.naturalWidth > 0;
    }),
    meExists: !!me,
    meLabel: me ? me.querySelector(".radar-me-label").textContent : null,
    rings: stage.querySelectorAll(".radar-ring, .radar-ring-inner").length,
    ringTags: [...stage.querySelectorAll(".radar-ring-tag")].map((t) => t.textContent),
    links: stage.querySelectorAll(".radar-link").length,
    decorDots: stage.querySelectorAll(".radar-svg circle[stroke='none']").length,
    tools: !!stage.querySelector(".radar-tools"),
    stats: stage.querySelector(".radar-stats") ? stage.querySelector(".radar-stats").textContent : null,
    viewportSize: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : null,
    canvasTransform: canvas ? getComputedStyle(canvas).transform : null,
    gridHidden: document.querySelector('[data-view-pane="search"]').hidden,
    radarShown: !document.querySelector('[data-view-pane="radar-search"]').hidden,
  };
});
console.log("\n=== 雷达 ===");
console.log(JSON.stringify(radar, null, 2));

await page.screenshot({ path: path.join(OUT, "02-radar.png") });

/* 重叠实测：逐对比较「头像 + 标签卡」的真实包围盒，输出重叠对数 */
const overlap = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll("#radar-search .radar-node")];
  const rects = nodes.map((n) => {
    const a = n.querySelector(".radar-avatar").getBoundingClientRect();
    const c = n.querySelector(".radar-card").getBoundingClientRect();
    return {
      name: n.querySelector(".radar-name").textContent,
      left: Math.min(a.left, c.left),
      right: Math.max(a.right, c.right),
      top: Math.min(a.top, c.top),
      bottom: Math.max(a.bottom, c.bottom),
    };
  });
  const pairs = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 1 && oy > 1) pairs.push({ a: a.name, b: b.name, overlap: `${Math.round(ox)}x${Math.round(oy)}` });
    }
  }
  // 中心「我」与最近的人是否重叠
  const me = document.querySelector("#radar-search .radar-me-avatar").getBoundingClientRect();
  const meHits = rects.filter((r) => {
    const ox = Math.min(r.right, me.right) - Math.max(r.left, me.left);
    const oy = Math.min(r.bottom, me.bottom) - Math.max(r.top, me.top);
    return ox > 1 && oy > 1;
  });
  return { total: rects.length, overlapPairs: pairs, meOverlaps: meHits.map((h) => h.name) };
});
console.log("\n=== 重叠实测 ===");
console.log(`节点 ${overlap.total} 个，重叠对 ${overlap.overlapPairs.length} 组`);
overlap.overlapPairs.forEach((p) => console.log(`  ${p.a} × ${p.b}  ${p.overlap}`));
console.log(`与中心「我」重叠: ${overlap.meOverlaps.length ? overlap.meOverlaps.join(", ") : "无"}`);

// 只截雷达面板
const panelBox = await page.evaluate(() => {
  const el = document.getElementById("radar-search");
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top + window.scrollY)), width: Math.round(r.width), height: Math.round(r.height) };
});
await page.screenshot({ path: path.join(OUT, "03-radar-only.png"), clip: panelBox });

/* 3. 拖拽 */
const before = await page.evaluate(() => getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform);
await page.mouse.move(700, 500);
await page.mouse.down();
for (let i = 1; i <= 12; i += 1) { await page.mouse.move(700 - i * 14, 500 + i * 5); await page.waitForTimeout(12); }
await page.mouse.up();
await page.waitForTimeout(250);
const after = await page.evaluate(() => getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform);
console.log("\n=== 拖拽 ===");
console.log("平移前:", before, "\n平移后:", after, "\n变化:", before !== after ? "是" : "否（失败）");
await page.screenshot({ path: path.join(OUT, "04-dragged.png"), clip: panelBox });

/* 4. 缩放 */
await page.evaluate(() => document.querySelector("#radar-search .radar-tools button[data-zoom='in']").click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector("#radar-search .radar-tools button[data-zoom='in']").click());
await page.waitForTimeout(250);
const zoomed = await page.evaluate(() => getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform);
console.log("\n=== 缩放 ===");
console.log("放大两次后:", zoomed);
await page.screenshot({ path: path.join(OUT, "05-zoomed.png"), clip: panelBox });

/* 5. 聚焦我 */
await page.evaluate(() => document.querySelector("#radar-search .radar-tools button[data-zoom='me']").click());
await page.waitForTimeout(300);
const reset = await page.evaluate(() => getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform);
console.log("聚焦我:", reset);

await page.evaluate(() => document.querySelector("#radar-search .radar-tools button[data-zoom='fit']").click());
await page.waitForTimeout(350);
const fitK = await page.evaluate(() => {
  const t = getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform;
  return { transform: t, k: Number((t.match(/matrix\(([\d.]+)/) || [])[1]) };
});
console.log("全览后:", JSON.stringify(fitK));
await page.screenshot({ path: path.join(OUT, "05b-fit.png"), clip: panelBox });
await page.evaluate(() => document.querySelector("#radar-search .radar-tools button[data-zoom='fit']").click());
await page.waitForTimeout(250);

/* 6. 点头像开人格卡 */
const opened = await page.evaluate(async () => {
  const av = document.querySelector("#radar-search .radar-node .radar-avatar");
  if (!av) return { error: "没有头像按钮" };
  const name = av.closest(".radar-node").querySelector(".radar-name").textContent;
  av.click();
  await new Promise((r) => setTimeout(r, 500));
  const modal = document.getElementById("persona-modal");
  return {
    clickedName: name,
    modalOpen: modal.classList.contains("open"),
    modalTitle: document.getElementById("modal-title").textContent,
    modalAvatarHasImg: !!document.querySelector("#modal-avatar img"),
    modalSim: document.getElementById("modal-sim").textContent,
    modalType: document.getElementById("modal-type").textContent,
    radarSvg: !!document.querySelector("#persona-modal-zzz") || !!document.querySelector("#modal-radar svg"),
  };
});
console.log("\n=== 点头像开人格卡 ===");
console.log(JSON.stringify(opened, null, 2));
await page.screenshot({ path: path.join(OUT, "06-modal.png") });

/* 7. 筛选后雷达同步 */
const filtered = await page.evaluate(async () => {
  document.querySelector("#persona-modal [data-close]").click();
  await new Promise((r) => setTimeout(r, 300));
  const prov = document.getElementById("filter-prov");
  prov.value = "北京";
  prov.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  const nodes = [...document.querySelectorAll("#radar-search .radar-node")];
  return {
    count: document.getElementById("result-count").textContent,
    nodes: nodes.length,
    names: nodes.map((n) => n.querySelector(".radar-name").textContent),
    stillRadar: !document.querySelector('[data-view-pane="radar-search"]').hidden,
  };
});
console.log("\n=== 筛选（北京）后雷达 ===");
console.log(JSON.stringify(filtered, null, 2));

/* 8. 切回卡片 */
const back = await page.evaluate(async () => {
  document.querySelector('[data-view-seg="search"] button[data-view="grid"]').click();
  await new Promise((r) => setTimeout(r, 350));
  return {
    cards: document.querySelectorAll("#search-results .persona-card").length,
    gridShown: !document.querySelector('[data-view-pane="search"]').hidden,
    radarHidden: document.querySelector('[data-view-pane="radar-search"]').hidden,
  };
});
console.log("\n=== 切回卡片 ===");
console.log(JSON.stringify(back, null, 2));

/* 9. 随机推荐 & 快速匹配的雷达 */
const others = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  document.querySelector('[data-tab="random"]').click();
  await wait(200);
  document.querySelector('[data-view-seg="random"] button[data-view="radar"]').click();
  await wait(300);
  document.getElementById("reroll-btn").click();
  await wait(700);
  out.randomNodes = document.querySelectorAll("#radar-random .radar-node").length;

  document.querySelector('[data-tab="quick"]').click();
  await wait(200);
  document.getElementById("quick-run").click();
  await wait(1800);
  document.querySelector('[data-view-seg="quick"] button[data-view="radar"]').click();
  await wait(500);
  out.quickNodes = document.querySelectorAll("#radar-quick .radar-node").length;
  return out;
});
console.log("\n=== 随机 / 快速匹配的雷达 ===");
console.log(JSON.stringify(others, null, 2));
await page.screenshot({ path: path.join(OUT, "07-quick-radar.png"), fullPage: true });

console.log("\n=== 最终报错 ===");
console.log(errs.length ? errs.slice(0, 10).join("\n") : "（无）");

await browser.close();
