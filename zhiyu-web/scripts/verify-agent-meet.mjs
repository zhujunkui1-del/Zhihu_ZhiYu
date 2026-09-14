#!/usr/bin/env node
/**
 * 「让 Agent 先聊聊」端到端验证（用户反馈的问题 1 与 2）。
 *
 * 反馈原文：
 *   「打开别人的人格卡后，缺少『让 agent 先聊聊』的按钮。」
 *   「现在的『让 agent 先聊聊』按钮没有实际效果，我在 agent 匹配页和通知页
 *     没有看到 agent 交流的迹象，我的 api 额度也没有变化。」
 *
 * 根因：按钮此前**只写 localStorage + 弹提示，从不调用后端**。
 *
 * 所以本测试必须验到"真的发生了对话"，而不是"弹了个提示"：
 *   ① 弹窗里有按钮
 *   ② 点下去真的打 /api/agent/meet，并且**真的用了大模型**（llmSource 不是 mock）
 *   ③ 库里出现 AgentSession + AgentMessage（多轮）
 *   ④ Agent 匹配页能看到这场对话
 *   ⑤ 通知页出现「Agent 对话已完成」
 *   ⑥ 点同一个人的卡**不会重复烧额度**（第二次返回 alreadyDone）
 *
 * 用法：node --env-file=.env scripts/verify-agent-meet.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-agent-meet");
fs.mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/* 登录并取到自己的 personaId。
   ⚠️ 直接进 /home 而不是 /：登录页在已登录时会自动 router.replace("/home")，
   那次导航会把我们正在发的 fetch 打断，返回空 body（踩过）。 */
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2000);
const login = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", { method: "POST" });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `HTTP ${r.status}，响应非 JSON：${text.slice(0, 120)}` };
  }
});
if (!login?.personaId) {
  console.error("登录失败：", JSON.stringify(login));
  process.exit(1);
}
const myPersonaId = login.personaId;
console.log(`我的 personaId = ${myPersonaId}\n`);

/* 选一个**还没聊过**的真实用户作为目标。
   为什么必须避开已聊过的：那种情况接口会直接返回 alreadyDone（不再消耗额度，
   这是设计如此），于是本轮测不到"真的跑了一场对话"。
   ——第一版没做这个筛选，第二次运行时误报了两项失败。 */
const existingMatches = await prisma.match.findMany({
  where: {
    OR: [{ personaAId: myPersonaId }, { personaBId: myPersonaId }],
    report: { isNot: null },
  },
  select: { personaAId: true, personaBId: true },
});
const talkedTo = new Set(
  existingMatches.flatMap((m) => [m.personaAId, m.personaBId]).filter((x) => x !== myPersonaId),
);

const allReal = await prisma.persona.findMany({
  where: { id: { startsWith: "zhihu-" }, agentOpen: true },
  select: { id: true, displayName: true },
  orderBy: { displayName: "asc" },
});
const target = allReal.find((p) => !talkedTo.has(p.id));
if (!target) {
  console.error("所有真实用户都已聊过，无法测新对话（可先跑 seed 重置）");
  process.exit(1);
}
console.log(`目标 = ${target.displayName} (${target.id})　（已排除聊过的 ${talkedTo.size} 位）\n`);

/* 记录测试前的状态，用于断言"确实新增了" */
const before = {
  sessions: await prisma.agentSession.count({
    where: { match: { OR: [{ personaAId: myPersonaId }, { personaBId: myPersonaId }] } },
  }),
  notifs: await prisma.notification.count({ where: { userId: login.userId } }),
};

/* ── ① 弹窗里有「让 Agent 先聊聊」 ───────────────────────────────────── */
console.log("== ① 人格卡弹窗里的按钮 ==");
await page.goto(`${BASE}/find?personaId=${myPersonaId}`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2600);

/* 直接用目标 id 打开弹窗：在发现页找那个人的卡片点开 */
const opened = await page.evaluate((tid) => {
  const btns = [...document.querySelectorAll("[data-open-persona]")];
  const b = btns.find((x) => x.getAttribute("data-open-persona") === tid) ?? btns[0];
  if (!b) return null;
  const id = b.getAttribute("data-open-persona");
  b.click();
  return id;
}, target.id);
if (!opened) {
  console.error("发现页没有可就地打开人格卡的按钮");
  process.exit(1);
}

/* 等弹窗内容 */
let modalReady = false;
for (let i = 0; i < 30; i += 1) {
  await page.waitForTimeout(400);
  modalReady = await page.evaluate(() =>
    Boolean(document.querySelector('[data-persona-modal="1"] [data-persona-card]')),
  );
  if (modalReady) break;
}
rec("弹窗加载出人格卡", modalReady);

const modalBtn = await page.evaluate(() => {
  const m = document.querySelector('[data-persona-modal="1"]');
  const b = m?.querySelector("[data-agent-meet]");
  return b
    ? { present: true, text: b.textContent.trim(), target: b.getAttribute("data-agent-meet") }
    : { present: false };
});
rec(
  "弹窗里有「让 Agent 先聊聊」按钮",
  modalBtn.present && /Agent/.test(modalBtn.text),
  modalBtn.present ? `按钮「${modalBtn.text}」→ ${modalBtn.target}` : "未找到 [data-agent-meet]",
);

/* ── ② 点按钮：真的调用后端并跑出结果 ───────────────────────────────── */
console.log("\n== ② 点击后真的发生对话（不是只弹提示） ==");
const apiHits = [];
page.on("response", (r) => {
  if (r.url().includes("/api/agent/meet")) apiHits.push(r.status());
});

const t0 = Date.now();
await page.evaluate(() => {
  document.querySelector('[data-persona-modal="1"] [data-agent-meet]')?.click();
});

/* 等按钮回到非进行中状态（说明请求结束） */
let finished = false;
for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(1000);
  const busy = await page.evaluate(() => {
    const b = document.querySelector('[data-persona-modal="1"] [data-agent-meet]');
    return b ? b.getAttribute("aria-busy") === "true" || /对话中/.test(b.textContent) : false;
  });
  if (!busy) {
    finished = true;
    break;
  }
}
const elapsed = Date.now() - t0;
rec("点击后请求已完成", finished, `耗时 ${(elapsed / 1000).toFixed(1)}s`);
rec("确实调用了 /api/agent/meet", apiHits.length > 0, `响应状态：${apiHits.join(", ") || "(无)"}`);

/* 页面上的提示文案：应说明用了什么模型 */
const toastText = await page.evaluate(() => {
  const s = document.querySelector('[data-toast-stack="1"]');
  return s ? s.textContent.replace(/\s+/g, " ").trim() : "";
});
rec("弹出了结果提示", toastText.length > 0, `「${toastText.slice(0, 120)}」`);
rec(
  "提示如实说明用了大模型（不是「演示对话」）",
  /知遇提供的大模型|你接入的模型/.test(toastText),
  /演示对话/.test(toastText) ? "⚠️ 回退成演示对话了" : "正确",
);
/* 匹配度的量级校验放到 ③ 之后 —— 那里才拿得到库里的原始值 */
const shownPct = Number((toastText.match(/综合匹配度\s*(\d+)%/) ?? [])[1] ?? NaN);

/* ── ③ 库里真的落了 AgentSession + 多轮消息 ─────────────────────────── */
console.log("\n== ③ 数据库里真的落了对话 ==");
const afterMatch = await prisma.match.findFirst({
  where: {
    OR: [
      { personaAId: myPersonaId, personaBId: target.id },
      { personaAId: target.id, personaBId: myPersonaId },
    ],
  },
  orderBy: { updatedAt: "desc" },
  include: {
    sessions: { orderBy: { createdAt: "desc" }, take: 1 },
    report: true,
  },
});

rec("库里出现这场 match", Boolean(afterMatch), afterMatch ? `matchId=${afterMatch.id} status=${afterMatch.status}` : "没有 match");
rec("产生了 AgentSession", Boolean(afterMatch?.sessions?.length), afterMatch?.sessions?.[0]?.status ?? "-");

const sessionId = afterMatch?.sessions?.[0]?.id;
const msgs = sessionId
  ? await prisma.agentMessage.findMany({ where: { sessionId }, orderBy: [{ round: "asc" }] })
  : [];
const aMsgs = msgs.filter((m) => m.role === "agent_a");
const bMsgs = msgs.filter((m) => m.role === "agent_b");
rec(
  "落下了多轮 Agent 消息（双方都有）",
  aMsgs.length >= 3 && bMsgs.length >= 3,
  `共 ${msgs.length} 条：A ${aMsgs.length} 轮 / B ${bMsgs.length} 轮`,
);
rec("生成了匹配报告", Boolean(afterMatch?.report), afterMatch?.report ? `库里 overallScore=${afterMatch.report.overallScore}` : "无报告");

/* ⚠️ 分值量级必须对：库里是 0~1，界面是百分数。
   曾经把 0.82 显示成「综合匹配度 1%」（漏了 ×100），这里守住它。 */
const rawScore = afterMatch?.report?.overallScore ?? null;
const expectedPct = rawScore == null ? null : rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
rec(
  "提示里的匹配度与库里一致（不是 0/1 量级错误）",
  Number.isFinite(shownPct) && shownPct >= 0 && shownPct <= 100 && shownPct === expectedPct,
  `界面显示 ${shownPct}%，库里 ${rawScore} → 期望 ${expectedPct}%`,
);
/* mock 路径的理由文案也要在合理量级（曾经会打出「兴趣同频 6000%」） */
const reasonBad = (afterMatch?.report?.result?.reasons ?? []).filter((x) =>
  /\d{4,}%/.test(String(x)),
);
rec(
  "推荐理由里的百分比量级正常（无 4 位以上百分数）",
  reasonBad.length === 0,
  reasonBad.length ? reasonBad.join(" | ") : (afterMatch?.report?.result?.reasons ?? []).slice(0, 2).join(" | ") || "(无理由)",
);

/* 报告里要标明用的是真 LLM 还是 mock */
const reportResult = afterMatch?.report?.result ?? {};
rec(
  "报告记录了本次用的是真模型",
  reportResult.llmSource === "platform" || reportResult.llmSource === "byok",
  `llmSource=${reportResult.llmSource ?? "(未记录)"} demoMode=${reportResult.demoMode ?? "?"}`,
);

/* ── ④ Agent 匹配页能看到 ──────────────────────────────────────────── */
console.log("\n== ④ Agent 匹配页能看到这场对话 ==");
await page.goto(`${BASE}/agent-match`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);
const matchPage = await page.evaluate((name) => {
  const t = document.body.innerText || "";
  return {
    mentionsTarget: t.includes(name),
    hasReport: /匹配报告|综合匹配度|匹配度/.test(t),
    bodyLen: t.length,
  };
}, target.displayName);
rec(
  "Agent 匹配页列出了与目标的对话",
  matchPage.mentionsTarget || matchPage.hasReport,
  `含目标名=${matchPage.mentionsTarget}，含报告字样=${matchPage.hasReport}`,
);
await page.screenshot({ path: path.join(OUT, "agent-match.png"), fullPage: false });

/* ── ⑤ 通知页出现记录 ──────────────────────────────────────────────── */
console.log("\n== ⑤ 通知页出现「Agent 对话已完成」 ==");
const notifs = await prisma.notification.findMany({
  where: { userId: login.userId },
  orderBy: { createdAt: "desc" },
  take: 5,
});
rec(
  "库里新增了 agent_completed 通知（含发起人自己）",
  notifs.some((n) => n.type === "agent_completed"),
  notifs.map((n) => n.type).join(", ") || "(无)",
);

await page.goto(`${BASE}/notify`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);
const notifyPage = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
rec(
  "通知页显示 Agent 对话完成",
  /Agent 对话已完成|对话已完成/.test(notifyPage),
  notifyPage.slice(0, 160),
);

/* ── ⑥ 不重复烧额度 ────────────────────────────────────────────────── */
console.log("\n== ⑥ 同一对人不会重复消耗额度 ==");
const sessionsBefore = await prisma.agentSession.count({ where: { matchId: afterMatch?.id } });
const secondCall = await page.evaluate(async (tid) => {
  const r = await fetch("/api/agent/meet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPersonaId: tid }),
  });
  return { status: r.status, body: await r.json() };
}, target.id);
const sessionsAfter = await prisma.agentSession.count({ where: { matchId: afterMatch?.id } });
rec(
  "第二次点同一人返回 alreadyDone（不再跑一遍）",
  secondCall.body?.alreadyDone === true,
  JSON.stringify(secondCall.body).slice(0, 160),
);
rec(
  "没有新增 AgentSession（额度没被重复消耗）",
  sessionsAfter === sessionsBefore,
  `${sessionsBefore} → ${sessionsAfter}`,
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
await prisma.$disconnect();
process.exit(fail ? 1 : 0);
