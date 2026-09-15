#!/usr/bin/env node
// The pages must work when opened straight from disk (file://), since that is
// how a reader will double-click them.
import path from "node:path";
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const root = path.resolve("zhiyu-site");
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

let failures = 0;
for (const file of ["index.html", "home.html", "discover.html", "persona.html", "agent.html", "notifications.html", "settings.html"]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push("requestfailed " + request.url()));
  await page.goto("file:///" + path.join(root, file).replace(/\\/g, "/"), { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    visible: Array.from(document.querySelectorAll("[data-view-page]")).filter((s) => !s.hidden).map((s) => s.dataset.viewPage),
    brokenImages: Array.from(document.images).filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.getAttribute("src")),
    navHrefs: Array.from(document.querySelectorAll(".nav-list a")).map((a) => a.getAttribute("href")),
  }));
  const problems = [];
  if (errors.length) problems.push("errors: " + JSON.stringify(errors));
  if (state.brokenImages.length) problems.push("broken images: " + JSON.stringify(state.brokenImages.slice(0, 5)));
  if (file !== "index.html" && state.visible.length !== 1) problems.push("visible views: " + JSON.stringify(state.visible));
  if (file !== "index.html" && state.navHrefs.some((href) => !href)) problems.push("nav href missing");
  if (problems.length) failures += 1;
  console.log(`${problems.length ? "FAIL" : "ok  "} ${file.padEnd(20)} view=${JSON.stringify(state.visible)} errors=${errors.length} brokenImgs=${state.brokenImages.length}`);
  for (const problem of problems) console.log("      - " + problem);
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nFILE:// CHECK PASSED" : `\n${failures} FILE:// CHECK(S) FAILED`);
