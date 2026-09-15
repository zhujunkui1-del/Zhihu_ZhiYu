#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * 相遇雷达组件验证
 * 重点：
 *  · 布局零重叠（用真实 getBoundingClientRect 测，不是数坐标）
 *  · 半径单调递增（排名越前越靠近中心）
 *  · 头像确定性映射（同 seed 同图）
 *  · 拖拽后仍能点头像（原型阶段踩过的 setPointerCapture 坑）
 *  · 缩放控件、全览 / 聚焦我 取景
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = path.join(RECON_DIR, "web-radar");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });

const errs = [];
const bad = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("相遇雷达组件验证");
console.log("=".repeat(80));

/* 先在同源页面建立会话，否则带守卫的页面会把人踢走 */
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(500);
const session = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "雷达验证用户" }),
  });
  const d = await r.json();
  if (d?.ok) {
    localStorage.setItem("ziyu_demo_tmp", "1");
    localStorage.removeItem("ziyu_demo_tmp");
    localStorage.setItem(
      "zhiyu_demo",
      JSON.stringify({ userId: d.userId, personaId: d.personaId }),
    );
  }
  return d;
});
if (!session?.ok) console.log("警告：未能建立会话");

await page.goto(`${BASE}/radar-probe`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2200);

const landed = await page.evaluate(() => location.pathname);
if (landed !== "/radar-probe") {
  console.log(`警告：被重定向到 ${landed}`);
}

/* 1 渲染出 16 个节点 */
const nodeCount = await page.evaluate(
  () => document.querySelectorAll('[data-action="profile"]').length,
);
rec("渲染出 16 个人物节点", nodeCount === 16, `实际 ${nodeCount}`);

/* 2 布局零重叠：真实盒子两两求交 */
const overlap = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[class*="node"]')].filter((n) =>
    n.querySelector('[data-action="profile"]'),
  );
  const boxes = nodes.map((n) => {
    const a = n.querySelector('[data-action="profile"]').getBoundingClientRect();
    const c = n.querySelector('[class*="card"]')?.getBoundingClientRect();
    return {
      left: Math.min(a.left, c ? c.left : a.left),
      right: Math.max(a.right, c ? c.right : a.right),
      top: Math.min(a.top, c ? c.top : a.top),
      bottom: Math.max(a.bottom, c ? c.bottom : a.bottom),
    };
  });
  let pairs = 0;
  const detail = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 0 && oy > 0) {
        pairs += 1;
        if (detail.length < 3) detail.push(`#${i}x#${j} 重叠 ${Math.round(ox)}x${Math.round(oy)}px`);
      }
    }
  }
  return { pairs, boxes: boxes.length, detail };
});
rec("16 人布局零重叠", overlap.pairs === 0,
  `${overlap.boxes} 个盒子，重叠 ${overlap.pairs} 组${overlap.detail.length ? " —— " + overlap.detail.join("; ") : ""}`);

/* 2b 中心「我」不能被任何人压住。
   这是实际发现的缺陷：内圈起始半径 170 时，排名第一的人会压在中心身上。 */
const centreClash = await page.evaluate(() => {
  const me = document.querySelector('[class*="meAvatar"]').getBoundingClientRect();
  const meLabel = document.querySelector('[class*="meLabel"]')?.getBoundingClientRect();
  /* 中心的实际占位 = 头像 + 下方「我」标签 */
  const c = {
    left: me.left,
    right: me.right,
    top: me.top,
    bottom: Math.max(me.bottom, meLabel ? meLabel.bottom : me.bottom),
  };
  const hits = [];
  [...document.querySelectorAll('[class*="node"]')].forEach((n) => {
    const btn = n.querySelector('[data-action="profile"]');
    if (!btn) return;
    const a = btn.getBoundingClientRect();
    const card = n.querySelector('[class*="card"]')?.getBoundingClientRect();
    const b = {
      left: Math.min(a.left, card ? card.left : a.left),
      right: Math.max(a.right, card ? card.right : a.right),
      top: Math.min(a.top, card ? card.top : a.top),
      bottom: Math.max(a.bottom, card ? card.bottom : a.bottom),
    };
    const ox = Math.min(c.right, b.right) - Math.max(c.left, b.left);
    const oy = Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top);
    if (ox > 0 && oy > 0) hits.push(`${n.getAttribute("data-id")} 压住中心 ${Math.round(ox)}x${Math.round(oy)}px`);
  });
  return { hits };
});
rec("中心「我」不被任何人压住", centreClash.hits.length === 0,
  centreClash.hits.length ? centreClash.hits.join("; ") : "中心区域干净");

/* 3 半径单调：相似度越高离中心越近 */
const radius = await page.evaluate(() => {
  const me = document.querySelector('[class*="me"]').getBoundingClientRect();
  const cx = me.left + me.width / 2;
  const cy = me.top + me.height / 2;
  const items = [...document.querySelectorAll('[class*="node"]')]
    .filter((n) => n.querySelector('[data-action="profile"]'))
    .map((n) => {
      const a = n.querySelector('[data-action="profile"]').getBoundingClientRect();
      const sim = Number(n.querySelector('[class*="sim"]').textContent.replace("%", ""));
      const d = Math.hypot(a.left + a.width / 2 - cx, a.top + a.height / 2 - cy);
      return { sim, d };
    });
  const sorted = [...items].sort((a, b) => b.sim - a.sim);
  const violations = [];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].d < sorted[i - 1].d - 1) {
      violations.push(
        `${sorted[i - 1].sim}%@${Math.round(sorted[i - 1].d)} -> ${sorted[i].sim}%@${Math.round(sorted[i].d)}`,
      );
    }
  }
  return { count: items.length, violations, first: sorted[0], last: sorted[sorted.length - 1] };
});
rec("半径随相似度单调（越同频越靠近中心）", radius.violations.length === 0,
  `最高 ${radius.first?.sim}% 距中心 ${Math.round(radius.first?.d ?? 0)}px；最低 ${radius.last?.sim}% 距中心 ${Math.round(radius.last?.d ?? 0)}px${radius.violations.length ? "；违例: " + radius.violations.join(", ") : ""}`);

/* 4 头像确定性 */
const deterministic = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[class*="node"]')].filter((n) =>
    n.querySelector('[data-action="profile"]'),
  );
  const map = {};
  for (const n of nodes) {
    const id = n.getAttribute("data-id");
    const src = n.querySelector("img")?.getAttribute("src");
    if (id && !map[id]) map[id] = src;
  }
  const imgs = Object.values(map);
  return { total: imgs.length, distinct: new Set(imgs).size };
});
rec("头像按 id 确定性映射",
  deterministic.total === 16 && deterministic.distinct >= 5 && deterministic.distinct <= 7,
  `16 人用了 ${deterministic.distinct} 张不同插画（池共 7 张）`);

/* 5 头像加载 */
const imgsOk = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('[data-action="profile"] img')];
  return { total: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
});
rec("头像图片全部加载成功", imgsOk.total > 0 && imgsOk.loaded === imgsOk.total,
  `${imgsOk.loaded}/${imgsOk.total}`);

/* 6 真实鼠标点头像 */
await page.evaluate(() => {
  document.querySelector('[data-action="profile"]').scrollIntoView({ block: "center", behavior: "instant" });
});
await page.waitForTimeout(500);
const hit = await page.evaluate(() => {
  const btn = document.querySelector('[data-action="profile"]');
  const r = btn.getBoundingClientRect();
  return { id: btn.getAttribute("data-id"), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.move(hit.x, hit.y);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(600);
const readOpened = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll('[class*="badge"]')].find((x) =>
      x.textContent.includes("已点开"),
    );
    return b ? b.textContent.trim() : "";
  });
const afterClick = await readOpened();
rec("真实鼠标点头像 -> 回调带正确 id", afterClick.includes(hit.id),
  `点了 ${hit.id}，回调显示「${afterClick}」`);

/* 7 拖拽后仍能点头像 */
await page.evaluate(() => {
  const vp = document.querySelector('[class*="viewport"]');
  const r = vp.getBoundingClientRect();
  window.__vp = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
const vpBox = await page.evaluate(() => window.__vp);
await page.mouse.move(vpBox.x, vpBox.y);
await page.mouse.down();
for (let i = 1; i <= 8; i += 1) {
  await page.mouse.move(vpBox.x + i * 10, vpBox.y + i * 3);
  await page.waitForTimeout(14);
}
await page.mouse.up();
await page.waitForTimeout(400);

const afterDragHit = await page.evaluate(() => {
  const btn = document.querySelector('[data-action="profile"]');
  const r = btn.getBoundingClientRect();
  return { id: btn.getAttribute("data-id"), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.mouse.move(afterDragHit.x, afterDragHit.y);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(600);
const dragClickResult = await readOpened();
rec("拖拽一次后点头像 -> 仍能打开（回归 setPointerCapture 坑）",
  dragClickResult.includes(afterDragHit.id),
  `点了 ${afterDragHit.id}，回调显示「${dragClickResult}」`);

/* 8 缩放控件 */
const zoomBefore = await page.evaluate(
  () => getComputedStyle(document.querySelector('[class*="canvas"]')).transform,
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "放大").click();
});
await page.waitForTimeout(400);
const zoomAfter = await page.evaluate(
  () => getComputedStyle(document.querySelector('[class*="canvas"]')).transform,
);
rec("「+」放大改变画布 transform", zoomBefore !== zoomAfter, `${zoomBefore} -> ${zoomAfter}`);

/* 9 全览 / 聚焦我 / 默认 三种取景互不相同 */
const tf = () =>
  page.evaluate(() => getComputedStyle(document.querySelector('[class*="canvas"]')).transform);
const kOf = async () => {
  const m = await tf();
  const n = m.match(/matrix\(([\d.]+)/);
  return n ? Number(n[1]) : 0;
};
const defaultT = await tf();
const defaultK = await kOf();

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "全览").click();
});
await page.waitForTimeout(500);
const fitT = await tf();
const fitK = await kOf();

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "聚焦到我").click();
});
await page.waitForTimeout(500);
const meT = await tf();
const meK = await kOf();

rec("三种取景互不相同（默认 / 全览 / 聚焦我）",
  defaultT !== fitT && fitT !== meT && defaultT !== meT,
  `默认 k=${defaultK.toFixed(2)} / 全览 k=${fitK.toFixed(2)} / 聚焦我 k=${meK.toFixed(2)}`);

rec("默认取景头像读得清（k 不低于 0.5，头像 >= 40px）",
  defaultK >= 0.5,
  `默认 k=${defaultK.toFixed(2)}，头像 84px × k ≈ ${Math.round(84 * defaultK)}px`);

/* 9b 聚焦我时中心「我」必须在视口内（曾经因坐标基准错误被推出视口） */
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "聚焦到我").click();
});
await page.waitForTimeout(600);
const meInside = await page.evaluate(() => {
  const vp = document.querySelector('[class*="viewport"]').getBoundingClientRect();
  const me = document.querySelector('[class*="meAvatar"]').getBoundingClientRect();
  const cx = me.left + me.width / 2;
  const cy = me.top + me.height / 2;
  return {
    inside: cx > vp.left && cx < vp.right && cy > vp.top && cy < vp.bottom,
    meCentre: `${Math.round(cx)},${Math.round(cy)}`,
    vp: `${Math.round(vp.left)},${Math.round(vp.top)} ${Math.round(vp.width)}x${Math.round(vp.height)}`,
    meSize: Math.round(me.width),
  };
});
rec("「聚焦我」时中心「我」落在视口内", meInside.inside,
  `我 中心 ${meInside.meCentre}（${meInside.meSize}px）；视口 ${meInside.vp}`);

/* 10 少人数不炸 */
for (const n of [1, 2, 5]) {
  await page.evaluate((k) => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === `${k} 人`).click();
  }, n);
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    nodes: document.querySelectorAll('[data-action="profile"]').length,
    empty: !!document.querySelector('[class*="empty"]'),
  }));
  rec(`${n} 人时正常渲染`, r.nodes === n && !r.empty, `节点 ${r.nodes}`);
}

/* 回 16 人截图 */
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "16 人").click();
});
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUT, "radar-16.png") });

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
