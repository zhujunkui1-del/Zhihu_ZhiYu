/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
﻿#!/usr/bin/env node
// Verify every generated page in a real browser: correct view visible, nav
// links intact, no console errors, no failed resource loads, plus screenshots.
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = "http://127.0.0.1:4173/zhiyu-site/";
const OUT = path.join(RECON_DIR, "verify");
fs.mkdirSync(OUT, { recursive: true });

const pages = [
  { file: "index.html", view: null },
  { file: "home.html", view: "home" },
  { file: "discover.html", view: "discover" },
  { file: "persona.html", view: "persona" },
  { file: "agent.html", view: "agent" },
  { file: "notifications.html", view: "notifications" },
  { file: "settings.html", view: "settings" },
];

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const results = [];

for (const entry of pages) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => failedRequests.push(`FAILED ${request.url()}`));

  await page.goto(BASE + entry.file, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => {
    const visible = Array.from(document.querySelectorAll("[data-view-page]"))
      .filter((section) => !section.hidden)
      .map((section) => section.dataset.viewPage);
    // Only the outermost .nav-item counts: the wrapper anchor carries the class
    // too, so a plain .nav-item query would double-count each entry.
    const navItems = Array.from(document.querySelectorAll(".nav-list .nav-item")).filter(
      (item) => !item.parentElement.closest(".nav-item"),
    );
    const navLinks = navItems.map((item) => {
      const anchor = item.closest("a");
      return {
        tag: item.tagName,
        text: (item.textContent || "").trim(),
        href: anchor ? anchor.getAttribute("href") : null,
        hasView: item.hasAttribute("data-view"),
        active: item.classList.contains("is-active"),
      };
    });
    const style = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const computed = getComputedStyle(node);
      return { background: computed.backgroundColor, color: computed.color, display: computed.display };
    };
    const images = Array.from(document.images);
    // Landmarks guarded against tag-selector regressions (e.g. `.journey-nav
    // button` styles vanishing if a button were swapped for an anchor). Values
    // are the original site's computed metrics at 1440x900.
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const journey = box(".journey-nav");
    const journeyButton = box(".journey-nav button");
    const softPrimary = box("#homeDiscoverButton, #savePersona, #markAllRead, #saveSettings");
    const navItem = box(".nav-item");
    return {
      title: document.title,
      visibleViews: visible,
      navLinks,
      searchLabel: (document.querySelector(".search-box label") || {}).textContent || null,
      imagesTotal: images.length,
      imagesBroken: images.filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src")),
      bodyStyle: style("body"),
      shellStyle: style(".app-shell"),
      indexCards: document.querySelectorAll(".index-card").length,
      boxes: { journey, journeyButton, softPrimary, navItem },
    };
  });

  await page.screenshot({ path: path.join(OUT, entry.file.replace(".html", ".png")), fullPage: false });
  results.push({ ...entry, ...state, consoleErrors, failedRequests });
  await page.close();
}

// Cross-file navigation: click through the sidebar from persona.html.
const navPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await navPage.goto(BASE + "persona.html", { waitUntil: "load", timeout: 45000 });
await navPage.waitForTimeout(600);
const navigation = [];
for (const label of ["发现", "Agent 匹配", "通知", "设置", "首页"]) {
  await navPage.evaluate((text) => {
    const link = Array.from(document.querySelectorAll(".nav-item")).find((item) => (item.textContent || "").includes(text));
    if (!link) throw new Error("nav link not found: " + text);
    link.click();
  }, label);
  await navPage.waitForTimeout(700);
  navigation.push({
    clicked: label,
    url: navPage.url(),
    visible: await navPage.evaluate(() => Array.from(document.querySelectorAll("[data-view-page]")).filter((s) => !s.hidden).map((s) => s.dataset.viewPage)),
    activeNav: await navPage.evaluate(() => (document.querySelector(".nav-item.is-active") || {}).textContent?.trim() || null),
  });
}
await navPage.close();
await browser.close();

fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify({ results, navigation }, null, 2), "utf8");

let bad = 0;
for (const r of results) {
  const expected = r.view ? [r.view] : null;
  const viewOk = expected ? JSON.stringify(r.visibleViews) === JSON.stringify(expected) : r.visibleViews.length === 0;
  const problems = [];
  if (!viewOk) problems.push(`visible views ${JSON.stringify(r.visibleViews)} != ${JSON.stringify(expected)}`);
  if (r.imagesBroken.length) problems.push(`broken images: ${JSON.stringify(r.imagesBroken)}`);
  if (r.consoleErrors.length) problems.push(`console errors: ${JSON.stringify(r.consoleErrors)}`);
  if (r.failedRequests.length) problems.push(`failed requests: ${JSON.stringify(r.failedRequests)}`);
  if (r.view && r.navLinks.some((l) => !l.href || !l.hasView)) problems.push("nav items missing href/data-view");
  if (r.view && r.navLinks.filter((l) => l.active).length !== 1) problems.push("active nav item count != 1");
  // Landmarks measured on the original site at 1440x900 (probe-home.mjs).
  const landmarks = {
    home: { journey: { w: 1180, h: 80 }, journeyButton: { w: 287, h: 80 }, softPrimary: { w: 154, h: 48 } },
  }[r.view] || {};
  for (const [key, want] of Object.entries(landmarks)) {
    const got = r.boxes[key];
    if (!got) {
      problems.push(`landmark ${key} missing`);
      continue;
    }
    if (Math.abs(got.w - want.w) > 2 || Math.abs(got.h - want.h) > 2) {
      problems.push(`landmark ${key} is ${got.w}x${got.h}, expected ${want.w}x${want.h}`);
    }
  }
  if (problems.length) bad += 1;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${r.file.padEnd(20)} view=${JSON.stringify(r.visibleViews)} imgs=${r.imagesTotal} broken=${r.imagesBroken.length} errors=${r.consoleErrors.length} failedReq=${r.failedRequests.length}`);
  for (const p of problems) console.log("      - " + p);
}
console.log("---- cross-file navigation ----");
for (const step of navigation) {
  const ok = step.visible.length === 1;
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} click ${step.clicked.padEnd(12)} -> ${step.url.replace(BASE, "")} visible=${JSON.stringify(step.visible)} activeNav=${step.activeNav}`);
}
console.log(bad === 0 ? "\nALL CHECKS PASSED" : `\n${bad} CHECK(S) FAILED`);
