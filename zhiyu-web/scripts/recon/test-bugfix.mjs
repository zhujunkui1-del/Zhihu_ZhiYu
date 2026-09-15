#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * 两个回归 bug 的专项验证：
 *  BUG-1 相遇雷达点头像没反应（叠加：拖拽一次后更容易复现）
 *  BUG-2 「让我的 Agent 先聊聊」应停留原页 + 弹提示，不该跳到 Agent 匹配页
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "bugfix-verify");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const results = [];
const rec = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });

/* ══════════ BUG-1：雷达点头像 ══════════ */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  let navigated = false;
  page.on("pageerror", (e) => errs.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigated = true; });

  await page.goto(BASE + "zhiyu-find.html", { waitUntil: "load" });
  await page.waitForTimeout(900);

  // 切到雷达
  await page.evaluate(() => document.querySelector('[data-view-seg="search"] button[data-view="radar"]').click());
  await page.waitForTimeout(800);

  const base = await page.evaluate(() => ({
    nodes: document.querySelectorAll("#radar-search .radar-node").length,
    hasOpenProfile: typeof window.openProfile === "function",
  }));
  rec("雷达渲染出节点", base.nodes > 0, `${base.nodes} 个`);
  rec("window.openProfile 可用", base.hasOpenProfile);

  /* 1a. 真实鼠标点头像（不用 JS .click()）
     教训：JS .click() 是合成事件，不经过 pointerdown/up，
     因此**测不出 setPointerCapture 把 click.target 重定向到 viewport 的问题**。
     必须用真实鼠标事件，才等同于用户操作。 */
  await page.evaluate(() => document.getElementById("persona-modal").classList.remove("open"));
  const avBox = await page.evaluate(() => {
    const av = document.querySelector("#radar-search .radar-node .radar-avatar");
    if (!av) return null;
    const r = av.getBoundingClientRect();
    return {
      name: av.closest(".radar-node").querySelector(".radar-name").textContent,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    };
  });
  await page.mouse.move(avBox.x, avBox.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const clickOnce = await page.evaluate(() => ({
    open: document.getElementById("persona-modal").classList.contains("open"),
    title: document.getElementById("modal-title").textContent,
  }));
  rec("真实鼠标点雷达头像 → 打开人格卡", clickOnce.open && clickOnce.title === avBox.name,
    `点了「${avBox.name}」，弹窗标题「${clickOnce.title}」，open=${clickOnce.open}`);

  /* 1a2. 换一个头像点，确认 id 传递正确 */
  await page.evaluate(() => document.getElementById("persona-modal").classList.remove("open"));
  const av2 = await page.evaluate(() => {
    const list = [...document.querySelectorAll("#radar-search .radar-node .radar-avatar")];
    const av = list[3] || list[1];
    if (!av) return null;
    const r = av.getBoundingClientRect();
    return {
      name: av.closest(".radar-node").querySelector(".radar-name").textContent,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    };
  });
  if (av2) {
    await page.mouse.move(av2.x, av2.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(500);
    const second = await page.evaluate(() => ({
      open: document.getElementById("persona-modal").classList.contains("open"),
      title: document.getElementById("modal-title").textContent,
    }));
    rec("真实鼠标点第二个头像 → 打开对应人格卡", second.open && second.title === av2.name,
      `点了「${av2.name}」，弹窗标题「${second.title}」`);
  }

  /* 1b. 先拖拽一次，再点头像（这正是旧实现失效的场景） */
  const panel = await page.evaluate(() => {
    const r = document.getElementById("radar-search").getBoundingClientRect();
    return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
  });
  await page.evaluate(() => document.getElementById("persona-modal").classList.remove("open"));
  await page.mouse.move(panel.cx, panel.cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) { await page.mouse.move(panel.cx - i * 12, panel.cy + i * 4); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.waitForTimeout(250);

  /* 1b. 先拖拽一次，再「真实鼠标」点头像（这正是旧实现失效的场景） */
  const avAfter = await page.evaluate(() => {
    const av = document.querySelector("#radar-search .radar-node .radar-avatar");
    if (!av) return null;
    const r = av.getBoundingClientRect();
    return {
      name: av.closest(".radar-node").querySelector(".radar-name").textContent,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
    };
  });
  await page.mouse.move(avAfter.x, avAfter.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterDrag = await page.evaluate(() => ({
    open: document.getElementById("persona-modal").classList.contains("open"),
    title: document.getElementById("modal-title").textContent,
  }));
  rec("拖拽一次后真实点击头像 → 仍能打开人格卡", afterDrag.open && afterDrag.title === avAfter.name,
    `点了「${avAfter.name}」，弹窗标题「${afterDrag.title}」，open=${afterDrag.open}`);

  /* 1c. 拖拽本身不能被 click 处理器吞掉（平移仍生效） */
  const before = await page.evaluate(() => getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform);
  await page.evaluate(() => document.getElementById("persona-modal").classList.remove("open"));
  await page.mouse.move(panel.cx, panel.cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) { await page.mouse.move(panel.cx + i * 15, panel.cy); await page.waitForTimeout(12); }
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => getComputedStyle(document.querySelector("#radar-search .radar-canvas")).transform);
  rec("在雷达上拖拽仍能平移", before !== after, `${before} → ${after}`);

  /* 1d. 拖拽后不应误开人格卡 */
  const noAccident = await page.evaluate(() => !document.getElementById("persona-modal").classList.contains("open"));
  rec("拖拽结束时不会误开人格卡", noAccident);

  await page.screenshot({ path: path.join(OUT, "01-radar-modal.png") });
  rec("雷达页无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
  await page.close();
}

/* ══════════ BUG-2：让 Agent 先聊聊 ══════════ */
for (const file of ["zhiyu-find.html", "zhiyu-home.html"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errs = [];
  const navigations = [];
  page.on("pageerror", (e) => errs.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

  await page.goto(BASE + file, { waitUntil: "load" });
  await page.waitForTimeout(900);
  const startUrl = page.url();
  navigations.length = 0;

  /* 打开一个人格卡（优先挑接受 Agent 对话的） */
  const opened = await page.evaluate((f) => {
    if (f === "zhiyu-find.html") {
      const btn = document.querySelector('#search-results .persona-card[data-agent="1"] [data-action="profile"]');
      if (btn) { btn.click(); return true; }
      const any = document.querySelector('#search-results .persona-card [data-action="profile"]');
      if (any) { any.click(); return true; }
      return false;
    }
    const go = document.querySelector(".dc-go");
    if (go) { go.click(); return true; }
    return false;
  }, file);
  await page.waitForTimeout(500);
  const modalOpen = await page.evaluate(() => {
    const m = document.querySelector(".modal.open");
    return m ? m.id : null;
  });
  rec(`${file}: 打开人格卡`, opened && modalOpen, `弹窗=${modalOpen}`);

  /* 点「让我的 Agent 先聊聊」 */
  const beforeUrl = page.url();
  const afterChat = await page.evaluate(async () => {
    const btn = document.getElementById("modal-chat");
    if (!btn) return { error: "找不到 #modal-chat" };
    btn.click();
    await new Promise((r) => setTimeout(r, 600));
    const toast = document.getElementById("toast");
    return {
      toastText: toast ? toast.textContent : "(无 toast)",
      toastShown: toast ? toast.classList.contains("show") : false,
      modalStillOpen: document.querySelector(".modal.open") ? document.querySelector(".modal.open").id : null,
      navDot: !!document.querySelector('.nav-item[data-nav="Agent 匹配"] .nav-running-dot'),
      pending: (() => { try { return JSON.parse(localStorage.getItem("zhiyu-pending-meet") || "null"); } catch (e) { return null; } })(),
    };
  });
  await page.waitForTimeout(500);
  const afterUrl = page.url();

  rec(`${file}: 点击后 URL 未变化（不跳页）`, afterUrl === beforeUrl && afterUrl === startUrl,
    `before=${beforeUrl.split("/").pop()}  after=${afterUrl.split("/").pop()}`);
  rec(`${file}: 无任何导航发生`, navigations.length === 0, navigations.join(" | ") || "0 次");
  rec(`${file}: 弹出提示且文案含对方名字`,
    afterChat.toastShown && /你的 Agent 已在后台开始和 .+ 对话，有进展会通知你。/.test(afterChat.toastText || ""),
    `toast=「${afterChat.toastText}」`);
  rec(`${file}: 提示后界面未跳转（弹窗按设计已关闭）`,
    afterChat.modalStillOpen === null, `剩余打开弹窗=${afterChat.modalStillOpen}`);
  rec(`${file}: 侧栏出现后台会话小圆点`, afterChat.navDot === true);
  rec(`${file}: 记录了待处理会话（供 Agent 匹配页识别）`,
    !!(afterChat.pending && afterChat.pending.title), JSON.stringify(afterChat.pending));
  rec(`${file}: 无 JS 报错`, errs.length === 0, errs.slice(0, 3).join(" | "));

  await page.screenshot({ path: path.join(OUT, `02-${file.replace(".html", "")}-toast.png`) });
  await page.close();
}

/* ══════════ 汇总 ══════════ */
await browser.close();
let pass = 0;
let fail = 0;
console.log("BUG 修复专项验证");
console.log("=".repeat(74));
for (const r of results) {
  if (r.ok) pass += 1; else fail += 1;
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}`);
  if (r.detail) console.log(`      ${r.detail}`);
}
console.log("=".repeat(74));
console.log(`合计 ${results.length} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
