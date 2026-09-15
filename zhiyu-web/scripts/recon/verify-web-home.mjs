#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/** 首页验证：四块内容 + 交互 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = path.join(RECON_DIR, "web-home");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });

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

console.log("首页验证");
console.log("=".repeat(80));

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "首页验证" }),
  });
  const d = await r.json();
  if (d?.ok) {
    localStorage.setItem("zhiyu_demo", JSON.stringify({ userId: d.userId, personaId: d.personaId }));
  }
});
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2600);

/* ① 四个面板都在 */
const panels = await page.evaluate(() => {
  const eyebrows = [...document.querySelectorAll('[class*="panelEyebrow"]')].map((e) => e.textContent.trim());
  return { eyebrows, panels: document.querySelectorAll("article").length };
});
rec("四个面板齐全", panels.panels === 4, `${panels.panels} 个面板：${panels.eyebrows.join(" / ")}`);

/* ② 人格总览：雷达 + 指标 + 六源 chips */
const board = await page.evaluate(() => {
  const radar = document.querySelector('[class*="poVisual"] svg');
  const metrics = [...document.querySelectorAll('[class*="metricValue"]')].map((e) => e.textContent.trim());
  const chips = [...document.querySelectorAll('[class*="srcChips"] li')].map((c) => c.textContent.trim());
  const polygon = radar?.querySelector("polygon[class*='brValue']");
  const grids = radar?.querySelectorAll("polygon").length ?? 0;
  return {
    hasRadar: !!radar,
    grids,
    hasDataFace: !!polygon,
    metrics,
    chipCount: chips.length,
    chips: chips.slice(0, 6),
  };
});
rec("五维雷达渲染（含四道网格 + 数据面）",
  board.hasRadar && board.grids >= 5 && board.hasDataFace,
  `网格 ${board.grids} 个多边形，数据面=${board.hasDataFace}`);
rec("三项指标渲染", board.metrics.length === 3, board.metrics.join(" / "));
rec("六个数据源 chip 齐全", board.chipCount === 6, board.chips.join(" "));

/* ③ 发现预览：3 张卡 + 相似度 */
const preview = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[class*="dcCard"]')];
  return {
    n: cards.length,
    sims: cards.map((c) => Number((c.querySelector('[class*="simLbl"] b')?.textContent ?? "0").replace("%", ""))),
    tracks: cards.map((c) => {
      const t = c.querySelector(".track");
      return t ? Math.round(t.getBoundingClientRect().height) : -1;
    }),
  };
});
rec("发现预览 3 张卡且带相似度", preview.n === 3 && preview.sims.every((s) => s > 0),
  `${preview.n} 张，相似度 ${preview.sims.join(" / ")}`);
rec("进度条高度正常（不是被 inline 撑爆）", preview.tracks.every((h) => h <= 12),
  `高度 ${preview.tracks.join(" / ")} px`);

/* ④ 换一批 */
const beforeIds = await page.evaluate(() =>
  [...document.querySelectorAll('[class*="dcCard"]')].map((c) => c.getAttribute("href")).join(","),
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("换一批"))?.click();
});
await page.waitForTimeout(700);
const afterIds = await page.evaluate(() =>
  [...document.querySelectorAll('[class*="dcCard"]')].map((c) => c.getAttribute("href")).join(","),
);
rec("「换一批」换出不同的人", beforeIds !== afterIds, `${beforeIds} → ${afterIds}`);

/* ⑤ 通知面板 */
const notify = await page.evaluate(() => ({
  hasPill: !!document.querySelector('[class*="badge"]'),
  pillText: document.querySelector('[class*="badge"]')?.textContent?.trim() ?? "",
  emptyShown: !!document.querySelector('[class*="ntEmpty"]'),
}));
rec("通知面板显示未读状态", notify.hasPill && notify.pillText.length > 0,
  `「${notify.pillText}」空态=${notify.emptyShown}`);

/* ⑥ Agent 匹配面板 */
const agentPanel = await page.evaluate(() => {
  const items = document.querySelectorAll('[class*="amItem"]').length;
  const empty = !!document.querySelector('[class*="amEmpty"]');
  const link = [...document.querySelectorAll("a")].find((a) => a.textContent.includes("去 Agent 匹配页"));
  return { items, empty, hasLink: !!link, href: link?.getAttribute("href") ?? "" };
});
rec("Agent 匹配面板有内容或空态且有入口",
  (agentPanel.items > 0 || agentPanel.empty) && agentPanel.hasLink,
  `${agentPanel.items} 项 / 空态=${agentPanel.empty} / 链接=${agentPanel.href}`);

await page.screenshot({ path: path.join(OUT, "home.png") });

/* ⑦ 跳转：发现卡片 → 人格卡 */
await page.evaluate(() => {
  document.querySelector('[class*="dcCard"]')?.click();
});
await page.waitForTimeout(1800);
const toPersona = await page.evaluate(() => location.pathname);
rec("点发现预览卡片跳人格卡", toPersona.startsWith("/persona"), toPersona);

/* ⑧ 退出登录回登录页 */
await page.goto(`${BASE}/home`, { waitUntil: "load" });
await page.waitForTimeout(2200);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("退出登录"))?.click();
});
await page.waitForTimeout(1500);
rec("「退出登录」回登录页", (await page.evaluate(() => location.pathname)) === "/");

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
