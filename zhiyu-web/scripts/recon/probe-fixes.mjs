#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 定点复检：logo / 登录按钮 / 暖化 / 人格页合并 / Agent 蒸馏溢出
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "fix-probe");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

const sleep = (page, ms) => page.waitForTimeout(ms);

/* ① 人格页：Agent 蒸馏 tab —— 溢出检测 + 只截该面板 */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "zhiyu-persona.html", { waitUntil: "load" });
  await sleep(page, 600);

  await page.evaluate(() => document.getElementById("tab-distill").click());
  await sleep(page, 600);
  const confirm = await page.evaluate(() => ({
    activeTab: [...document.querySelectorAll(".seg button")].find((b) => b.classList.contains("active"))?.textContent.trim(),
    visiblePanels: [...document.querySelectorAll(".tab-panel")].filter((p) => !p.hidden).map((p) => p.id),
  }));
  console.log("=== 人格页 tab 状态 ===", JSON.stringify(confirm));

  // 精确溢出检测：文本元素的可视宽度 vs 父容器内容区宽度
  const spill = await page.evaluate(() => {
    const out = [];
    const panel = document.getElementById("tab-distill");
    panel.querySelectorAll("*").forEach((el) => {
      const txt = (el.textContent || "").trim();
      if (!txt) return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const cs = getComputedStyle(el);
      const pr = parseFloat(cs.paddingRight) || 0;
      const pl = parseFloat(cs.paddingLeft) || 0;
      // 内容是否横向溢出自身盒子
      const overflowX = el.scrollWidth - el.clientWidth;
      // 是否溢出最近的定位祖先（视觉上"挤出去"）
      const par = el.parentElement;
      const pr2 = par.getBoundingClientRect();
      const outLeft = r.left < pr2.left - 1;
      const outRight = r.right > pr2.right + 1;
      if (overflowX > 2 || outLeft || outRight) {
        out.push({
          tag: el.tagName.toLowerCase() + "." + String(el.className).split(/\s+/).slice(0, 3).join("."),
          text: txt.slice(0, 34),
          box: `${Math.round(r.width)}x${Math.round(r.height)}`,
          scrollW: el.scrollWidth, clientW: el.clientWidth,
          letterSpacing: cs.letterSpacing,
          whiteSpace: cs.whiteSpace,
          overflow: cs.overflow,
          parentOverflow: { left: outLeft, right: outRight },
          pad: `${cs.paddingLeft}/${cs.paddingRight}`,
        });
      }
    });
    return out;
  });
  console.log("\n=== Agent 蒸馏面板：横向溢出元素 ===");
  if (!spill.length) console.log("  （未检出横向溢出）");
  spill.forEach((s) =>
    console.log(`  ${s.tag.padEnd(32)} "${s.text}"\n      box=${s.box} scrollW=${s.scrollW} clientW=${s.clientW} letterSpacing=${s.letterSpacing} whiteSpace=${s.whiteSpace} 溢出父容器=${JSON.stringify(s.parentOverflow)}`));

  // 只截蒸馏面板本身（不用 fullPage，避免状态回退/拉伸）
  const box = await page.evaluate(() => {
    const el = document.querySelector("#tab-distill .panel");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  });
  if (box && box.height > 0) {
    await page.screenshot({ path: path.join(OUT, "persona-distill-panel.png"), clip: box });
  } else {
    await page.screenshot({ path: path.join(OUT, "persona-distill-panel.png") });
  }
  await page.close();
}

/* ② 人格页：人格卡 tab（确认合并结果） */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "zhiyu-persona.html", { waitUntil: "load" });
  await sleep(page, 600);
  const info = await page.evaluate(() => {
    const grid = document.querySelector(".card-grid");
    const side = document.querySelector(".card-side");
    const actions = document.getElementById("ov-actions");
    const title = document.getElementById("ov-title");
    return {
      gridMerged: grid ? grid.classList.contains("is-merged") : null,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      sideWidth: side ? Math.round(side.getBoundingClientRect().width) : null,
      ovActionsExists: !!actions,
      ovActionsText: actions ? actions.textContent.trim() : null,
      ovActionsVisible: actions ? actions.getBoundingClientRect().height > 0 : null,
      ovTitleExists: !!title,
      ovTitleHiddenParentGone: !document.querySelector(".card-grid > div:not(.card-side)"),
    };
  });
  console.log("\n=== 人格卡 tab（合并后）===");
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(OUT, "persona-card.png") });
  await page.close();
}

/* ③ 登录页：按钮 + logo */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "zhiyu-login.html", { waitUntil: "load" });
  await sleep(page, 600);
  const r = await page.evaluate(() => {
    const b = document.getElementById("oauth-trigger");
    const cs = getComputedStyle(b);
    const logos = [...document.querySelectorAll(".brand-logo")].map((i) => ({
      src: i.getAttribute("src"),
      loaded: i.complete && i.naturalWidth > 0,
      box: `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}`,
    }));
    const plates = [...document.querySelectorAll(".brand-plate")].map((p) => {
      const i = p.querySelector(".brand-logo");
      return { cls: p.className, imgLoaded: i ? i.complete && i.naturalWidth > 0 : false, box: `${Math.round(p.getBoundingClientRect().width)}x${Math.round(p.getBoundingClientRect().height)}` };
    });
    return { oauthBg: cs.backgroundImage.slice(0, 96), oauthColor: cs.color, logos, plates };
  });
  console.log("\n=== 登录页 oauth 按钮 + logo ===");
  console.log(JSON.stringify(r, null, 2));
  await page.screenshot({ path: path.join(OUT, "login2.png") });
  await page.close();
}

/* ④ 暖化抽查：主按钮 / 选中导航 / 进度条 / 雷达图 / 通知未读 */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "zhiyu-find.html", { waitUntil: "load" });
  await sleep(page, 600);
  const find = await page.evaluate(async () => {
    const rgb = (v) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v || ""); return m ? `${m[1]},${m[2]},${m[3]}` : v; };
    const nav = document.querySelector(".nav-item.active");
    const primary = document.querySelector(".btn-primary");
    const track = document.querySelector(".track i");
    document.querySelector("#search-results .persona-card [data-action='profile']").click();
    await new Promise((r) => setTimeout(r, 420));
    const mval = document.querySelector("#modal-radar .mval");
    const mdot = document.querySelector("#modal-radar .mdot");
    return {
      选中导航底: rgb(getComputedStyle(nav).backgroundImage),
      主按钮底: rgb(getComputedStyle(primary).backgroundImage),
      进度条填充: rgb(getComputedStyle(track).backgroundImage),
      雷达描边: getComputedStyle(mval).stroke,
      雷达顶点: getComputedStyle(mdot).stroke,
    };
  });
  console.log("\n=== 发现页暖化抽查 ===");
  console.log(JSON.stringify(find, null, 2));
  await page.close();

  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await p2.goto(BASE + "zhiyu-notify.html", { waitUntil: "load" });
  await sleep(p2, 600);
  const notify = await p2.evaluate(() => {
    const card = document.querySelector(".n-card.unread, .n-notice.unread");
    const dot = document.querySelector(".unread-dot, .kdot");
    return {
      未读卡左边框: card ? getComputedStyle(card).borderLeftColor : null,
      未读卡左条宽: card ? getComputedStyle(card).borderLeftWidth : null,
      未读点: dot ? getComputedStyle(dot).backgroundColor : null,
    };
  });
  console.log("\n=== 通知页暖化抽查 ===");
  console.log(JSON.stringify(notify, null, 2));
  await p2.close();
}

/* ⑤ 侧栏 logo 截图 */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE + "zhiyu-home.html", { waitUntil: "load" });
  await sleep(page, 500);
  const box = await page.evaluate(() => {
    const el = document.querySelector(".side-brand");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left) - 6, y: Math.round(r.top) - 6, width: Math.round(r.width) + 12, height: Math.round(r.height) + 12 };
  });
  if (box) await page.screenshot({ path: path.join(OUT, "sidebar-brand.png"), clip: box });
  await page.close();
}

await browser.close();
console.log("\n截图 → RECON/fix-probe/");
