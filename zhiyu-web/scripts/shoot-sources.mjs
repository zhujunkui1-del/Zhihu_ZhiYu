#!/usr/bin/env node
/**
 * 截一张「注入数据」页 + 同步向导的图，用于人眼确认"没有大段文字"。
 * 用法：node scripts/shoot-sources.mjs
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-import");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1250 } });

await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST" });
});
await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    x.textContent.trim().includes("注入数据"),
  );
  b?.click();
});
await page.waitForTimeout(2000);
await page.evaluate(() => window.scrollTo(0, 320));
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "10-sources-slim.png") });

/* 打开同步向导 */
await page.evaluate(() => {
  document.querySelector('[data-provider-link="feishu"] [data-provider-sync]')?.click();
});
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, "11-sync-wizard.png") });

console.log("截图已保存到", OUT);
await browser.close();
