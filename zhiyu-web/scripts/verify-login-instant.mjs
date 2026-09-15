#!/usr/bin/env node
/**
 * 手机端登录页「按钮点不动」+「授权状态校验失败说不出原因」的回归验证。
 *
 * ── 用户实际反馈 ──────────────────────────────────────────────────────────
 *   ① 手机打开登录页很慢，而且在慢的那段时间里「使用知乎账号登录」**点不动**；
 *   ② 登录经常失败，只给一句「授权状态校验失败，请重新发起登录」，
 *      账号明明有手机号也实名了，却看不出卡在哪一步。
 *
 * ── 这个脚本要证明什么 ────────────────────────────────────────────────────
 *   A. 用 CDP `Fetch` 域把 `/api/auth/session` 人为拖慢 4 秒
 *      （模拟手机端冷启动 + 跨洋 Serverless 往返）：
 *      · 探测**确实已发出且尚未返回**时，登录按钮就能点（不是 disabled）
 *      · 点下去立刻有反馈（按钮进入"正在登录…"），点击不会被吞掉
 *      · 最多等 1.2 秒就带 returnTo 跳 `/api/auth/zhihu`，不傻等 4 秒
 *      · 全程只发一次探测请求（挂载与点击复用同一个 Promise）
 *   B. 三种 state 失败在页面上必须**说得出区别**，错误代码可见，
 *      且 `?oauth=` 不再被 replaceState 抹掉。
 *   C. 回归：已登录仍自动进 /home；但"本次回调失败"时不被自动跳转顶掉。
 *
 * 说明：本机 Playwright 不可用，走的是 skill 里的 CDP 适配器，
 *      它没有 `page.route`，但暴露了 `page.connection.send/on`，
 *      因此这里直接使用 CDP 的 Fetch 域做请求拦截。
 *
 * 用法：node scripts/verify-login-instant.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const MOBILE = { width: 390, height: 844 };
const PROBE_DELAY_MS = 4000;
const ZHIHU_DELAY_MS = 1500;

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 登录卡片里那个带知乎 logo 的主按钮（按 CSS module 类名定位，文案会变） */
const readBtn = () => {
  const b =
    document.querySelector('button[class*="oauthBtn"]') ??
    [...document.querySelectorAll("button")].find((x) => /知乎|正在登录/.test(x.textContent));
  return b
    ? { found: true, disabled: b.disabled, text: b.textContent.trim() }
    : { found: false };
};
const clickLogin = () => {
  const b =
    document.querySelector('button[class*="oauthBtn"]') ??
    [...document.querySelectorAll("button")].find((x) => x.textContent.includes("知乎"));
  if (b) b.click();
  return Boolean(b);
};
/**
 * 注意：CDP 适配器的 `page.url()` 只在**整页导航**时更新，
 * 客户端 `router.replace` 之后它仍是旧值（实测）。
 * 所以一律读文档里的真实地址。
 */
const livePath = () => window.location.pathname + window.location.search;

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

try {
  /* ══ A. 探测很慢时按钮必须照样能点 ═════════════════════════════════════ */
  console.log("\nA. 慢探测下的按钮可用性（手机视口 390×844）");
  {
    const page = await browser.newPage({ viewport: MOBILE });
    const seen = { session: [], zhihu: [], sessionContinued: 0, errors: [] };
    await page.connection.send("Fetch.enable", {
      patterns: [
        { urlPattern: "*/api/auth/session*", requestStage: "Request" },
        { urlPattern: "*/api/auth/zhihu*", requestStage: "Request" },
      ],
    });
    page.connection.on("Fetch.requestPaused", async ({ requestId, request }) => {
      const url = request?.url ?? "";
      try {
        if (url.includes("/api/auth/session")) {
          seen.session.push(url);
          await sleep(PROBE_DELAY_MS);
          await page.connection.send("Fetch.continueRequest", { requestId });
          seen.sessionContinued += 1;
        } else if (url.includes("/api/auth/zhihu")) {
          seen.zhihu.push(url);
          await sleep(ZHIHU_DELAY_MS);
          /* 别真的跳到知乎授权页 */
          await page.connection.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
            body: Buffer.from("<p>stub-zhihu-authorize</p>", "utf8").toString("base64"),
          });
        } else {
          await page.connection.send("Fetch.continueRequest", { requestId });
        }
      } catch (e) {
        seen.errors.push(String(e?.message ?? e));
      }
    });

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    /* 等"探测请求已发出"= React 已挂载并跑过 effect；此时响应被人为卡住 */
    for (let i = 0; i < 60 && seen.session.length === 0; i += 1) {
      await page.waitForTimeout(100);
    }
    rec("会话探测请求确实已发出（说明已挂载，且响应被卡住）", seen.session.length === 1, `${seen.session.length} 次`);

    const early = await page.evaluate(readBtn);
    rec("能取到登录按钮", early.found === true, JSON.stringify(early));
    rec(
      "探测进行中按钮**不是** disabled（即用户反馈的「点不动」）",
      early.found === true && early.disabled === false,
      JSON.stringify(early),
    );
    rec(
      "且按钮不是加载态文案",
      early.found === true && early.text.includes("使用知乎账号登录"),
      early.text ?? "",
    );
    rec("此刻探测确实还没返回（否则这条断言没意义）", seen.sessionContinued === 0);

    const clicked = await page.evaluate(clickLogin);
    rec("登录按钮可被点击", clicked === true);
    await page.waitForTimeout(250);
    const busy = await page.evaluate(readBtn);
    rec(
      "点下去立刻有反馈（不会点了没反应）",
      Boolean(busy.found) && (busy.text.includes("正在登录") || busy.disabled === true),
      JSON.stringify(busy),
    );

    await page.waitForTimeout(1800);
    rec(
      "1.2 秒超时兜底后发起真实授权（没有傻等 4 秒探测）",
      seen.zhihu.length === 1,
      `${seen.zhihu.length} 次：${seen.zhihu[0] ?? "（无）"}`,
    );
    rec(
      "跳转带上 returnTo=/home",
      (seen.zhihu[0] ?? "").includes("returnTo=%2Fhome"),
      seen.zhihu[0] ?? "",
    );
    rec(
      "只发一次探测请求（挂载与点击复用同一个 Promise）",
      seen.session.length === 1,
      seen.session.join(" , "),
    );
    rec("拦截过程没有内部错误", seen.errors.length === 0, seen.errors.join(" | "));
    try {
      await page.connection.send("Fetch.disable");
    } catch {
      /* 页面可能已跳走，忽略 */
    }
    await page.close();
  }

  /* ══ B. 三种 state 失败要能区分，且原因不被抹掉 ═══════════════════════ */
  console.log("\nB. 失败原因可区分 / 可截图");
  const cases = [
    ["state_expired", "超过 10 分钟"],
    ["state_consumed", "已经完成过一次"],
    ["state_mismatch", "不是本浏览器发起"],
  ];
  for (const [code, expect] of cases) {
    const page = await browser.newPage({ viewport: MOBILE });
    await page.goto(`${BASE}/?oauth=${code}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => ({
      text: document.querySelector('[role="alert"]')?.textContent ?? "",
      search: window.location.search,
      href: window.location.href,
      canRetry: (() => {
        const b =
          document.querySelector('button[class*="oauthBtn"]') ??
          [...document.querySelectorAll("button")].find((x) => x.textContent.includes("知乎"));
        return b ? b.disabled === false : false;
      })(),
    }));
    rec(`${code} 显示对应的人话说明`, info.text.includes(expect), info.text.slice(0, 140));
    rec(`${code} 错误代码可见（可截图反馈）`, info.text.includes(code), info.text.slice(0, 140));
    rec(`${code} ?oauth= 不再被从地址栏抹掉`, info.search.includes(`oauth=${code}`), info.href);
    rec(`${code} 报错后按钮仍可点（能直接重试）`, info.canRetry === true);
    await page.close();
  }

  /* ══ C. 回归：已登录自动进 /home，但回调失败时不跳 ═════════════════════ */
  console.log("\nC. 回归");
  {
    const page = await browser.newPage({ viewport: MOBILE });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const demo = await page.evaluate(async () => {
      const r = await fetch("/api/auth/demo", { method: "POST" });
      return { status: r.status, body: (await r.text()).slice(0, 80) };
    });
    rec("本地演示登录可用（回归前置）", demo.status === 200, `HTTP ${demo.status} ${demo.body}`);

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    const authed = await page.evaluate(livePath);
    rec("已登录访问 / 仍会自动进 /home（读文档真实地址）", authed === "/home", authed);

    await page.goto(`${BASE}/?oauth=denied`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => ({
      path: window.location.pathname + window.location.search,
      alert: document.querySelector('[role="alert"]')?.textContent ?? "",
    }));
    rec(
      "已登录但本次回调失败时**不**被自动跳转顶掉（报错优先）",
      after.path === "/?oauth=denied" && after.alert.includes("拒绝"),
      after.path,
    );
    await page.close();
  }
} catch (e) {
  fail += 1;
  console.log(`  [FAIL] 抛出异常：${e?.stack ?? e}`);
} finally {
  await browser.close();
}

console.log(`\n  手机端登录：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
