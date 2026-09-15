#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * 验证「开始蒸馏」在界面上真的能用（#10）。
 *
 * 之前它是个 disabled 按钮 + "蒸馏服务尚未接入（演示占位）"。
 * 现在点下去应真实调用大模型并展示结果。
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

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

console.log("「开始蒸馏」界面验证（#10）");
console.log("=".repeat(80));

await page.goto(BASE + "/persona", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);

/* 切到蒸馏 tab */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent.includes("蒸馏"));
  if (b) b.click();
});
await page.waitForTimeout(2000);

const before = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("开始蒸馏"));
  const hint = btn?.parentElement?.textContent ?? "";
  return {
    found: !!btn,
    disabled: btn?.disabled ?? null,
    hint: hint.replace(/\s+/g, " ").trim().slice(0, 120),
    hasPlaceholder: (document.body.innerText || "").includes("演示占位"),
  };
});
rec("蒸馏 tab 有「开始蒸馏」按钮", before.found);
rec("按钮**不再**是禁用的演示占位", before.disabled === false, `disabled=${before.disabled}`);
rec("已移除「演示占位」文案", !before.hasPlaceholder, before.hint);
rec("未点击前不显示结果面板",
  !(await page.evaluate(() => !!document.querySelector('[data-distill-result="1"]'))));

/* 点它 */
console.log("\n点击「开始蒸馏」（真实调用大模型，最多等 40 秒）…");
const t0 = Date.now();
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.includes("开始蒸馏"));
  if (btn) btn.click();
});
await page.waitForTimeout(2500);

/* 过程中应显示"蒸馏中" */
const during = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /蒸馏中|开始蒸馏/.test(b.textContent));
  return { text: btn?.textContent?.trim() ?? "" };
});
rec("点击后立即进入「蒸馏中」状态（有反馈）", /蒸馏中/.test(during.text), during.text);

/* 等结果 */
let got = false;
for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(1000);
  got = await page.evaluate(() => !!document.querySelector('[data-distill-result="1"]'));
  if (got) break;
}
const ms = Date.now() - t0;

rec("蒸馏完成并展示结果面板", got, `耗时 ${(ms / 1000).toFixed(1)} s`);

if (got) {
  const r = await page.evaluate(() => {
    const box = document.querySelector('[data-distill-result="1"]');
    const text = (box?.textContent ?? "").replace(/\s+/g, " ");
    return {
      text: text.slice(0, 400),
      head: box?.querySelector("p")?.textContent?.trim() ?? "",
      badges: box?.querySelectorAll(".badge").length ?? 0,
      grounds: box?.querySelectorAll("li").length ?? 0,
      saysLlm: text.includes("大模型归纳完成"),
      saysRules: text.includes("规则归并完成"),
    };
  });
  console.log(`\n结果面板内容：\n  ${r.text}`);
  rec("显示归纳来源（大模型 / 规则）", r.saysLlm || r.saysRules,
    r.saysLlm ? "大模型归纳完成" : "规则归并完成");
  rec("展示了抽出的标签", r.badges > 0, `${r.badges} 个标签`);
  rec("展示了结论溯源", r.grounds > 0, `${r.grounds} 条溯源`);
  rec("本次用的是真 LLM（不是规则兜底）", r.saysLlm);
}

await page.screenshot({ path: path.join(RECON_DIR, "web-persona/distill-result.png") });
await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
