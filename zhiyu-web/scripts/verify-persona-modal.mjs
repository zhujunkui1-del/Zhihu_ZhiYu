#!/usr/bin/env node
/**
 * 弹窗人格卡验证（用户反复强调的核心要求）。
 *
 * 要求原文：
 *   「在首页的『发现 · 快速匹配预览_今日高匹配的 TA』模块，点击『去看看TA』，
 *     **不要跳转界面**，就在该界面下，**以弹窗的形式打开对方的人格卡**。
 *     发现页里点击『查看人格卡』同理。」
 *
 * 所以本测试的重点不是"能不能看到卡"，而是：
 *   ① 点击前后 **URL 不变**（不跳 /persona）
 *   ② 不产生任何整页导航
 *   ③ 弹窗里是**对方**的人格卡（不是"我的人格"）
 *   ④ 弹窗里**有真实数据**（不是空壳）—— 这正是之前被投诉的点
 *   ⑤ 能关掉（✕ / 背景 / Esc）
 *
 * 用法：node --env-file=.env scripts/verify-persona-modal.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-modal");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/* 建立会话 */
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST" });
});

/** 记录整页导航次数：弹窗绝不能触发它 */
const installNavCounter = () =>
  page.evaluate(() => {
    window.__navs = 0;
    window.addEventListener("beforeunload", () => {
      window.__navs += 1;
    });
  });

const modalState = () =>
  page.evaluate(() => {
    const m = document.querySelector('[data-persona-modal="1"]');
    if (!m) return null;
    const card = m.querySelector("[data-persona-card]");
    const title = m.querySelector("[data-modal-title]")?.textContent?.trim() ?? "";
    const text = (m.textContent ?? "").replace(/\s+/g, " ");
    /* 六源里有几个标了"已注入" */
    const injected = (text.match(/已注入/g) ?? []).length;
    const notInjected = (text.match(/未注入/g) ?? []).length;
    return {
      title,
      personaId: card?.getAttribute("data-persona-card") ?? null,
      url: `${location.pathname}${location.search}`,
      pathname: location.pathname,
      hasRadar: Boolean(m.querySelector("svg")),
      injected,
      notInjected,
      /* 五维里有没有真实数值（"—" 表示空） */
      axisValues: [...m.querySelectorAll('[class*="axisVal"]')].map((e) => e.textContent.trim()),
      evidenceGroups: m.querySelectorAll("[data-evidence-source]").length,
      textLen: text.length,
      snippet: text.slice(0, 260),
    };
  });

const closeModal = async () => {
  await page.evaluate(() => {
    document.querySelector('[data-persona-modal="1"] [aria-label="关闭人格卡"]')?.click();
  });
  await page.waitForTimeout(500);
  return page.evaluate(() => !document.querySelector('[data-persona-modal="1"]'));
};

/**
 * 等「弹窗里的卡片内容」真正渲染出来。
 *
 * 为什么要轮询而不是固定 sleep：弹窗打开后要 fetch /api/persona/[id]，
 * dev 模式下首次编译该路由可能 2~4 秒。固定等 2 秒会误判成"打不开"
 * ——调试时正是这样误报过一次。
 */
const waitForCard = async (timeoutMs = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ready = await page.evaluate(
      () => Boolean(document.querySelector('[data-persona-modal="1"] [data-persona-card]')),
    );
    if (ready) return Date.now() - t0;
    await page.waitForTimeout(400);
  }
  return -1;
};

const waitFor = async (fn, timeoutMs = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(400);
  }
  return false;
};

/** 等出现可就地打开人格卡的按钮 */
const waitForOpenButton = () => waitFor(() => Boolean(document.querySelector("[data-open-persona]")));

/* ───────────────────────── 首页 ───────────────────────── */
console.log("\n== 首页：点「查看人格卡」应就地弹窗，不跳页 ==");
/* 先登录再进首页：顺序反了会被重定向，页面上就没有卡片（踩过一次） */
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1200);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST" });
});
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
const homeReady = await waitForOpenButton();
errs.length = 0; // 只关心进入测试页之后的报错
await installNavCounter();

const homeBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
const homeTarget = await page.evaluate(() => {
  const b = document.querySelector('[data-open-persona]');
  if (!b) return null;
  return { id: b.getAttribute("data-open-persona"), label: b.textContent.trim().slice(0, 40) };
});
rec(
  "首页存在可就地打开人格卡的按钮",
  Boolean(homeTarget),
  homeTarget ? `目标 ${homeTarget.id}（等了 ${homeReady ? "已就绪" : "超时"}）` : "未找到 [data-open-persona]",
);

if (homeTarget) {
  await page.evaluate(() => {
    document.querySelector('[data-open-persona]').click();
  });
  const waitedMs = await waitForCard();

  const m = await modalState();
  const homeAfter = await page.evaluate(() => `${location.pathname}${location.search}`);

  rec("弹窗打开了并渲染出卡片", Boolean(m), m ? `标题「${m.title}」，用时 ${waitedMs}ms` : "未出现 [data-persona-modal]");
  rec(
    "**URL 没有变化**（没有跳到 /persona）",
    homeAfter === homeBefore,
    `${homeBefore} → ${homeAfter}`,
  );
  rec(
    "仍然停在首页",
    m?.pathname === "/home",
    `pathname=${m?.pathname}`,
  );
  rec(
    "弹窗里是**对方**的人格卡（不是「我的人格」）",
    Boolean(m?.title) && m.title.includes("的人格卡") && !m.title.includes("我的人格"),
    `标题「${m?.title}」`,
  );
  rec(
    "弹窗内容对应被点击的那个人",
    m?.personaId === homeTarget.id,
    `卡片 id=${m?.personaId}　点击目标=${homeTarget.id}`,
  );

  console.log("\n== 弹窗里有没有真实数据（此前被投诉为空壳） ==");
  rec("画出了五维雷达", m?.hasRadar === true);
  rec(
    "五维有真实数值（不是全「—」）",
    Boolean(m?.axisValues.some((v) => v && v !== "—")),
    `各轴：${m?.axisValues.join(" ")}`,
  );
  rec(
    "至少一个数据源标为「已注入」",
    (m?.injected ?? 0) > 0,
    `已注入 ${m?.injected} 个 / 未注入 ${m?.notInjected} 个`,
  );
  rec(
    "列出了结论溯源（证据分组）",
    (m?.evidenceGroups ?? 0) > 0,
    `${m?.evidenceGroups} 组证据`,
  );
  rec("内容有实质长度（不是空壳）", (m?.textLen ?? 0) > 400, `${m?.textLen} 字`);

  await page.screenshot({ path: path.join(OUT, "home-modal.png") });

  console.log("\n== 关闭方式 ==");
  rec("点 ✕ 能关掉", await closeModal());

  /* 再开一次，测背景与 Esc */
  await page.evaluate(() => document.querySelector('[data-open-persona]').click());
  await waitForCard();
  await page.evaluate(() => {
    /* 点背景（弹窗容器里非对话框区域） */
    const wrap = document.querySelector('[data-persona-modal="1"]');
    const backdrop = wrap?.firstElementChild;
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const closedByBackdrop = await page.evaluate(
    () => !document.querySelector('[data-persona-modal="1"]'),
  );
  rec("点背景能关掉", closedByBackdrop);

  await page.evaluate(() => document.querySelector('[data-open-persona]').click());
  await waitForCard();
  await page.keyboard?.press?.("Escape").catch(() => {});
  /* 包装器没有 keyboard API 时，用事件兜底 */
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await page.waitForTimeout(500);
  const closedByEsc = await page.evaluate(
    () => !document.querySelector('[data-persona-modal="1"]'),
  );
  rec("按 Esc 能关掉", closedByEsc);
}

/* ───────────────────────── 发现页 ───────────────────────── */
console.log("\n== 发现页：点「查看人格卡」同样就地弹窗 ==");
await page.goto(`${BASE}/find`, { waitUntil: "load", timeout: 60000 });
await waitForOpenButton();
errs.length = 0;

const findBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
const findTarget = await page.evaluate(() => {
  const b = document.querySelector('[data-open-persona]');
  return b ? b.getAttribute("data-open-persona") : null;
});
rec("发现页存在就地打开按钮", Boolean(findTarget), findTarget ?? "未找到");

if (findTarget) {
  await page.evaluate(() => document.querySelector('[data-open-persona]').click());
  const waited2 = await waitForCard();
  const m2 = await modalState();
  const findAfter = await page.evaluate(() => `${location.pathname}${location.search}`);

  rec("弹窗打开了并渲染出卡片", Boolean(m2), m2 ? `标题「${m2.title}」，用时 ${waited2}ms` : "未出现");
  rec("**URL 没有变化**（没有跳到 /persona）", findAfter === findBefore, `${findBefore} → ${findAfter}`);
  rec("仍然停在发现页", m2?.pathname === "/find", `pathname=${m2?.pathname}`);
  rec(
    "弹窗里是对方的人格卡",
    Boolean(m2?.title) && m2.title.includes("的人格卡"),
    `标题「${m2?.title}」`,
  );
  rec(
    "弹窗内容非空壳",
    (m2?.injected ?? 0) > 0 && (m2?.axisValues ?? []).some((v) => v && v !== "—"),
    `已注入 ${m2?.injected} 个，五维 ${m2?.axisValues.join(" ")}`,
  );
  await page.screenshot({ path: path.join(OUT, "find-modal.png") });
  await closeModal();
}

/* ───────────────────────── 雷达 ───────────────────────── */
console.log("\n== 发现页雷达：点头像也应就地弹窗 ==");
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => /雷达/.test(b.textContent))?.click();
});
await page.waitForTimeout(2000);
const radarBefore = await page.evaluate(() => `${location.pathname}${location.search}`);

/* 用真实点击（复用之前验证过的稳定做法：量完立刻点） */
const radarPoint = await page.evaluate(() => {
  const b = document.querySelector('[data-action="profile"]');
  if (!b) return null;
  b.scrollIntoView({ block: "center", behavior: "instant" });
  const r = b.getBoundingClientRect();
  return { id: b.getAttribute("data-id"), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
if (radarPoint) {
  await page.waitForTimeout(600);
  const p2 = await page.evaluate((id) => {
    const b = document.querySelector(`[data-action="profile"][data-id="${id}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, radarPoint.id);
  if (p2) {
    await page.mouse.move(p2.x, p2.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await waitForCard();
  }
  const m3 = await modalState();
  const radarAfter = await page.evaluate(() => `${location.pathname}${location.search}`);
  rec("雷达点头像 → 弹窗打开", Boolean(m3), m3 ? `标题「${m3.title}」` : "未出现弹窗");
  rec("雷达点击也没有跳页", radarAfter === radarBefore, `${radarBefore} → ${radarAfter}`);
  rec("弹窗仍在发现页", m3?.pathname === "/find", `pathname=${m3?.pathname}`);
  await closeModal();
}

/* ───────────────────── 首页：真实知乎用户 ───────────────────── */
/* 上面点的是**内置演示人格**，它本来就没有证据行（那不是 bug）。
   用户真正投诉的是"点开真实知乎用户什么都没有"，所以这里必须再验一遍
   真实用户：选中预览里那个"真人"卡片。 */
console.log("\n== 首页：真实知乎用户的人格卡必须有真数据 ==");
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await waitForOpenButton();
errs.length = 0;

const realTarget = await page.evaluate(() => {
  /* 真人卡片的 id 形如 zhihu-xxx；内置演示人格的 id 是 cuid */
  const btns = [...document.querySelectorAll("[data-open-persona]")];
  const real = btns.find((b) => b.getAttribute("data-open-persona").startsWith("zhihu-"));
  if (!real) return null;
  const id = real.getAttribute("data-open-persona");
  real.click();
  return { id, label: real.textContent.trim().slice(0, 30) };
});
rec("首页预览里有真实知乎用户的卡片", Boolean(realTarget), realTarget?.id ?? "本轮预览里没有真人卡");

if (realTarget) {
  await waitForCard();
  const mReal = await modalState();
  const afterReal = await page.evaluate(() => `${location.pathname}${location.search}`);
  rec("真实用户弹窗打开且不跳页", Boolean(mReal) && afterReal.startsWith("/home"), `${afterReal}`);
  rec(
    "弹窗标题是那位真实用户",
    Boolean(mReal?.title) && mReal.title.includes("的人格卡"),
    `标题「${mReal?.title}」`,
  );
  rec(
    "**列出了结论溯源（证据）** —— 这正是之前投诉的「什么数据都没有」",
    (mReal?.evidenceGroups ?? 0) > 0,
    `${mReal?.evidenceGroups} 组证据`,
  );
  rec(
    "六源里知乎标为已注入",
    (mReal?.injected ?? 0) > 0,
    `已注入 ${mReal?.injected} 个`,
  );
  rec(
    "五维有真实数值",
    (mReal?.axisValues ?? []).some((v) => v && v !== "—"),
    `各轴：${mReal?.axisValues?.join(" ")}`,
  );
  rec("内容有实质长度", (mReal?.textLen ?? 0) > 500, `${mReal?.textLen} 字`);
  await page.screenshot({ path: path.join(OUT, "home-modal-real-user.png") });
  await closeModal();
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
