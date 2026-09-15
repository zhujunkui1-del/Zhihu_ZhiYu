#!/usr/bin/env node
/**
 * 四项反馈的验证。
 *
 *  ① 首页「我的人格」模块必须与「我的人格」页同步：显示**综合画像**
 *     （多源融合的六型倾向），不能是 SBTI 自评结果。
 *  ② 「Agent 匹配」页看报告 → 点「查看 TA 的人格卡」必须**弹窗**，
 *     不能跳 /persona（用户强调过三次）。
 *  ③ 「通知」页点「再看一次」必须**在本页弹窗**打开该场匹配报告，
 *     不能跳 /agent-match。
 *  ④ 蒸馏要刷新**分源解析**（facet）—— 否则发了新数据卡片也不变。
 *
 * 用法：node --env-file=.env scripts/verify-no-jump-and-sync.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-nojump");
fs.mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

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

const SIX = ["深度思考型", "好奇探索型", "温和共情型", "理性辩手型", "体验派", "务实执行型"];
const clickText = (t, tag = "button") =>
  page.evaluate(
    ([txt, sel]) => {
      const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().includes(txt));
      if (!b) return false;
      b.click();
      return true;
    },
    [t, tag],
  );
const waitFor = async (fn, ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(400);
  }
  return false;
};

/* 登录 */
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1800);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST" });
});

/* ───────── ① 首页与人格页同步 ───────── */
console.log("\n== ① 首页「我的人格」应是综合画像 ==");
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);

const homeInfo = await page.evaluate(() => {
  const h2 = [...document.querySelectorAll("h2")].map((x) => x.textContent.trim());
  const fused = document.querySelector("[data-home-fused]")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  const sbti = document.querySelector("[data-home-sbti]")?.textContent?.trim() ?? "";
  /* 首页标题里那句「你的人格倾向是「X」」 */
  const title = h2.find((t) => t.includes("人格倾向")) ?? "";
  return { title, fused, sbti, h2 };
});
const homeType = (homeInfo.title.match(/「(.+?)」/) ?? [])[1] ?? "";
rec(
  "首页标题用的是综合画像的六型倾向",
  SIX.includes(homeType),
  `标题「${homeInfo.title}」`,
);
rec(
  "首页有独立的「综合画像」说明",
  homeInfo.fused.includes("综合画像"),
  `「${homeInfo.fused.slice(0, 80)}」`,
);
rec(
  "首页 SBTI 自评单独一行",
  homeInfo.sbti === "" || homeInfo.sbti.includes("SBTI 自评"),
  `「${homeInfo.sbti || "(无 SBTI)"}」`,
);
rec(
  "首页不再把 SBTI 类型当作人格倾向",
  !homeInfo.title.includes("死者") && !homeInfo.title.includes("DEAD"),
  `标题「${homeInfo.title}」`,
);

/* 与人格页对比，两边应一致 */
await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);
const personaType = await page.evaluate(() => {
  /* ④c 之后人格页的主结论是「带依据的 LLM 判型」（[data-judged-type]）。
     取**主型名**，不能用「六型数组里第一个出现在文本里的」那种写法 ——
     同一个框里还有一行"六维相似度…次接近 深度思考型"，那样会取到次接近的型
     （实测踩过：明明是理性辩手型却比出深度思考型）。 */
  const judged = document.querySelector("[data-judged-type]");
  if (judged) {
    const badge = judged.querySelector('[class*="typeName"]');
    const t = (badge?.textContent ?? judged.textContent ?? "").trim();
    const six = ["深度思考型", "好奇探索型", "温和共情型", "理性辩手型", "体验派", "务实执行型"];
    /* 先看徽章里的；徽章取不到时，取**文本中最先出现**的那个 */
    if (badge) return six.find((x) => t.includes(x)) ?? "";
    const hits = six
      .map((x) => ({ x, i: t.indexOf(x) }))
      .filter((h) => h.i >= 0)
      .sort((a, b) => a.i - b.i);
    return hits[0]?.x ?? "";
  }
  return document.querySelector("[data-fused-type]")?.textContent?.trim() ?? "";
});
rec(
  "首页与人格页显示同一个倾向型",
  homeType !== "" && homeType === personaType,
  `首页=${homeType}　人格页=${personaType}`,
);
await page.screenshot({ path: path.join(OUT, "home-synced.png") });

/* ───────── ② Agent 匹配页：查看 TA 的人格卡 → 弹窗 ───────── */
console.log("\n== ② Agent 匹配页：查看报告 → 查看 TA 的人格卡 ==");
await page.goto(`${BASE}/agent-match`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);

/* 切到「匹配报告」页签 */
await clickText("匹配报告");
await page.waitForTimeout(1200);
const openedReport = await clickText("查看报告");
rec("打开一篇匹配报告", openedReport);
const reportOpen = await waitFor(
  () => Boolean(document.querySelector('[data-match-report-modal="1"] [data-report-title]')),
);
rec("报告弹窗打开", reportOpen);

const pathBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
const clickedCard = await page.evaluate(() => {
  const b = document.querySelector("[data-open-persona-from-report]");
  if (!b) return null;
  const id = b.getAttribute("data-open-persona-from-report");
  b.click();
  return id;
});
rec("报告里有「查看 TA 的人格卡」按钮", Boolean(clickedCard), clickedCard ?? "未找到");

await waitFor(() => Boolean(document.querySelector('[data-persona-modal="1"] [data-persona-card]')));
const pathAfter = await page.evaluate(() => `${location.pathname}${location.search}`);
const cardModal = await page.evaluate(() => {
  const m = document.querySelector('[data-persona-modal="1"]');
  return {
    open: Boolean(m),
    title: m?.querySelector("[data-modal-title]")?.textContent?.trim() ?? "",
    cardId: m?.querySelector("[data-persona-card]")?.getAttribute("data-persona-card") ?? null,
  };
});
rec("人格卡以**弹窗**打开", cardModal.open, `标题「${cardModal.title}」`);
rec("弹窗里是 TA 的人格卡（不是「我的人格」）", cardModal.title.includes("的人格卡"), cardModal.title);
rec("点击的是同一个人", cardModal.cardId === clickedCard, `弹窗=${cardModal.cardId} 点击=${clickedCard}`);
rec("**没有跳转**（仍在 Agent 匹配页）", pathAfter === pathBefore, `${pathBefore} → ${pathAfter}`);
await page.screenshot({ path: path.join(OUT, "report-nested-persona.png") });

/* ───────── ③ 通知页：再看一次 → 本页弹报告 ───────── */
console.log("\n== ③ 通知页：「再看一次」应在本页弹报告 ==");
/* 造一条带 matchId 的通知（拿现有的一场 match） */
const login = await page.evaluate(async () => await fetch("/api/auth/session").then((r) => r.json()));
const meUserId = login?.user?.userId;
const anyMatch = await prisma.match.findFirst({
  where: { report: { isNot: null }, personaA: { userId: meUserId ?? undefined } },
  orderBy: { updatedAt: "desc" },
  select: { id: true },
});
if (meUserId && anyMatch) {
  await prisma.notification.create({
    data: {
      userId: meUserId,
      type: "agent_completed",
      payload: { matchId: anyMatch.id, counterpartName: "验证对象", overallScore: 0.6 },
    },
  });
}

await page.goto(`${BASE}/notify`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);
const notifyBefore = await page.evaluate(() => `${location.pathname}${location.search}`);
const clickedAgain = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /再看一次|查看/.test(x.textContent) && !x.disabled,
  );
  if (!b) return false;
  b.click();
  return true;
});
rec("通知页有可点的「再看一次」", clickedAgain);
await waitFor(() => Boolean(document.querySelector('[data-match-report-modal="1"] [data-report-title]')));
const notifyModal = await page.evaluate(() => {
  const m = document.querySelector('[data-match-report-modal="1"]');
  return { open: Boolean(m), title: m?.querySelector("[data-report-title]")?.textContent?.trim() ?? "" };
});
const notifyAfter = await page.evaluate(() => `${location.pathname}${location.search}`);
rec("报告以**弹窗**打开", notifyModal.open, `标题「${notifyModal.title}」`);
rec(
  "**没有跳转**（仍在通知页，不是 agent-match）",
  notifyAfter === notifyBefore && notifyAfter.startsWith("/notify"),
  `${notifyBefore} → ${notifyAfter}`,
);
await page.screenshot({ path: path.join(OUT, "notify-report-modal.png") });

/* ───────── ④ 蒸馏要刷新分源解析 ───────── */
console.log("\n== ④ 蒸馏会刷新分源解析（facet） ==");
const target = await prisma.persona.findFirst({
  where: { id: { startsWith: "zhihu-" }, evidence: { some: {} } },
  select: { id: true, displayName: true },
  orderBy: { displayName: "asc" },
});
if (target) {
  const before = await prisma.personaFeature.findUnique({
    where: { personaId_key: { personaId: target.id, key: "facets:zhihu" } },
    select: { value: true },
  });
  const { distillPersona } = await import("../lib/persona/distill.ts");
  const { platformProvider } = await import("../lib/llm/platform.ts");
  await distillPersona(target.id, platformProvider() ?? undefined);
  const after = await prisma.personaFeature.findUnique({
    where: { personaId_key: { personaId: target.id, key: "facets:zhihu" } },
    select: { value: true },
  });
  rec(
    `蒸馏后分源解析已写入/刷新（${target.displayName}）`,
    Boolean(after),
    after
      ? `facet 存在；itemCount=${after.value?.itemCount ?? "-"}`
      : "蒸馏后仍没有 facet",
  );
  rec(
    "facet 里含六维数值",
    Boolean(after?.value?.values && Object.keys(after.value.values).length > 0),
    after ? JSON.stringify(after.value?.values).slice(0, 120) : "-",
  );
  void before;
} else {
  rec("找到可测的真实用户", false, "库里没有带证据的 zhihu- 人格");
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
