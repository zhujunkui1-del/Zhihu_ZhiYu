#!/usr/bin/env node
/**
 * 验证顶部导航进度条：点击站内链接后是否出现、导航完成后是否收起。
 *
 * 进度条是 fixed 定位，选择器用 [role="progressbar"]。
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("导航进度条验证");
console.log("=".repeat(76));

await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1800);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
});
await page.goto(BASE + "/home", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);

/* ① 进度条元素存在，且默认不可见 */
{
  const info = await page.evaluate(() => {
    const el = document.querySelector('[role="progressbar"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      opacity: cs.opacity,
      position: cs.position,
      pointerEvents: cs.pointerEvents,
      top: r.top,
      height: r.height,
    };
  });
  rec("进度条元素已挂载", info !== null);
  if (info) {
    rec("空闲时不可见（opacity 0）", Number(info.opacity) === 0, `opacity=${info.opacity}`);
    rec("是 fixed 定位（不占布局）", info.position === "fixed", info.position);
    rec("不拦截点击（pointer-events: none）", info.pointerEvents === "none", info.pointerEvents);
    rec("紧贴界面顶部（top = 0）", Math.abs(info.top) < 1, `top=${info.top}`);
    rec("高度够细不挡内容", info.height <= 4, `height=${info.height}px`);
  }
}

/* ② 点击导航后应立刻出现 */
{
  /* 在点击的同一帧内检查，确保是"立刻"而不是导航完成后才出现 */
  const appeared = await page.evaluate(async () => {
    const a = [...document.querySelectorAll("a")].find((n) => n.textContent.trim() === "发现");
    if (!a) return { found: false };
    a.click();
    /* 等一小段，让 React 处理点击事件 */
    await new Promise((r) => setTimeout(r, 250));
    const el = document.querySelector('[role="progressbar"]');
    const cs = getComputedStyle(el);
    const bar = el.querySelector("div");
    return {
      found: true,
      opacity: cs.opacity,
      width: bar?.style?.width ?? "",
      visible: el.getAttribute("aria-hidden") === "false" || Number(cs.opacity) > 0.5,
    };
  });
  rec("点导航后进度条出现", appeared.found && appeared.visible,
    `opacity=${appeared.opacity} width=${appeared.width}`);
  rec("进度条有推进宽度（不是 0%）", appeared.width !== "" && appeared.width !== "0%",
    appeared.width);
}

/* ③ 导航完成后应收起 */
{
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => {
    const el = document.querySelector('[role="progressbar"]');
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, width: el.querySelector("div")?.style?.width ?? "" };
  });
  rec("导航完成后进度条收起（opacity 归 0）", Number(after.opacity) === 0,
    `opacity=${after.opacity} width=${after.width}`);
}

/* ④ 不影响布局：检查侧栏与主内容位置未偏移 */
{
  const layout = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell");
    const main = document.querySelector("main");
    return {
      shellTop: shell ? Math.round(shell.getBoundingClientRect().top) : null,
      mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
      bodyOverflowX: document.body.scrollWidth > window.innerWidth,
    };
  });
  rec("页面未出现横向滚动（进度条不撑宽）", layout.bodyOverflowX === false);
  console.log(`      布局：shell.top=${layout.shellTop} main.top=${layout.mainTop}`);
}

/* ⑤ 外链与锚点不应触发进度条 */
{
  const before = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[role="progressbar"]')).opacity));
  await page.evaluate(() => {
    /* 造一个外链点击，不应触发 */
    const a = document.createElement("a");
    a.href = "https://example.com/";
    a.textContent = "ext";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[role="progressbar"]')).opacity));
  rec("外链/新窗口点击不触发进度条", after <= before + 0.01, `${before} → ${after}`);
}

await browser.close();
console.log("=".repeat(76));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
