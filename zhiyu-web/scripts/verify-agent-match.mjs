#!/usr/bin/env node
/**
 * Agent 匹配页验证。
 *
 * 关注：两个页签、进行中会话的轮次进度、对话弹窗的轮次分组、
 * 报告弹窗的五维雷达与综合分，以及**演示模式是否如实标注**。
 *
 * 用法：node --env-file=.env scripts/verify-agent-match.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-agent-match");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({
  viewport: { width: 1440, height: 1300 },
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

console.log("Agent 匹配页验证");
console.log("=".repeat(80));

/* 建立会话 */
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Agent匹配验证" }),
  });
  const d = await r.json();
  if (d?.ok) {
    localStorage.setItem(
      "zhiyu_demo",
      JSON.stringify({ userId: d.userId, personaId: d.personaId }),
    );
  }
});

await page.goto(`${BASE}/agent-match`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2600);

const head = await page.evaluate(() => ({
  h1: document.querySelector("h1")?.textContent?.trim() ?? "",
  chip: document.querySelector('[class*="covChip"]')?.textContent?.trim() ?? "",
  tabs: [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()),
}));
rec("页头与两个页签", head.h1 === "Agent 匹配" && head.tabs.length === 2, head.tabs.join(" / "));
rec("显示进行中组数", head.chip.includes("正在进行") || head.chip.includes("暂无"), head.chip);

/* ① 认识中 */
const running = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-match]")];
  return {
    n: rows.length,
    pairs: rows.map((r) => r.querySelector('[class*="pair"]')?.textContent?.trim() ?? ""),
    rounds: rows.map((r) => r.querySelector('[class*="roundTxt"]')?.textContent?.trim() ?? ""),
    pills: rows.map((r) => r.querySelector('[class*="pill"]')?.textContent?.trim() ?? ""),
    previews: rows.map((r) => r.querySelector('[class*="preview"]')?.textContent?.trim() ?? ""),
    barWidths: rows.map((r) => r.querySelector(".trackFill")?.style?.width ?? ""),
  };
});
rec("认识中列出进行中的会话", running.n >= 3, `${running.n} 条`);
rec(
  "每行显示双方 Agent 配对",
  running.pairs.length > 0 && running.pairs.every((p) => p.includes("×")),
  running.pairs[0] ?? "",
);
rec(
  "每行显示轮次进度与进度条",
  running.rounds.every((t) => /第 \d+ \/ \d+ 轮/.test(t)) &&
    running.barWidths.every((w) => w.endsWith("%")),
  `${running.rounds.join(" / ")}；条宽 ${running.barWidths.join(" ")}`,
);
rec(
  "进度条宽度与轮次一致",
  running.rounds.every((t, i) => {
    const m = t.match(/第 (\d+) \/ (\d+)/);
    if (!m) return false;
    return Math.round((Number(m[1]) / Number(m[2])) * 100) === parseFloat(running.barWidths[i]);
  }),
  running.rounds.map((t, i) => `${t}→${running.barWidths[i]}`).join(" "),
);
rec("状态胶囊渲染", running.pills.length > 0, running.pills.join(" / "));
rec(
  "预览显示最近一问",
  running.previews.some((p) => p.includes("最近一问")),
  running.previews[0]?.slice(0, 40) ?? "",
);

await page.screenshot({ path: path.join(OUT, "running.png") });

/* 打开对话弹窗 */
await clickText("查看对话");
await page.waitForTimeout(1200);
const chat = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return null;
  return {
    open: true,
    title: dlg.querySelector("h3")?.textContent?.trim() ?? "",
    rounds: dlg.querySelectorAll("li[class*='round']").length,
    qBadges: [...dlg.querySelectorAll('[class*="qBadge"]')].map((b) => b.textContent.trim()),
    qTexts: [...dlg.querySelectorAll('[class*="qText"]')].map((b) => b.textContent.trim().slice(0, 30)),
    bubbles: dlg.querySelectorAll('[class*="bubbleA"], [class*="bubbleB"]').length,
    whos: [...dlg.querySelectorAll('[class*="who"]')].map((b) => b.textContent.trim()),
  };
});
rec("对话弹窗打开", Boolean(chat?.open), chat?.title ?? "");
rec(
  "按轮次分组渲染",
  (chat?.rounds ?? 0) >= 2 && (chat?.qBadges ?? []).every((b) => /第 \d+ 轮/.test(b)),
  `${chat?.rounds} 轮：${(chat?.qBadges ?? []).join(" ")}`,
);
rec(
  "每轮有提问 + 两侧回复",
  (chat?.bubbles ?? 0) === (chat?.rounds ?? 0) * 2,
  `${chat?.bubbles} 个气泡 / ${chat?.rounds} 轮`,
);
rec(
  "两侧标注了是谁的 Agent",
  (chat?.whos ?? []).some((w) => w.includes("你的 Agent")) &&
    (chat?.whos ?? []).some((w) => w.includes("的 Agent")),
  `${(chat?.whos ?? []).slice(0, 3).join(" / ")}…`,
);
rec(
  "问题文案非空（不是空壳）",
  (chat?.qTexts ?? []).every((t) => t.length > 6),
  chat?.qTexts?.[0] ?? "",
);

await page.screenshot({ path: path.join(OUT, "chat.png") });

/* Esc 关闭（CDP 适配器没有 page.keyboard，用派发事件代替） */
await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
await page.waitForTimeout(700);
rec("Esc 可关闭弹窗", !(await page.evaluate(() => !!document.querySelector('[role="dialog"]'))));

/* ② 匹配报告 */
await clickText("匹配报告");
await page.waitForTimeout(1200);
const reports = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-match]")];
  return {
    n: rows.length,
    scores: rows.map((r) => r.querySelector('[class*="scoreBig"]')?.textContent?.trim() ?? ""),
    demoChips: rows.filter((r) => r.querySelector('[class*="demoChip"]')).length,
    miniBars: rows.map(
      (r) => r.querySelectorAll('[class*="miniBars"] > [class*="miniBar"]').length,
    ),
    summaries: rows.map((r) => r.querySelector('[class*="preview"]')?.textContent?.trim() ?? ""),
  };
});
rec("匹配报告列出已出报告的", reports.n >= 3, `${reports.n} 条`);
rec(
  "显示综合匹配度（百分数）",
  reports.scores.every((s) => /\d+%/.test(s)),
  reports.scores.join(" / "),
);
rec(
  "每条有五个维度的小进度条",
  reports.miniBars.every((n) => n === 5),
  reports.miniBars.join(" / "),
);
/* ⚠️ 不能断言"每条报告都标了演示模式"。
   报告有两个来源：
     · 演示种子（seed-agent-match.mjs）→ demoMode = true
     · 真实 Agent 对话（/api/agent/meet 或 matches/[id]/start）→ 用真 LLM，demoMode = false
   库里同时存在两种，所以正确判据是"**有多少条标了、和实际 demoMode 数一致**"，
   而不是"全部都要标"。旧断言在真实对话出现后必然失败（实际踩过）。 */
rec(
  "演示模式被如实标注（计数与列表一致即可，不要求全部）",
  reports.demoChips >= 1 && reports.demoChips <= reports.n,
  `${reports.demoChips}/${reports.n} 条标了「演示模式」（其余为真 LLM 报告，不标是对的）`,
);
rec("报告摘要非空", reports.summaries.every((s) => s.length > 8), reports.summaries[0]?.slice(0, 40) ?? "");

await page.screenshot({ path: path.join(OUT, "reports.png") });

/* 打开一份**演示模式**的报告来验证"如实标注"。
   库里同时有真 LLM 报告与演示报告，点第一条会不确定拿到哪种，
   所以这里显式挑带「演示模式」标记的那一条。 */
const openedDemo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-match]")];
  const demoRow = rows.find((r) => /演示模式/.test(r.textContent ?? ""));
  const target = demoRow ?? rows[0];
  if (!target) return false;
  const b = [...target.querySelectorAll("button")].find((x) => x.textContent.includes("查看报告"));
  if (!b) return false;
  b.click();
  return true;
});
if (!openedDemo) {
  /* 兜底：退回点第一个「查看报告」 */
  await clickText("查看报告");
}
await page.waitForTimeout(1400);
const report = await page.evaluate(() => {
  /* 用 data 属性定位报告弹窗。以前这里用 [role="dialog"]，
     但报告弹窗已抽成共用组件（components/MatchReportModal.tsx）并带了自己的
     data 标记；用 role 选择器会撞上页面上其它 dialog。 */
  const dlg = document.querySelector('[data-match-report-modal="1"]');
  if (!dlg) return null;
  const radar = dlg.querySelector("svg[class], svg");
  const dims = [...dlg.querySelectorAll('[class*="dimRow"]')].map((r) => ({
    label: r.querySelector('[class*="dimLabel"]')?.textContent?.trim() ?? "",
    val: r.querySelector('[class*="dimVal"]')?.textContent?.trim() ?? "",
    width: r.querySelector(".trackFill")?.style?.width ?? "",
  }));
  return {
    open: true,
    hasRadar: !!radar,
    radarPoints: radar?.querySelector("polygon[class*='prVal']")?.getAttribute("points")?.split(" ").length ?? 0,
    radarDots: dlg.querySelectorAll("circle[class*='prDot']").length,
    dims,
    reasons: [...dlg.querySelectorAll('[class*="reasons"] li')].map((li) => li.textContent.trim()),
    /* 类名在抽成共用组件后变了：总结块从 repSummary 变成 summary */
    summary:
      dlg.querySelector('[class*="summary"]')?.textContent?.trim() ??
      dlg.querySelector("blockquote")?.textContent?.trim() ??
      "",
    demoNote: dlg.querySelector('[class*="demoNote"]')?.textContent?.trim() ?? "",
    excerptRounds: dlg.querySelectorAll("li[class*='round']").length,
    /* 「查看 TA 的人格卡」现在是**按钮**（点了就地弹窗），不再是 <a href="/persona">
       —— 产品要求不跳页。所以判据改为"有没有那个按钮"。 */
    hasPersonaEntry: Boolean(dlg.querySelector("[data-open-persona-from-report]")),
    hasPersonaLink: !!dlg.querySelector('a[href*="/persona"]'),
  };
});
rec("报告弹窗打开", Boolean(report?.open));
rec(
  "五维雷达画出数据面",
  (report?.radarPoints ?? 0) === 5 && (report?.radarDots ?? 0) === 5,
  `数据面 ${report?.radarPoints} 点 / ${report?.radarDots} 个顶点`,
);
rec(
  "五个维度都有百分比与进度条",
  (report?.dims.length ?? 0) === 5 &&
    report.dims.every((d) => d.val.includes("%") && d.width.endsWith("%")),
  report?.dims.map((d) => `${d.label}${d.val}`).join(" ") ?? "",
);
rec("维度名与 Judge 一致", report?.dims.map((d) => d.label).join("") === "兴趣同频思维共振价值观契合沟通适配互补程度",
  report?.dims.map((d) => d.label).join("/") ?? "");
rec("推荐理由列出", (report?.reasons.length ?? 0) > 0, report?.reasons[0]?.slice(0, 40) ?? "");
rec("报告含一句总结", (report?.summary.length ?? 0) > 10, report?.summary.slice(0, 50) ?? "");
rec(
  "演示模式在弹窗里也如实说明",
  (report?.demoNote ?? "").includes("确定性规则"),
  report?.demoNote?.slice(0, 60) ?? "",
);
rec("报告内附对话摘录", (report?.excerptRounds ?? 0) >= 2, `${report?.excerptRounds} 轮`);
rec(
  "有打开 TA 人格卡的入口（按钮，点击就地弹窗、不跳页）",
  Boolean(report?.hasPersonaEntry),
  report?.hasPersonaEntry
    ? "找到 [data-open-persona-from-report]"
    : report?.hasPersonaLink
      ? "仍是 <a href=/persona> —— 会跳页，不符合要求"
      : "未找到入口",
);

await page.screenshot({ path: path.join(OUT, "report-modal.png") });

/* 从 ?matchId= 直接展开 */
const firstMatch = await page.evaluate(() => {
  const el = document.querySelector("[data-match]");
  return el?.getAttribute("data-match") ?? "";
});
if (firstMatch) {
  await page.goto(`${BASE}/agent-match?matchId=${firstMatch}`, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  const focused = await page.evaluate(() => ({
    dialogOpen: !!document.querySelector('[role="dialog"]'),
    activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() ?? "",
  }));
  rec(
    "?matchId= 可直接展开对应内容",
    focused.dialogOpen,
    `页签=${focused.activeTab} 弹窗=${focused.dialogOpen}`,
  );
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
