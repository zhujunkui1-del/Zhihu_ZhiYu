#!/usr/bin/env node
/**
 * 端到端验证 #3 / #9 **以及弹窗要求**。
 *
 * 要求（用户反复强调）：
 *   发现页卡片、相遇雷达、首页「今日高匹配的 TA」→
 *   **就地以弹窗打开对方的人格卡**，不要跳转到 /persona。
 *   侧栏「我的人格」→ 才是自己。
 *
 * ⚠️ 这里同时验两件事，少一件都不算过：
 *   ① 弹窗打开（不是整页跳转），URL 不变；
 *   ② 弹窗里是**对方**的卡（不是「我的人格」），且是只读视图。
 *
 * 历史提醒：本文件早先只验"h1 是不是 XX 的人格卡"，那时实现是**跳转**，
 * 所以断言写成跳转后的 h1。改成弹窗后必须同步改断言 ——
 * 否则就会拿旧行为把新 bug 放过去（或反过来误报）。
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

await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
});

/** 等弹窗里的卡片渲染出来（dev 下首次编译路由可能要几秒） */
const waitCard = async (timeoutMs = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (
      await page.evaluate(() =>
        Boolean(document.querySelector('[data-persona-modal="1"] [data-persona-card]')),
      )
    ) {
      return true;
    }
    await page.waitForTimeout(400);
  }
  return false;
};

/** 读弹窗状态：标题、是否对方、是否只读、URL 是否还在原页 */
const modalInfo = async (expectedPath) =>
  page.evaluate((wantPath) => {
    const m = document.querySelector('[data-persona-modal="1"]');
    const t = m?.textContent ?? "";
    /* ⚠️ 不能用"文字里有没有『注入数据』"判断只读：
       六源区块的标题就是「六源注入状态」，本人描述里也可能出现
       「Agent 蒸馏」字样（实测丁香医生的 bio 就有）。那样会误报。
       要断言的是**本人专属的交互控件**在不在：
         · 注入数据页里的「选择聊天文件」等操作按钮
         · 「开始蒸馏」按钮 */
    const buttons = [...(m?.querySelectorAll("button") ?? [])].map((b) =>
      b.textContent.trim(),
    );
    return {
      open: Boolean(m),
      title: m?.querySelector("[data-modal-title]")?.textContent?.trim() ?? "",
      cardId: m?.querySelector("[data-persona-card]")?.getAttribute("data-persona-card") ?? null,
      hasInjectControl: buttons.some((b) => /选择聊天文件|上传|去接入|注入/.test(b)),
      hasDistillControl: buttons.some((b) => /开始蒸馏|重新蒸馏/.test(b)),
      buttonLabels: buttons.slice(0, 8),
      /* 仍在原页面（没有跳到 /persona） */
      pathname: location.pathname,
      stayed: location.pathname === wantPath,
    };
  }, expectedPath);

const closeModal = async () => {
  await page.evaluate(() => {
    document.querySelector('[data-persona-modal="1"] [aria-label="关闭人格卡"]')?.click();
  });
  await page.waitForTimeout(400);
};

const expectedModal = (r) =>
  r.open && r.title.includes("的人格卡") && !r.title.includes("我的人格");

console.log("端到端验证：三维入口就地弹窗打开对方人格卡");
console.log("=".repeat(80));

/* A. 发现页卡片 */
{
  await page.goto(BASE + "/find", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2600);
  const urlBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector("[data-open-persona]");
    if (!b) return false;
    b.click();
    return true;
  });
  await waitCard();
  const r = await modalInfo("/find");
  const urlAfter = await page.evaluate(() => `${location.pathname}${location.search}`);

  rec("发现页点「查看人格卡」→ 弹窗打开对方的人格卡", clicked && expectedModal(r),
    `标题「${r.title}」`);
  rec("**没有跳到 /persona**（URL 不变）", urlAfter === urlBefore && r.stayed,
    `${urlBefore} → ${urlAfter}`);
  rec("对方卡片是只读（无注入/蒸馏的本人专属操作按钮）",
    !r.hasInjectControl && !r.hasDistillControl,
    `弹窗内按钮：${r.buttonLabels.join(" / ") || "(无)"}`);
  await closeModal();
}

/* B. 相遇雷达 */
{
  await page.goto(BASE + "/find", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2600);
  const urlBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("相遇雷达"));
    if (b) b.click();
  });
  await page.waitForTimeout(2200);

  /* 量完立刻点，避免雷达重渲染导致坐标失效 */
  const pt = await page.evaluate(() => {
    const n = document.querySelector('[data-action="profile"]');
    if (!n) return null;
    n.scrollIntoView({ block: "center", behavior: "instant" });
    const rect = n.getBoundingClientRect();
    return {
      id: n.getAttribute("data-id"),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  });
  if (pt) {
    await page.waitForTimeout(500);
    const pt2 = await page.evaluate((id) => {
      const n = document.querySelector(`[data-action="profile"][data-id="${id}"]`);
      if (!n) return null;
      const rect = n.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }, pt.id);
    if (pt2) {
      await page.mouse.move(pt2.x, pt2.y);
      await page.mouse.down();
      await page.waitForTimeout(60);
      await page.mouse.up();
    }
  }
  await waitCard();
  const r = await modalInfo("/find");
  const urlAfter = await page.evaluate(() => `${location.pathname}${location.search}`);

  rec("雷达点头像 → 弹窗打开对方的人格卡", expectedModal(r), `标题「${r.title}」`);
  rec("雷达点击也没有跳页", urlAfter === urlBefore && r.stayed, `${urlBefore} → ${urlAfter}`);
  await closeModal();
}

/* C. 首页「今日高匹配的 TA」 */
{
  await page.goto(BASE + "/home", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2800);
  const urlBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector("[data-open-persona]");
    if (!b) return false;
    b.click();
    return true;
  });
  await waitCard();
  const r = await modalInfo("/home");
  const urlAfter = await page.evaluate(() => `${location.pathname}${location.search}`);

  rec("首页预览卡片 → 弹窗打开对方的人格卡", clicked && expectedModal(r), `标题「${r.title}」`);
  rec("首页点击没有跳页", urlAfter === urlBefore && r.stayed, `${urlBefore} → ${urlAfter}`);
  await closeModal();
}

/* D. 侧栏「我的人格」→ 仍是自己的页面 */
{
  await page.goto(BASE + "/persona", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2200);
  const r = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
    hasInject: document.body.innerText.includes("注入数据"),
  }));
  rec("侧栏「我的人格」→ 显示我自己的卡片", r.h1 === "我的人格", `h1="${r.h1}"`);
  rec("自己视角有「注入数据」等操作", r.hasInject, r.hasInject ? "正确显示" : "被误隐藏");
}

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
