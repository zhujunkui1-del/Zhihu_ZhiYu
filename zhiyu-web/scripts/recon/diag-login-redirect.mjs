#!/usr/bin/env node
/** 临时诊断：demo 登录后 / 是否自动跳 /home、/home 会不会被弹回 */
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
const demo = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", { method: "POST" });
  return { status: r.status, body: (await r.text()).slice(0, 120) };
});
console.log("demo login:", JSON.stringify(demo));

const sess = await page.evaluate(async () => {
  const r = await fetch("/api/auth/session", { cache: "no-store" });
  return await r.text();
});
console.log("session probe:", sess);

await page.goto(`${BASE}/home`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
console.log("/home 停留 url:", page.url());
console.log("/home 首段文字:", await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\s+/g, " ")));

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(3500);
console.log("/ 停留 url:", page.url());
console.log("/ 文档 pathname:", await page.evaluate(() => window.location.pathname + window.location.search));
console.log("/ 首段文字:", await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\s+/g, " ")));

await browser.close();
