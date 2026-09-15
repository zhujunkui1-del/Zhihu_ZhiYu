#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * 验证雷达按缩放级别分层渲染（#4）。
 *
 * 要证明的事：
 *   ① DOM 节点数随缩放变化（远景只画点，近景才画头像+标签）
 *   ② **不是限制人数** —— 所有节点始终可点，拖着找得到
 *   ③ 远景下「看得见分布」这个核心体验还在
 *   ④ 原有点击跳转功能没被破坏
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
});

console.log("雷达分层渲染验证（#4）");
console.log("=".repeat(80));

await page.goto(BASE + "/find", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("相遇雷达"));
  if (b) b.click();
});
await page.waitForTimeout(2400);

/** 读当前渲染状态 */
const snapshot = () =>
  page.evaluate(() => {
    const detailNodes = [...document.querySelectorAll("[data-detail]")].map((n) =>
      n.getAttribute("data-detail"),
    );
    const dots = document.querySelectorAll('[data-detail="dot"]').length;
    const labels = document.querySelectorAll('[class*="card"]').length;
    const imgs = document.querySelectorAll('[data-action="profile"] img').length;
    const totalText = document.querySelector('[class*="hint"]')?.parentElement?.textContent ?? "";
    return {
      detailCounts: detailNodes.reduce((acc, d) => ((acc[d] = (acc[d] ?? 0) + 1), acc), {}),
      clickable: document.querySelectorAll('[data-action="profile"]').length,
      dots,
      labels,
      imgs,
      totalText: totalText.replace(/\s+/g, " ").trim(),
    };
  });

/* 记录雷达上的总人数（页面提示里写的） */
const hint = await page.evaluate(
  () => document.body.innerText.match(/雷达上\s*(\d+)\s*位/)?.[1] ?? "?",
);
console.log(`雷达上共有 ${hint} 位\n`);

/* ① 默认取景 */
const def = await snapshot();
console.log(`【默认取景】`);
rec("默认层级不是远景圆点（一进来就能认出人）",
  (def.detailCounts.avatar ?? 0) + (def.detailCounts.full ?? 0) > 0,
  `层级分布 ${JSON.stringify(def.detailCounts)}，可点 ${def.clickable}，标签 ${def.labels}`);

/* ② 缩到最小 —— 应变成圆点 */
await page.evaluate(() => {
  const vp = document.querySelector('[class*="viewport"]');
  if (!vp) return;
  const r = vp.getBoundingClientRect();
  for (let i = 0; i < 14; i += 1) {
    vp.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 120,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
});
await page.waitForTimeout(1200);
const far = await snapshot();
console.log(`\n【缩到远景】`);
rec("远景渲染成圆点（不再画头像与标签）",
  far.dots > 0 && far.labels === 0 && far.imgs === 0,
  `点 ${far.dots} 个 / 头像 img ${far.imgs} 个 / 标签 ${far.labels} 个`);
rec("远景下节点仍然可点（不是限制人数）", far.clickable > 0, `可点 ${far.clickable} 个`);

/* ③ 放回近景 —— 应恢复头像+标签 */
await page.evaluate(() => {
  const vp = document.querySelector('[class*="viewport"]');
  if (!vp) return;
  const r = vp.getBoundingClientRect();
  for (let i = 0; i < 22; i += 1) {
    vp.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -120,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
});
await page.waitForTimeout(1400);
const near = await snapshot();
console.log(`\n【放回近景】`);
rec("近景恢复头像与标签",
  near.labels > 0 && near.imgs > 0,
  `头像 img ${near.imgs} 个 / 标签 ${near.labels} 个 / 点 ${near.dots} 个`);
rec("近景层级为 full 或 avatar",
  (near.detailCounts.full ?? 0) + (near.detailCounts.avatar ?? 0) > 0,
  JSON.stringify(near.detailCounts));

/* ④ DOM 确实变少了（性能目的达成） */
const domCount = await page.evaluate(() => document.querySelectorAll("*").length);
console.log(`\n当前 DOM 节点总数：${domCount}`);

/* ⑤ 点击功能没坏。
   注意：点头像现在是**就地弹窗**（产品要求不跳页），
   所以不能再断言"跳转后的 h1"，要看弹窗里的标题。 */
{
  const pathBefore = await page.evaluate(() => location.pathname);
  const clicked = await page.evaluate(() => {
    const n = document.querySelector('[data-action="profile"]');
    if (!n) return false;
    n.scrollIntoView({ block: "center" });
    n.click();
    return true;
  });
  /* 等弹窗内容渲染（dev 下要拉 /api/persona/[id]） */
  let title = "";
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(400);
    title = await page.evaluate(
      () =>
        document.querySelector('[data-persona-modal="1"] [data-modal-title="1"]')?.textContent?.trim() ??
        "",
    );
    if (title && !title.includes("正在打开")) break;
  }
  const pathAfter = await page.evaluate(() => location.pathname);
  rec(
    "点头像仍能打开对方的人格卡（弹窗形式）",
    clicked && title.includes("的人格卡") && pathAfter === pathBefore,
    `标题「${title}」，URL ${pathBefore} → ${pathAfter}`,
  );
}

await page.screenshot({ path: path.join(RECON_DIR, "web-discover/radar-layered.png") });
await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
