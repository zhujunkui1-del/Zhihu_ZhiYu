#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// Exercise the in-view interactions that the original app.js/views.js drive,
// to prove they still work inside the split (multi-file) pages.
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = "http://127.0.0.1:4173/zhiyu-site/";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const results = [];

async function withPage(file, fn) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE + file, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(700);
  const out = await fn(page);
  results.push({ file, ...out, errors });
  await page.close();
}

const check = (label, actual, expected) => ({ label, actual, expected, ok: String(actual) === String(expected) });

// discover: selecting a star-map node swaps the match panel.
await withPage("discover.html", async (page) => {
  await page.evaluate(() => document.querySelector('[data-profile="su"]').click());
  await page.waitForTimeout(400);
  const name = await page.evaluate(() => document.querySelector("#detailName").textContent);
  const score = await page.evaluate(() => document.querySelector("#scoreValue").textContent);
  const selected = await page.evaluate(() => document.querySelector(".profile-node.is-selected").dataset.profile);
  await page.evaluate(() => document.querySelectorAll(".mode-tab")[3].click());
  const activeTab = await page.evaluate(() => document.querySelector(".mode-tab.is-active").textContent.trim());
  await page.evaluate(() => document.querySelector(".filter-chip").click());
  const chipOff = await page.evaluate(() => !document.querySelector(".filter-chip").classList.contains("is-on"));
  return {
    checks: [
      check("profile name", name, "苏晴"),
      check("profile score", score, "89"),
      check("selected node", selected, "su"),
      check("mode tab", activeTab, "共同兴趣"),
      check("filter toggled off", chipOff, true),
    ],
  };
});

// persona: add and remove an interest.
await withPage("persona.html", async (page) => {
  const before = await page.evaluate(() => document.querySelectorAll("#personaInterestList button").length);
  await page.evaluate(() => {
    document.querySelector("#interestInput").value = "手作";
    document.querySelector("#addInterest").click();
  });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    count: document.querySelectorAll("#personaInterestList button").length,
    labels: Array.from(document.querySelectorAll("#personaInterestList button")).map((b) => b.textContent),
  }));
  await page.evaluate(() => document.querySelectorAll("#personaInterestList button")[0].click());
  await page.waitForTimeout(300);
  const removed = await page.evaluate(() => document.querySelectorAll("#personaInterestList button").length);
  return {
    checks: [
      check("interest added", after.count, before + 1),
      check("new interest present", after.labels.includes("手作 ×"), true),
      check("interest removed", removed, before),
    ],
  };
});

// notifications: filter + mark all read.
await withPage("notifications.html", async (page) => {
  await page.evaluate(() => document.querySelector('[data-notification-filter="agent"]').click());
  await page.waitForTimeout(300);
  const visibleAfterFilter = await page.evaluate(() => Array.from(document.querySelectorAll(".notification-item")).filter((i) => !i.hidden).length);
  await page.evaluate(() => document.querySelector('[data-notification-filter="all"]').click());
  await page.evaluate(() => document.querySelector("#markAllRead").click());
  await page.waitForTimeout(300);
  const unread = await page.evaluate(() => document.querySelectorAll(".notification-item.is-unread").length);
  const summary = await page.evaluate(() => document.querySelector("#unreadSummary").textContent);
  return {
    checks: [
      check("agent filter count", visibleAfterFilter, 2),
      check("unread after mark all read", unread, 0),
      check("summary mentions none unread", summary.includes("暂时没有未读消息"), true),
    ],
  };
});

// agent: run a match round and rewrite the opening.
await withPage("agent.html", async (page) => {
  const openingBefore = await page.evaluate(() => document.querySelector(".chat-bubble.kai p").textContent);
  await page.evaluate(() => document.querySelector("#rewriteOpening").click());
  await page.waitForTimeout(250);
  const openingAfter = await page.evaluate(() => document.querySelector(".chat-bubble.kai p").textContent);
  await page.evaluate(() => document.querySelector("#runAgentMatch").click());
  await page.waitForTimeout(1600);
  const percent = await page.evaluate(() => document.querySelector("#agentRoundPercent").textContent);
  const title = await page.evaluate(() => document.querySelector("#agentRoundTitle").textContent);
  return {
    checks: [
      check("opening changed", openingBefore !== openingAfter, true),
      check("round percent", percent, "100%"),
      check("round title", title, "新一轮匹配已经开始"),
    ],
  };
});

// settings: toggle a switch and move the radius slider.
await withPage("settings.html", async (page) => {
  const before = await page.evaluate(() => document.querySelector('[data-setting="agentLearning"]').getAttribute("aria-checked"));
  await page.evaluate(() => document.querySelector('[data-setting="agentLearning"]').click());
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.querySelector('[data-setting="agentLearning"]').getAttribute("aria-checked"));
  await page.evaluate(() => {
    const input = document.querySelector("#matchRadius");
    input.value = "120";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const output = await page.evaluate(() => document.querySelector("#radiusOutput").textContent);
  return {
    checks: [
      check("switch toggled", `${before}->${after}`, "false->true"),
      check("radius output", output, "120 km"),
    ],
  };
});

// notifications: clicking an Agent entry should jump to the agent page.
await withPage("notifications.html", async (page) => {
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll(".notification-item")).find((entry) => entry.textContent.includes("人格画像"));
    item.click();
  });
  await page.waitForTimeout(900);
  return {
    checks: [check("notification -> persona", page.url().replace(BASE, ""), "persona.html")],
  };
});

// home: hero CTA and the journey-nav step cards lead to the right pages.
await withPage("home.html", async (page) => {
  await page.evaluate(() => document.querySelector("#homeDiscoverButton").closest("a").click());
  await page.waitForTimeout(900);
  const afterCta = page.url().replace(BASE, "");
  await page.goto(BASE + "home.html", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.querySelector('.journey-nav [data-view-link="agent"]').closest("a").click());
  await page.waitForTimeout(900);
  return {
    checks: [
      check("hero CTA target", afterCta, "discover.html"),
      check("journey nav target", page.url().replace(BASE, ""), "agent.html"),
    ],
  };
});

await browser.close();

let failed = 0;
for (const result of results) {
  console.log("\n" + result.file);
  for (const item of result.checks) {
    if (!item.ok) failed += 1;
    console.log(`  ${item.ok ? "ok  " : "FAIL"} ${item.label.padEnd(28)} got=${JSON.stringify(item.actual)} expected=${JSON.stringify(item.expected)}`);
  }
  if (result.errors.length) {
    failed += 1;
    console.log("  FAIL console/page errors: " + JSON.stringify(result.errors));
  }
}
console.log(failed === 0 ? "\nALL INTERACTION CHECKS PASSED" : `\n${failed} INTERACTION CHECK(S) FAILED`);
fs.writeFileSync(path.join(RECON_DIR, "verify/interactions.json"), JSON.stringify(results, null, 2), "utf8");
