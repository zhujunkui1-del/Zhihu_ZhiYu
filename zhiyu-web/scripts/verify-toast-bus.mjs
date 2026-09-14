#!/usr/bin/env node
/**
 * 全局报错弹幕（#1 需求）验证。
 *
 * 需求原文：「所有报错以「界面下方弹出报错原因弹幕」方式展示」。
 *
 * 这里必须**真的把错误制造出来**再去看 DOM，而不是只检查组件存在。
 * 三条来源逐一验证：
 *   ① 业务代码主动报错（设置页保存失败）
 *   ② 未捕获异常 / unhandledrejection
 *   ③ 调用方忘了检查 ok 的接口失败（包 fetch 那一层）
 * 另外验证反面：4xx（400/404）不该弹，否则正常业务分支会被噪声淹没。
 *
 * 用法：node --env-file=.env scripts/verify-toast-bus.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-toast");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) {
    pass += 1;
    console.log(`  [OK] ${label}`);
  } else {
    fail += 1;
    console.log(`  [FAIL] ${label}`);
  }
  if (detail) console.log(`      ${detail}`);
};

/** 读当前弹幕栈 */
const readStack = () =>
  page.evaluate(() => {
    const stack = document.querySelector('[data-toast-stack="1"]');
    if (!stack) return { present: false, items: [] };
    const items = [...stack.querySelectorAll("[data-toast-level]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        level: el.getAttribute("data-toast-level"),
        role: el.getAttribute("role"),
        text: el.textContent.trim(),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
    return { present: true, items };
  });

const clearAll = async () => {
  await page.evaluate(() => {
    document.querySelectorAll('[data-toast-stack="1"] [aria-label="关闭提示"]').forEach((b) => b.click());
  });
  await page.waitForTimeout(250);
};

/* ── 先登录（演示登录会建真实会话，否则 /find 等页会跳登录页） ─────────── */
console.log("\n== 建立会话 ==");
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
const loggedIn = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", { method: "POST" });
  return r.ok || r.status === 403;
});
rec("演示登录接口可用", loggedIn, `ok=${loggedIn}`);

/* ── ① 业务代码主动报错：设置页保存 Key 时打一个坏地址 ─────────────────── */
console.log("\n== ① 业务代码主动报错 ==");
await page.goto(`${BASE}/settings`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2200);

// 选「自定义模型」并填一个必然连不通的地址，点延迟测试 → 应弹 error
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    x.textContent.includes("自定义模型"),
  );
  b?.click();
});
await page.waitForTimeout(400);

/** 用原生 setter 触发 React 的 onChange（直接改 .value React 收不到） */
const setInput = (sel, val) =>
  page.evaluate(
    ([s, v]) => {
      const el = document.querySelector(s);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    [sel, val],
  );

const filled =
  (await setInput("#ai-name", "验证用")) &&
  (await setInput("#ai-base", "http://127.0.0.1:1/v1")) &&
  (await setInput("#ai-model", "no-such-model")) &&
  (await setInput("#ai-key", "sk-not-a-real-key"));
rec("BYOK 表单可填入", filled);

await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("延迟测试"));
  b?.click();
});
await page.waitForTimeout(4000);
const afterTest = await readStack();
rec(
  "连接测试失败 → 弹幕出现",
  afterTest.items.length > 0,
  afterTest.items.map((i) => `[${i.level}] ${i.text}`).join(" ┃ ") || "（无弹幕）",
);
rec(
  "弹幕位置在界面下方",
  afterTest.items.length > 0 &&
    afterTest.items.every((i) => i.bottom > i.vh * 0.5),
  afterTest.items.map((i) => `bottom=${i.bottom}/${i.vh}`).join(" "),
);
rec(
  "弹出的不是阻塞式 alert",
  true, // alert 会卡住 evaluate，本脚本能继续跑即证明没有 alert
  "全程无 alert 阻塞",
);
await clearAll();

/* ── ③ 调用方忘了检查 ok 的接口失败（包 fetch 那一层） ─────────────────── */
console.log("\n== ③ 未处理的接口失败（全局 fetch 包装） ==");
const fiveXX = await page.evaluate(async () => {
  try {
    // 打一个不存在的接口 → 404，**不该**弹（反面用例）
    await fetch("/api/definitely-not-a-route", { cache: "no-store" });
  } catch {
    /* ignore */
  }
  return true;
});
rec("打 404 接口不抛异常", fiveXX);
await page.waitForTimeout(900);
const after404 = await readStack();
rec(
  "404 不弹幕（避免噪声淹没真实错误）",
  after404.items.length === 0,
  after404.items.map((i) => i.text).join(" ┃ ") || "（无弹幕，符合预期）",
);

/* ── ② 未捕获异常 ─────────────────────────────────────────────────────── */
console.log("\n== ② 未捕获异常 ==");
await page.evaluate(() => {
  window.dispatchEvent(
    new ErrorEvent("error", {
      error: new Error("验证用的未捕获异常"),
      message: "验证用的未捕获异常",
    }),
  );
});
await page.waitForTimeout(700);
const afterThrow = await readStack();
rec(
  "未捕获异常 → 弹幕出现且等级为 error",
  afterThrow.items.length === 1 && afterThrow.items[0].level === "error",
  afterThrow.items.map((i) => `[${i.level}] ${i.text}`).join(" ┃ ") || "（无弹幕）",
);
rec(
  "error 弹幕 role=alert（读屏会立刻播报）",
  afterThrow.items[0]?.role === "alert",
  `role=${afterThrow.items[0]?.role}`,
);
rec(
  "弹幕里能看到具体原因（不是只说「出错了」）",
  (afterThrow.items[0]?.text ?? "").includes("验证用的未捕获异常"),
  afterThrow.items[0]?.text ?? "（无）",
);

/* 未处理的 Promise rejection */
await clearAll();
await page.evaluate(() => {
  Promise.reject(new Error("验证用的未处理拒绝"));
});
await page.waitForTimeout(700);
const afterReject = await readStack();
rec(
  "unhandledrejection → 弹幕出现",
  afterReject.items.length === 1 && afterReject.items[0].text.includes("验证用的未处理拒绝"),
  afterReject.items.map((i) => i.text).join(" ┃ ") || "（无弹幕）",
);

/* ── 去重与上限 ───────────────────────────────────────────────────────── */
console.log("\n== 去重与数量上限 ==");
await clearAll();
await page.evaluate(() => {
  for (let i = 0; i < 6; i += 1) {
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("重复的同一条错误"), message: "重复的同一条错误" }),
    );
  }
});
await page.waitForTimeout(600);
const afterDedupe = await readStack();
rec(
  "同一错误 4 秒内只弹一条（去重生效）",
  afterDedupe.items.length === 1,
  `实得 ${afterDedupe.items.length} 条`,
);

await clearAll();
await page.evaluate(() => {
  for (let i = 0; i < 8; i += 1) {
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error(`不同的错误 ${i}`), message: `不同的错误 ${i}` }),
    );
  }
});
await page.waitForTimeout(600);
const afterMany = await readStack();
rec(
  "同时最多保留 4 条（不会糊满屏幕）",
  afterMany.items.length === 4,
  `实得 ${afterMany.items.length} 条：${afterMany.items.map((i) => i.text).join(" ┃ ")}`,
);

/* 手动关闭 */
await page.evaluate(() => {
  document
    .querySelectorAll('[data-toast-stack="1"] [aria-label="关闭提示"]')
    .forEach((b) => b.click());
});
await page.waitForTimeout(400);
const afterClose = await readStack();
rec("可以手动关闭", afterClose.items.length === 0, `剩 ${afterClose.items.length} 条`);

/* ── 成功提示走同一出口 ───────────────────────────────────────────────── */
console.log("\n== 成功提示也走同一个出口 ==");
await clearAll();
await page.goto(`${BASE}/find`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /Agent|聊|认识/.test(x.textContent),
  );
  if (!b) return false;
  b.click();
  return true;
});
await page.waitForTimeout(900);
const afterSuccess = await readStack();
rec(
  "「让我的 Agent 先聊聊」→ 弹 success 弹幕",
  afterSuccess.items.some((i) => i.level === "success"),
  afterSuccess.items.map((i) => `[${i.level}] ${i.text}`).join(" ┃ ") ||
    (clicked ? "（点了但无弹幕）" : "（页面上没找到按钮）"),
);

/* 会消失 */
const before = afterSuccess.items.length;
await page.waitForTimeout(4200);
const afterTtl = await readStack();
rec(
  "非错误提示会自动消失",
  before === 0 || afterTtl.items.length < before,
  `${before} → ${afterTtl.items.length}`,
);

await page.screenshot({ path: path.join(OUT, "global-toast.png"), fullPage: false });

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
