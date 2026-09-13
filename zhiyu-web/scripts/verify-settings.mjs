#!/usr/bin/env node
/**
 * 通知页 + 设置页验证。
 *
 * 重点：设置页的沟通偏好开关此前**只有表和 UI、没有接口**，点了不会生效。
 * 所以这里不只点开关，还要读回接口确认真的落库。
 *
 * 用法：node --env-file=.env scripts/verify-settings.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-settings");
fs.mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1400 },
  deviceScaleFactor: 2,
});

const errs = [];
const bad = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});
page.on("response", (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};
const clickText = (t) =>
  page.evaluate((x) => {
    const b = [...document.querySelectorAll("button")].find((e) =>
      e.textContent.trim().includes(x),
    );
    if (!b) return false;
    b.click();
    return true;
  }, t);

console.log("通知页 + 设置页验证");
console.log("=".repeat(80));

/* 建立会话 */
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(400);
const login = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "设置页验证" }),
  });
  const d = await r.json();
  if (d?.ok) {
    localStorage.setItem(
      "zhiyu_demo",
      JSON.stringify({ userId: d.userId, personaId: d.personaId }),
    );
  }
  return d;
});

/* ─────────────── 通知页 ─────────────── */
/* 造三条**专属测试通知**（未读对话完成 / 已读对话完成 / 未读报告），
   这样断言不依赖库里既有数据，也不会因为上一次运行把通知标为已读而失效。
   测试结束按 matchId 前缀清理。 */
const TAG = `verify${Date.now().toString(36)}`;
const MATCH_IDS = [`${TAG}-1`, `${TAG}-2`, `${TAG}-3`];

await prisma.notification.createMany({
  data: [
    {
      userId: login.userId,
      type: "agent_completed",
      payload: { matchId: MATCH_IDS[0], counterpart: "验证对象甲", overallScore: 0.73 },
    },
    {
      userId: login.userId,
      type: "agent_completed",
      payload: { matchId: MATCH_IDS[1], counterpart: "验证对象乙", overallScore: 0.41 },
      readAt: new Date(),
    },
    {
      userId: login.userId,
      type: "report_received",
      payload: { matchId: MATCH_IDS[2], counterpart: "验证对象丙", overallScore: 0.66 },
    },
  ],
});

await page.goto(`${BASE}/notify`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2400);

const head = await page.evaluate(() => ({
  h1: document.querySelector("h1")?.textContent?.trim() ?? "",
  tabs: [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()),
  chip: document.querySelector('[class*="covChip"]')?.textContent?.trim() ?? "",
  cards: document.querySelectorAll("[data-kind]").length,
  kinds: [...document.querySelectorAll("[data-kind]")].map((c) => c.getAttribute("data-kind")),
  overall: [...document.querySelectorAll('[class*="dchip"]')].map((d) => d.textContent.trim()),
}));
rec(
  "通知页头与三个分组页签",
  head.h1 === "通知" && head.tabs.length === 3,
  `${head.h1} / ${head.tabs.join(" ")}`,
);
rec("未读计数显示", head.chip.length > 0, head.chip);
rec("通知卡片渲染", head.cards >= 3, `${head.cards} 张`);
rec(
  "卡片带分组标记（done / report）",
  head.kinds.includes("done") && head.kinds.includes("report"),
  head.kinds.join(" "),
);
rec(
  "综合匹配度按百分数显示（库里是 0~1 小数）",
  head.overall.length > 0 && head.overall.every((o) => /\d+%/.test(o)),
  head.overall.slice(0, 3).join(" / "),
);

const unreadStyle = await page.evaluate(() => {
  const un = document.querySelector('[class*="unread"]');
  if (!un) return null;
  const cs = getComputedStyle(un);
  return {
    borderLeft: cs.borderLeftWidth,
    hasDot: !!un.querySelector('[class*="unreadDot"]'),
  };
});
rec(
  "未读卡片有左侧暖色条与圆点",
  Boolean(unreadStyle && parseFloat(unreadStyle.borderLeft) >= 3 && unreadStyle.hasDot),
  unreadStyle
    ? `borderLeft=${unreadStyle.borderLeft} dot=${unreadStyle.hasDot}`
    : "未找到未读卡片",
);

await page.screenshot({ path: path.join(OUT, "notify.png") });

/* 分组切换 */
await clickText("发来的报告");
await page.waitForTimeout(700);
const reportTab = await page.evaluate(() => ({
  cards: document.querySelectorAll("[data-kind]").length,
  kinds: [...document.querySelectorAll("[data-kind]")].map((c) => c.getAttribute("data-kind")),
}));
rec(
  "切到「发来的报告」只显示报告类",
  reportTab.cards > 0 && reportTab.kinds.every((k) => k === "report"),
  `${reportTab.cards} 张：${reportTab.kinds.join(" ")}`,
);
await clickText("全部");
await page.waitForTimeout(600);

/* 全部标为已读 → 未读清零 */
await clickText("全部标为已读");
await page.waitForTimeout(1800);
const afterRead = await page.evaluate(() => ({
  chip: document.querySelector('[class*="covChip"]')?.textContent?.trim() ?? "",
  unreadCards: document.querySelectorAll('[class*="unread"]').length,
}));
rec(
  "「全部标为已读」把未读清零",
  afterRead.chip.includes("暂无") && afterRead.unreadCards === 0,
  `${afterRead.chip}，未读卡片 ${afterRead.unreadCards}`,
);

/* ─────────────── 设置页 ─────────────── */
await page.goto(`${BASE}/settings`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2400);

const sections = await page.evaluate(() =>
  [...document.querySelectorAll("section")]
    .map((s) => s.querySelector(".panelEyebrow")?.textContent?.trim() ?? "")
    .filter((x) => /^0\d ·/.test(x)),
);
rec("四个分区齐全", sections.length === 4, sections.join(" | "));

const idRows = await page.evaluate(() => {
  const sec = [...document.querySelectorAll("section")].find((s) =>
    s.textContent.includes("01 · 身份与数据源"),
  );
  if (!sec) return [];
  return [...sec.querySelectorAll("h3")].map((h) => h.textContent.trim());
});
rec(
  "01 区六行（知乎账号 + 五个数据源）",
  idRows.length === 6 && idRows.some((t) => t.startsWith("知乎账号")),
  `${idRows.length} 行：${idRows.join(" / ")}`,
);

const prefRows = await page.evaluate(() =>
  [...document.querySelectorAll('[class*="switchWrap"] input')].map((i) => ({
    label: i.getAttribute("aria-label"),
    checked: i.checked,
  })),
);
rec(
  "02 区三个开关且默认全开",
  prefRows.length === 3 && prefRows.every((p) => p.checked),
  prefRows.map((p) => `${p.label}=${p.checked}`).join(" / "),
);

const align = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('[class*="switchWrap"]').forEach((w) => {
    const row = w.closest('[class*="row"]');
    const h3 = row?.querySelector("h3");
    if (!h3) return;
    const a = w.getBoundingClientRect();
    const b = h3.getBoundingClientRect();
    out.push(Math.round(a.top + a.height / 2 - (b.top + b.height / 2)));
  });
  return out;
});
rec(
  "开关与标题行对齐（偏差 <= 3px）",
  align.length > 0 && align.every((d) => Math.abs(d) <= 3),
  `各开关偏差：${align.join(", ")} px`,
);

const beforeApi = await page.evaluate(async (uid) => {
  const r = await fetch(`/api/settings/prefs?userId=${uid}`).then((x) => x.json());
  return r.prefs;
}, login.userId);
rec(
  "GET /api/settings/prefs 可用",
  typeof beforeApi?.allowAgentInvite === "boolean",
  JSON.stringify(beforeApi),
);

await page.evaluate(() => {
  document.querySelector('[class*="switchWrap"] input').click();
});
await page.waitForTimeout(1800);
const afterApi = await page.evaluate(async (uid) => {
  const r = await fetch(`/api/settings/prefs?userId=${uid}`).then((x) => x.json());
  return r.prefs;
}, login.userId);
rec(
  "点开关后服务端真的改了（不只是 UI）",
  afterApi.allowAgentInvite === !beforeApi.allowAgentInvite,
  `${prefRows[0]?.label}：${beforeApi.allowAgentInvite} → ${afterApi.allowAgentInvite}`,
);

await page.evaluate(() => {
  document.querySelector('[class*="switchWrap"] input').click();
});
await page.waitForTimeout(1600);
const restored = await page.evaluate(async (uid) => {
  const r = await fetch(`/api/settings/prefs?userId=${uid}`).then((x) => x.json());
  return r.prefs.allowAgentInvite;
}, login.userId);
rec("再点一次可还原", restored === beforeApi.allowAgentInvite, `还原为 ${restored}`);

/* 03 BYOK */
const byok = await page.evaluate(() => ({
  chips: document.querySelectorAll('[class*="chip"]').length,
  hasName: !!document.querySelector("#ai-name"),
  hasBase: !!document.querySelector("#ai-base"),
  hasModel: !!document.querySelector("#ai-model"),
  hasKey: !!document.querySelector("#ai-key"),
  keyType: document.querySelector("#ai-key")?.getAttribute("type"),
}));
rec("BYOK 预设按钮齐全（12 预设 + 自定义）", byok.chips >= 13, `${byok.chips} 个按钮`);
rec(
  "BYOK 表单字段齐全",
  byok.hasName && byok.hasBase && byok.hasModel && byok.hasKey,
);
rec("API Key 默认是密码输入框", byok.keyType === "password", `type=${byok.keyType}`);

await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => b.textContent.includes("DeepSeek"))
    ?.click();
});
await page.waitForTimeout(700);
const filled = await page.evaluate(() => ({
  name: document.querySelector("#ai-name")?.value ?? "",
  base: document.querySelector("#ai-base")?.value ?? "",
  model: document.querySelector("#ai-model")?.value ?? "",
}));
rec(
  "选预设自动填入名称与接入地址",
  filled.base.includes("deepseek") && filled.name.length > 0,
  `名称=${filled.name} 地址=${filled.base} 模型=${filled.model}`,
);

const listResp = await page.evaluate(async (uid) => {
  const r = await fetch(`/api/settings/llm?userId=${uid}`).then((x) => x.json());
  return JSON.stringify(r);
}, login.userId);
rec(
  "已接入模型列表不含明文 Key（只有掩码）",
  !/sk-[A-Za-z0-9]{10,}/.test(listResp),
  listResp.slice(0, 110),
);

await page.screenshot({ path: path.join(OUT, "settings.png") });

/* 04 退出确认 */
await clickText("退出登录");
await page.waitForTimeout(800);
const modal = await page.evaluate(() => ({
  open: !!document.querySelector('[role="dialog"]'),
  title: document.querySelector('[role="dialog"] h3')?.textContent?.trim() ?? "",
}));
rec("退出登录有二次确认", modal.open && modal.title.includes("退出"), modal.title);
if (modal.open) {
  await clickText("再想想");
  await page.waitForTimeout(400);
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

/* 清理测试通知：先查出来再按 id 删。
   不用 JSON 路径过滤 —— 各数据库对它的支持不一致，这样最稳。 */
try {
  const mine = await prisma.notification.findMany({
    where: { userId: login.userId },
    select: { id: true, payload: true },
  });
  const del = mine
    .filter((n) => {
      const p = n.payload;
      return typeof p?.matchId === "string" && p.matchId.startsWith(TAG);
    })
    .map((n) => n.id);
  if (del.length) await prisma.notification.deleteMany({ where: { id: { in: del } } });
  console.log(`\n已清理测试通知 ${del.length} 条`);
} catch (e) {
  console.warn("测试通知清理失败（不影响结论）:", e.message);
}
await prisma.$disconnect();

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
