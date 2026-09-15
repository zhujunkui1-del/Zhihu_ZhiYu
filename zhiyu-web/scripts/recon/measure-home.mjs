#!/usr/bin/env node
// Measure both the live original and the split page, then compare the box
// metrics of the home view's blocks to locate the layout delta.
import path from "node:path";
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const MEASURE = (selectorRoot) => {
  const out = {};
  const root = document.querySelector(selectorRoot);
  out["__root"] = root ? rect(root) : null;
  function rect(node) {
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }
  const selectors = [
    ".view-heading",
    ".home-dashboard",
    ".home-hero",
    ".daily-card",
    ".recommendations-card",
    ".agent-note-card",
    ".hero-stats",
    ".mini-constellation",
    ".sidebar-story",
    ".sidebar",
    ".main-stage",
    ".topbar",
  ];
  for (const selector of selectors) {
    const node = root ? root.querySelector(selector) || document.querySelector(selector) : document.querySelector(selector);
    if (node) {
      const computed = getComputedStyle(node);
      out[selector] = { ...rect(node), display: computed.display, marginBottom: computed.marginBottom, paddingBottom: computed.paddingBottom };
    }
  }
  out["__docHeight"] = document.documentElement.scrollHeight;
  return out;
};

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

async function measure(url, label, rootSelector) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);
  // Force the home view visible in both, then freeze animations for stable boxes.
  await page.evaluate((target) => {
    document.querySelectorAll("[data-view-page]").forEach((section) => {
      const isActive = section.dataset.viewPage === target;
      section.hidden = !isActive;
      section.classList.toggle("is-active", isActive);
    });
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
    document.head.appendChild(style);
    window.scrollTo(0, 0);
  }, "home");
  await page.waitForTimeout(600);
  const data = await page.evaluate(MEASURE, rootSelector);
  await page.close();
  return { label, data };
}

const original = await measure("https://zhiyu-social-visual.jarnigangraeff.chatgpt.site/", "original", "#view-home");
const clone = await measure("http://127.0.0.1:4173/zhiyu-site/home.html", "clone", "#view-home");
await browser.close();

const keys = [...new Set([...Object.keys(original.data), ...Object.keys(clone.data)])];
console.log("selector".padEnd(22) + "original".padEnd(30) + "clone".padEnd(30) + "delta(h)");
for (const key of keys) {
  const a = original.data[key];
  const b = clone.data[key];
  const fmt = (v) => (v ? `${v.w}x${v.h} @${v.x},${v.y}` : "-");
  const delta = a && b && typeof a.h === "number" ? String(b.h - a.h) : "";
  const flag = a && b && typeof a.h === "number" && a.h !== b.h ? "  <== DIFF" : "";
  console.log(key.padEnd(22) + fmt(a).padEnd(30) + fmt(b).padEnd(30) + delta + flag);
}
