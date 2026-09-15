#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/** 我的人格页验证：三页签 + 五轴雷达 + 30 题 SBTI 完整流程 + 蒸馏阶段 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = path.join(RECON_DIR, "web-persona");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });

const errs = [];
const bad = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};
const clickText = (t) =>
  page.evaluate((x) => {
    const b = [...document.querySelectorAll("button")].find((e) => e.textContent.trim().includes(x));
    if (!b) return false;
    b.click();
    return true;
  }, t);

console.log("我的人格页验证");
console.log("=".repeat(80));

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "人格页验证" }),
  });
  const d = await r.json();
  if (d?.ok) localStorage.setItem("zhiyu_demo", JSON.stringify({ userId: d.userId, personaId: d.personaId }));
});
await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);

/* ① 页签 */
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim()),
);
rec("三个页签渲染", tabs.join("/") === "人格卡/注入数据/Agent 蒸馏", tabs.join(" / "));

/* ② 六源注入状态 */
const cov = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[class*="covList"] li')];
  return {
    n: items.length,
    names: items.map((i) => i.querySelector('[class*="covName"]')?.textContent?.trim().split("Observed")[0].split("Self")[0].trim() ?? ""),
    on: items.filter((i) => i.textContent.includes("已注入")).length,
  };
});
rec("六源状态列表齐全", cov.n === 6, `${cov.n} 项，已注入 ${cov.on}：${cov.names.join(" / ")}`);

/* ③ 五轴雷达：用真实 SBTI 15 维聚合，必须画出数据面 */
const radar = await page.evaluate(() => {
  const shell = document.querySelector('[class*="prShell"]');
  const svg = shell?.querySelector("svg");
  const val = svg?.querySelector("polygon[class*='prVal']");
  const dots = svg?.querySelectorAll("circle[class*='prDot']").length ?? 0;
  const names = [...(svg?.querySelectorAll("text[class*='prName']") ?? [])].map((t) => t.textContent.trim());
  const empty = !!shell?.querySelector('[class*="prEmpty"]');
  return { hasSvg: !!svg, hasVal: !!val, valPts: val?.getAttribute("points")?.split(" ").length ?? 0, dots, names, empty };
});
rec("五轴雷达画出数据面（不是空态）",
  radar.hasSvg && radar.hasVal && radar.dots === 5 && !radar.empty,
  `数据面 ${radar.valPts} 个点、${radar.dots} 个顶点；轴：${radar.names.join(" / ")}`);
rec("五轴标签为真实聚合维度", radar.names.join("") === "自我情感观念行动社交", radar.names.join("/"));

/* ④ 每根轴的百分比条 */
const axisRows = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="axisRow"]')];
  return rows.map((r) => ({
    label: r.querySelector('[class*="axisLabel"]')?.textContent?.trim() ?? "",
    val: r.querySelector('[class*="axisVal"]')?.textContent?.trim() ?? "",
    width: r.querySelector(".trackFill")?.style?.width ?? "",
  }));
});
rec("五根轴都有百分比与进度条", axisRows.length === 5 && axisRows.every((r) => r.val.includes("%") && r.width),
  axisRows.map((r) => `${r.label}${r.val}`).join(" "));

/* ⑤ 人格类型徽标 + SBTI 自评行
   注意：这两件事现在是**分开**的两处（曾经把 SBTI 结果当综合画像，
   所以旧断言写成"类型徽标里应出现 SBTI 码" —— 那是错的，已改）。 */
const typeInfo = await page.evaluate(() => {
  const el = document.querySelector("[data-fused-type]");
  const sim = [...document.querySelectorAll('[class*="typeBadge"] .meta')].map((e) => e.textContent.trim());
  const sbtiLine = document.querySelector("[data-sbti-self]")?.textContent?.trim() ?? "";
  return { type: el?.textContent?.trim() ?? "", sim: sim.join(" "), sbtiLine };
});
const SIX_TYPES = ["深度思考型", "好奇探索型", "温和共情型", "理性辩手型", "体验派", "务实执行型"];
rec(
  "综合画像显示六型倾向之一（不是 SBTI 的类型名）",
  SIX_TYPES.includes(typeInfo.type),
  `${typeInfo.type} · ${typeInfo.sim}`,
);
rec(
  "SBTI 自评单独一行且带等级码",
  typeInfo.sbtiLine.includes("SBTI 自评") && /[LMH]{5}-/.test(typeInfo.sbtiLine),
  `「${typeInfo.sbtiLine.slice(0, 60)}」`,
);

await page.screenshot({ path: path.join(OUT, "persona-card.png") });

/* ⑥ 注入数据页签 */
await clickText("注入数据");
await page.waitForTimeout(900);
const srcCards = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[class*="srcCard"]')];
  /* 已接通的来源：zhihu（真实同步）与 sbti（内置测试）。
     其余四个（微信/QQ/飞书/钉钉）尚未接入，按钮应为禁用。 */
  /* 六个源**都已接入**（微信/QQ/飞书/钉钉的手动导入 + 飞书/钉钉的授权同步都已上线），
     所以任何一个源都不该再给"禁用占位按钮"。
     这条断言以前写作 ["知乎","SBTI"] —— 那时另外四个还是点不动的占位。
     现在它改成"已接入的源必须可点"，反而更有意义。 */
  const IMPLEMENTED = ["知乎", "SBTI", "微信", "QQ", "飞书", "钉钉"];
  return {
    n: cards.length,
    titles: cards.map((c) => c.querySelector('[class*="srcTitle"]')?.textContent?.trim() ?? ""),
    badges: cards.map((c) => (c.textContent.includes("已注入") ? "已注入" : "未注入")),
    injectedCount: cards.filter((c) => c.textContent.includes("已注入")).length,
    implementedCount: cards.filter((c) =>
      IMPLEMENTED.some((k) => (c.querySelector('[class*="srcTitle"]')?.textContent ?? "").includes(k)),
    ).length,
    disabledActions: cards.filter((c) => c.querySelector("button[disabled]")).length,
  };
});
rec("六张数据源卡片", srcCards.n === 6, srcCards.titles.join(" / "));
/* 已注入的数量随数据变化（SBTI 做过、知乎同步过都会变），所以断言"与页面显示一致"
   而不是写死数字。之前写死 5 个禁用按钮，知乎同步一上线就误报失败。 */
rec(
  "卡片上的注入状态数与实际一致",
  srcCards.injectedCount >= 1 && srcCards.injectedCount <= srcCards.n,
  `${srcCards.injectedCount}/${srcCards.n} 张显示已注入：${srcCards.badges.join(" ")}`,
);
/* 六个源都已接入 → 不该有任何禁用按钮 */
rec(
  "已接入的来源都不给禁用按钮（不假装能点）",
  srcCards.disabledActions === srcCards.n - srcCards.implementedCount,
  `${srcCards.disabledActions} 个禁用 / ${srcCards.n - srcCards.implementedCount} 个未接入`,
);
await page.screenshot({ path: path.join(OUT, "persona-sources.png") });

/* ⑦ Agent 蒸馏页签 */
await clickText("Agent 蒸馏");
await page.waitForTimeout(900);
const distill = await page.evaluate(() => {
  const stages = [...document.querySelectorAll('[class*="stageList"] li')];
  /* 只数 runReq 内部、且排除"数据源注入情况"那行的 meta —— 取直接子级里的 badge */
  const reqRows = [...document.querySelectorAll('[class*="runReq"]')];
  const firstRowBadges = reqRows[0] ? reqRows[0].querySelectorAll(".badge").length : 0;
  return {
    n: stages.length,
    names: stages.map((s) => s.querySelector('[class*="stName"]')?.textContent?.trim() ?? ""),
    states: stages.map((s) => s.querySelector('[class*="stNote"]')?.textContent?.trim() ?? ""),
    reqChips: firstRowBadges,
    hasFig: !!document.querySelector('[class*="agentFig"] img'),
  };
});
rec("蒸馏五阶段渲染", distill.n === 5, distill.names.join(" → "));
rec("已完成阶段正确标记", distill.states.filter((s) => s === "已完成").length === 2,
  distill.states.join(" / "));
rec("数据源要求条 + 角色图就位", distill.reqChips === 6 && distill.hasFig,
  `${distill.reqChips} 个来源 chip，角色图=${distill.hasFig}`);
await page.screenshot({ path: path.join(OUT, "persona-distill.png") });

/* ⑧ SBTI 30 题完整流程 */
await clickText("人格卡");
await page.waitForTimeout(700);
await clickText("重新测试 SBTI");
await page.waitForTimeout(900);

const quizOpen = await page.evaluate(() => ({
  open: !!document.querySelector('[role="dialog"]'),
  total: document.querySelector('[class*="quizHead"] .meta:last-child')?.textContent?.trim() ?? "",
  opts: document.querySelectorAll('[class*="optList"] button').length,
  qText: document.querySelector('[class*="quizText"]')?.textContent?.trim() ?? "",
}));
rec("SBTI 弹窗打开且无题库加载中间态",
  quizOpen.open && quizOpen.opts >= 2 && quizOpen.qText.length > 0,
  `${quizOpen.total}，本题 ${quizOpen.opts} 个选项：「${quizOpen.qText.slice(0, 26)}…」`);

/* 逐题作答：每题点第一个选项（会自动跳下一题） */
const TOTAL = 30;
for (let i = 0; i < TOTAL; i += 1) {
  const ok = await page.evaluate(() => {
    const b = document.querySelector('[class*="optList"] button');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!ok) break;
  await page.waitForTimeout(90);
}
await page.waitForTimeout(4000);

const afterSubmit = await page.evaluate(() => {
  const modal = document.querySelector('[data-sbti-result="1"]');
  return {
    /* 答题弹窗（role=dialog 的 SBTI 测试）应关闭；结果弹窗会打开 */
    quizGone: !document.querySelector('[aria-label="SBTI 测试"]'),
    doneBar: document.querySelector('[class*="doneBar"]')?.textContent?.trim() ?? "",
    /* 综合画像显示的是**融合**出的六型倾向，不再是 SBTI 的类型名 */
    fusedType: document.querySelector("[data-fused-type]")?.textContent?.trim() ?? "",
    /* SBTI 自评单独一行 */
    sbtiLine: document.querySelector("[data-sbti-self]")?.textContent?.trim() ?? "",
    /* 测完应弹出完整结果弹窗 */
    resultModal: Boolean(modal),
    resultTitle: modal?.querySelector("[data-sbti-title]")?.textContent?.trim() ?? "",
  };
});
rec("答完 30 题自动提交并关闭答题弹窗", afterSubmit.quizGone, `答题弹窗关闭=${afterSubmit.quizGone}`);
rec(
  "提交后弹出 SBTI 完整结果弹窗",
  afterSubmit.resultModal && afterSubmit.resultTitle.length > 0,
  `弹窗标题「${afterSubmit.resultTitle}」`,
);
rec(
  "综合画像展示的是融合倾向型（六型之一）",
  ["深度思考型", "好奇探索型", "温和共情型", "理性辩手型", "体验派", "务实执行型"].includes(
    afterSubmit.fusedType,
  ),
  `综合画像 = ${afterSubmit.fusedType}`,
);
rec(
  "SBTI 自评与综合画像分开显示",
  afterSubmit.sbtiLine.includes("SBTI 自评"),
  `「${afterSubmit.sbtiLine.slice(0, 60)}」`,
);
rec("顶部出现「刚完成」提示条", afterSubmit.doneBar.includes("刚完成 SBTI"),
  `「${afterSubmit.doneBar.slice(0, 60)}」`);

/* 关掉结果弹窗，后面的用例才看得到页面 */
await page.evaluate(() => {
  document.querySelector('[data-sbti-result="1"] [aria-label="关闭测试结果"]')?.click();
});
await page.waitForTimeout(600);

/* ⑨ 提交后雷达仍在（真实数据刷新后仍可画） */
const radarAfter = await page.evaluate(() => {
  const val = document.querySelector('[class*="prShell"] polygon[class*="prVal"]');
  const dots = document.querySelectorAll('[class*="prShell"] circle[class*="prDot"]').length;
  return { hasVal: !!val, dots };
});
rec("提交后五轴雷达重新绘出", radarAfter.hasVal && radarAfter.dots === 5,
  `数据面=${radarAfter.hasVal} 顶点=${radarAfter.dots}`);

await page.screenshot({ path: path.join(OUT, "persona-after-quiz.png") });

/* ⑩ 别人的人格卡（只读） */
await page.goto(`${BASE}/persona?id=nonexistent-id`, { waitUntil: "load" });
await page.waitForTimeout(2500);
/* 不存在的人格 → 重定向到登录页；而登录页现在会把**已登录**用户
   继续送到 /home（#2 的修复：回调后不再停在登录页）。
   所以最终落点可能是 "/"（未登录）或 "/home"（已登录），两者都算正确 ——
   这里要验的是"没有崩在人格卡上"，不是"必须停在登录页"。 */
const notFoundPath = await page.evaluate(() => location.pathname);
rec(
  "不存在的人格 id 不崩（重定向离开人格卡页）",
  notFoundPath === "/" || notFoundPath === "/home",
  `最终位置 ${notFoundPath}`,
);

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
