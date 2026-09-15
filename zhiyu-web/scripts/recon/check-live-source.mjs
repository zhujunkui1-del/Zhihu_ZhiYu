#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// Is the captured styles.css still what the live site serves? If the site was
// updated after capture, screenshots would legitimately differ.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto("https://zhiyu-social-visual.jarnigangraeff.chatgpt.site/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);

for (const file of ["styles.css", "app.js", "views.js", "index.html"]) {
  const live = await page.evaluate(async (name) => {
    const response = await fetch("/" + name, { cache: "no-store" });
    const text = await response.text();
    return { status: response.status, text };
  }, file);
  const local = fs.readFileSync(path.join(RECON_DIR, "raw/site", file), "utf8");
  const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
  const sameLength = live.text.length === local.length;
  console.log(
    `${file.padEnd(12)} live=${hash(live.text)} len=${live.text.length}  local=${hash(local)} len=${local.length}  ${sameLength ? (live.text === local ? "IDENTICAL" : "SAME LENGTH, DIFFERENT") : "DIFFERENT"}`,
  );
}
await browser.close();
