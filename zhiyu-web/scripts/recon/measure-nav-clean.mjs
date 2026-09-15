#!/usr/bin/env node
/**
 * 干净的导航缓存测量：**全程不整页刷新**，只用客户端导航。
 *
 * 之前那版每次都 page.goto()，那是整页刷新、会清空客户端路由缓存，
 * 测不出缓存是否生效。
 *
 * 本版：进一次页面建立会话后，全部用点击导航栏在各页间往返，
 * 对比「首次访问」与「第二次访问」同一页的耗时。
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

/* 统计客户端导航请求（Next 会以 ?_rsc= 拉 RSC payload） */
const rscRequests = [];
page.on("request", (r) => {
  if (r.url().includes("_rsc=")) rscRequests.push(r.url());
});

await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1800);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
});

/** 点导航栏并等到目标页标志文本出现 */
async function navTo(label, marker) {
  const before = rscRequests.length;
  const t0 = Date.now();
  const clicked = await page.evaluate((x) => {
    const a = [...document.querySelectorAll("a")].find((n) => n.textContent.trim() === x);
    if (!a) return false;
    a.click();
    return true;
  }, label);
  if (!clicked) return { ms: -1, rsc: 0 };

  for (let i = 0; i < 250; i += 1) {
    const t = await page.evaluate(() => document.body.innerText || "");
    if (t.includes(marker)) {
      return { ms: Date.now() - t0, rsc: rscRequests.length - before };
    }
    await page.waitForTimeout(60);
  }
  return { ms: -1, rsc: rscRequests.length - before };
}

const PAGES = [
  ["发现", "要和谁相遇"],
  ["我的人格", "人格完整度"],
  ["Agent 匹配", "认识中"],
  ["通知", "消息流"],
  ["设置", "身份与数据源"],
];

console.log(`客户端导航缓存测量：${BASE}`);
console.log("=".repeat(80));

/* 先到首页作为起点 */
await page.goto(BASE + "/home", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);

console.log("\n【第一轮】首次访问各页");
const first = {};
for (const [label, marker] of PAGES) {
  await navTo("首页", "人格倾向");
  await page.waitForTimeout(700);
  const r = await navTo(label, marker);
  first[label] = r;
  console.log(`  ${label.padEnd(12)} ${String(r.ms).padStart(5)} ms   RSC 请求 ${r.rsc}`);
}

console.log("\n【第二轮】再次访问同样顺序（应命中客户端缓存）");
const second = {};
for (const [label, marker] of PAGES) {
  await navTo("首页", "人格倾向");
  await page.waitForTimeout(700);
  const r = await navTo(label, marker);
  second[label] = r;
  const f = first[label];
  const delta = f.ms > 0 && r.ms > 0 ? f.ms - r.ms : 0;
  console.log(
    `  ${label.padEnd(12)} ${String(r.ms).padStart(5)} ms   RSC 请求 ${r.rsc}   ` +
      `（首次 ${f.ms} ms，${delta > 40 ? `快了 ${delta} ms ✓` : "无明显变化"}）`,
  );
}

console.log("\n" + "=".repeat(80));
const totalRsc = rscRequests.length;
console.log(`总 RSC 请求数：${totalRsc}`);
console.log("判读：第二轮耗时明显更短、且 RSC 请求为 0 → 客户端缓存生效。");

await browser.close();
