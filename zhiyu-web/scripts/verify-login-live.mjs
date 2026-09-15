#!/usr/bin/env node
/**
 * 线上（www.zhiyuapp.site）验证用户反馈的两件事。
 *
 * 为什么要单独打线上：本地跑的是 dev server，而用户手机打开的是生产域名。
 * 生产环境禁用了演示登录（DEMO_DISABLED），所以**登录态相关的东西线上验不了**，
 * 但用户抱怨的两点恰好在匿名状态下就能验：
 *   ① 登录按钮什么时候能点；
 *   ② 授权失败时页面说不说得清原因。
 *
 * 用法：node scripts/verify-login-live.mjs [BASE]
 */
import assert from "node:assert/strict";
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "https://www.zhiyuapp.site";
const MOBILE = { width: 390, height: 844 };

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

try {
  console.log(`\n线上登录页（手机 390×844）：${BASE}\n`);

  /* ── ① 按钮多久可点 ─────────────────────────────────────────────────── */
  const page = await browser.newPage({ viewport: MOBILE });
  const assets = [];
  page.connection.on("Network.requestWillBeSent", (ev) => {
    const u = ev.request?.url ?? "";
    if (u.includes("/assets/")) assets.push(u);
  });

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  const tDom = Date.now();
  /* 一 DOM 就查（此刻 React 可能还没 hydrate；SSR 出来的 disabled 属性已经在） */
  const atDom = await page.evaluate(() => {
    const b = document.querySelector('button[class*="oauthBtn"]');
    return b ? { found: true, disabled: b.disabled, text: b.textContent.trim() } : { found: false };
  });
  rec("DOMContentLoaded 时登录按钮已在页面上（SSR 出来的）", atDom.found === true, JSON.stringify(atDom));
  rec("DOMContentLoaded 时按钮就**不是** disabled（不用等任何探测）", atDom.disabled === false, JSON.stringify(atDom));

  /* 再等 hydrate 完成，确认按钮依然可点（不是被 effect 又禁用了） */
  let enabledAt = null;
  for (let i = 0; i < 60; i += 1) {
    const s = await page.evaluate(() => {
      const b = document.querySelector('button[class*="oauthBtn"]');
      return b ? b.disabled : null;
    });
    if (s === false) {
      enabledAt = Date.now() - tDom;
      break;
    }
    await page.waitForTimeout(100);
  }
  rec("hydrate 之后按钮仍可点（没有被 effect 重新禁用）", enabledAt !== null, `${enabledAt} ms 内可点`);

  rec("线上确实在请求 paper.webp（新资源已生效）", assets.some((u) => u.includes("paper.webp")), assets.filter((u) => u.includes("paper")).join(" , "));
  rec("线上**不再**请求 1.27MB 的 paper.png", !assets.some((u) => u.includes("paper.png")));
  await page.close();

  /* ── ② 失败原因说不说得清 ───────────────────────────────────────────── */
  for (const [code, expect] of [
    ["state_expired", "超过 10 分钟"],
    ["state_consumed", "已经完成过一次"],
    ["state_mismatch", "不是本浏览器发起"],
  ]) {
    const p = await browser.newPage({ viewport: MOBILE });
    await p.goto(`${BASE}/?oauth=${code}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    /* ⚠️ 报错文案是客户端 effect 渲染的，必须先 hydrate 才会出现。
       线上从这台机器过去首屏要十几秒（跨洋 + 逐个 chunk），
       所以这里轮询等 hydrate，而不是拍脑袋 waitForTimeout —— 否则会把
       「还没 hydrate」误判成「功能没上线」。 */
    let info = { text: "", search: "", canRetry: false };
    for (let i = 0; i < 300; i += 1) {
      info = await p.evaluate(() => ({
        text: document.querySelector('[role="alert"]')?.textContent ?? "",
        search: window.location.search,
        canRetry: (() => {
          const b = document.querySelector('button[class*="oauthBtn"]');
          return b ? b.disabled === false : false;
        })(),
      }));
      if (info.text.includes(code)) break;
      await p.waitForTimeout(100);
    }
    rec(`线上 ${code} 给出可分辨的说明`, info.text.includes(expect), info.text.slice(0, 120) || "（30 秒内未渲染出报错）");
    rec(`线上 ${code} 错误代码可见`, info.text.includes(code), info.text.slice(0, 120) || "（30 秒内未渲染出报错）");
    rec(`线上 ${code} ?oauth= 未被抹掉`, info.search.includes(`oauth=${code}`), info.search);
    rec(`线上 ${code} 可直接点登录重试`, info.canRetry === true);
    await p.close();
  }
} catch (e) {
  fail += 1;
  console.log(`  [FAIL] 抛出异常：${e?.stack ?? e}`);
} finally {
  await browser.close();
}

console.log(`\n  线上登录页：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
