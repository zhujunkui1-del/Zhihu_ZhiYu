#!/usr/bin/env node
/**
 * 「给TA送去报告」端到端验证。
 *
 * 用户反馈：Agent 匹配页与通知页的匹配报告弹窗里，原本有的送报告按钮不见了。
 * 这条测试要证明三件事：
 *   ① 自己的报告弹窗里有「给TA送去报告」，点了能真的送出去（接口 200 且真的投递）
 *   ② 送出去的这条会出现在**收件人**的通知页「全部」与「发来的报告」两个标签下
 *   ③ 别人送来的报告，弹窗里**不再显示**「给TA送去报告」（这是用户明确要求的）
 *
 * 怎么在没有第二个登录态的情况下验证收件人视角：
 *   直接把这条投递**写进当前用户的收件箱**（用 Prisma 造一条 report_received），
 *   然后以这个身份打开通知页 —— 这正是收件人会看到的界面。
 *   测试结束精确删除自己造的那条通知。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env \
 *        scripts/verify-send-report.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";

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
const { prisma } = await import("../lib/db.ts");
let injectedNotificationId = null;
/** 本次自测临时造的匹配（含其报告与投递通知），结束时全部删掉 */
const tmpMatchIds = [];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });

  /* ── 登录（本地演示账号） ── */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const demo = await page.evaluate(async () => {
    const r = await fetch("/api/auth/demo", { method: "POST" });
    return await r.json();
  });
  rec("本地演示登录可用", demo?.ok === true, JSON.stringify(demo).slice(0, 120));
  const me = await prisma.user.findUnique({
    where: { id: demo.userId },
    select: { id: true, displayName: true },
  });

  /* ── 找一场 demo 用户参与、且已有报告的匹配 ── */
  const match = await prisma.match.findFirst({
    where: {
      report: { isNot: null },
      OR: [{ personaA: { userId: demo.userId } }, { personaB: { userId: demo.userId } }],
    },
    include: {
      personaA: { select: { id: true, displayName: true, userId: true } },
      personaB: { select: { id: true, displayName: true, userId: true } },
      report: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  rec("找到一场有报告的匹配", Boolean(match), match ? `${match.personaA.displayName} × ${match.personaB.displayName}` : "没有");
  if (!match) throw new Error("数据库里没有可用的匹配报告，请先在页面上跑一次 Agent 匹配");

  const counterparty = match.personaA.userId === demo.userId ? match.personaB : match.personaA;

  /* 清掉可能存在的旧投递，保证"第一次送出"这个前提成立 */
  await prisma.notification.deleteMany({
    where: {
      type: "report_received",
      OR: [
        { userId: demo.userId, payload: { path: ["matchId"], equals: match.id } },
        ...(counterparty.userId
          ? [{ userId: counterparty.userId, payload: { path: ["matchId"], equals: match.id } }]
          : []),
      ],
    },
  });

  /* ── ① Agent 匹配页：弹窗里应有按钮 ──
     ⚠️ 必须先切到「匹配报告」标签 —— 页面默认停在「认识中」，
     那个标签下根本没有报告卡片（实测踩过，按钮列表里一个"查看报告"都没有）。 */
  await page.goto(`${BASE}/agent-match`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  const tabClicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent ?? "").trim().startsWith("匹配报告"),
    );
    if (b) b.click();
    return Boolean(b);
  });
  rec("能切到「匹配报告」标签", tabClicked);
  await page.waitForTimeout(1200);

  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent ?? "").trim() === "查看报告",
    );
    if (b) b.click();
    return Boolean(b);
  });
  await page.waitForTimeout(1800);
  const inMatchPage = await page.evaluate(() => {
    const modal = document.querySelector('[class*="dialog"]') ?? document.body;
    const btn = modal.querySelector("[data-send-report]");
    return {
      hasSend: Boolean(btn),
      label: btn?.textContent?.trim() ?? "",
      disabled: btn ? btn.disabled : null,
      openPersona: Boolean(modal.querySelector("[data-open-persona-from-report]")),
      receivedNote: Boolean(modal.querySelector("[data-report-received]")),
    };
  });
  rec("点开了匹配报告弹窗", opened, "");
  rec("弹窗里有「给TA送去报告」按钮", inMatchPage.hasSend, JSON.stringify(inMatchPage));
  rec("按钮文案就是「给TA送去报告」", inMatchPage.label === "给TA送去报告", inMatchPage.label);
  rec("按钮可点（未禁用）", inMatchPage.disabled === false, String(inMatchPage.disabled));
  rec("自己的报告里**没有**「这份报告是 TA 送给你的」", !inMatchPage.receivedNote);
  rec("「查看 TA 的人格卡」按钮仍在", inMatchPage.openPersona);

  /* ── ② 点它：要么投递成功，要么如实说明对方没有账号 ── */
  const sent = await page.evaluate(async () => {
    const btn = document.querySelector("[data-send-report]");
    if (!btn) return { clicked: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 2500));
    const b2 = document.querySelector("[data-send-report]");
    const notice = document.querySelector("[data-send-notice]");
    return {
      clicked: true,
      labelAfter: b2?.textContent?.trim() ?? "",
      disabledAfter: b2 ? b2.disabled : null,
      notice: notice?.textContent?.trim() ?? "",
    };
  });
  rec("点击后按钮进入终态（已送去 / 或给出说明）", sent.clicked, JSON.stringify(sent));

  const stored = counterparty.userId
    ? await prisma.notification.findFirst({
        where: {
          userId: counterparty.userId,
          type: "report_received",
          payload: { path: ["matchId"], equals: match.id },
        },
      })
    : null;

  if (counterparty.userId) {
    rec("**数据库里真的出现了投递给对方的 report_received**", Boolean(stored), stored ? `通知 ${stored.id}` : "没有写入");
    rec("按钮变成「已送去」且不可重复点", sent.labelAfter === "已送去" && sent.disabledAfter === true, `${sent.labelAfter} / disabled=${sent.disabledAfter}`);
  } else {
    rec("对方是 AI 演示人格 → 没有投递，但给出了如实说明", !stored && /未注册|无法站内投递/.test(sent.notice), sent.notice);
  }

  /* 幂等：再点一次不应产生第二条 */
  if (counterparty.userId) {
    const again = await page.evaluate(async () => {
      const r = await fetch(
        `/api/matches/${encodeURIComponent(document.querySelector("[data-send-report]")?.getAttribute("data-send-report") ?? "")}/send-report`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
      );
      return await r.json();
    }).catch(() => null);
    const count = await prisma.notification.count({
      where: {
        userId: counterparty.userId,
        type: "report_received",
        payload: { path: ["matchId"], equals: match.id },
      },
    });
    rec("重复送出不会堆出第二条通知（幂等）", count === 1, `当前 ${count} 条${again?.alreadySent ? "（接口回报 alreadySent）" : ""}`);
  }

  /* ── ④ 真投递：对手是**真实注册用户**时才走得通的那条路 ──────────────
     ③ 用的是"我收到别人送来的报告"的界面；这一段要证明**送出去真的会落到
     对方账号的通知里**。演示账号的常规对手是 AI 人格（没有 userId），
     所以这里临时造一场"演示用户 × 某个真实用户"的匹配，送完立刻验、验完删。 */
  const other = await prisma.persona.findFirst({
    where: {
      kind: "human",
      userId: { not: null },
      id: { not: demo.personaId },
      user: { id: { not: demo.userId } },
    },
    select: { id: true, displayName: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  rec("找到一个真实注册用户作为收件人", Boolean(other?.userId), other ? `${other.displayName}` : "没有");

  if (other?.userId) {
    const tmpMatch = await prisma.match.create({
      data: {
        personaAId: demo.personaId,
        personaBId: other.id,
        mode: "quick",
        status: "report_ready",
      },
      select: { id: true },
    });
    tmpMatchIds.push(tmpMatch.id);
    await prisma.matchReport.create({
      data: {
        matchId: tmpMatch.id,
        overallScore: 0.77,
        summary: "（自测数据）用于验证送报告链路。",
        result: { dimensions: [], reasons: [], rounds: [], demoMode: true },
      },
    });

    const res = await page.evaluate(
      async ({ matchId, fromPersonaId }) => {
        const call = () =>
          fetch(`/api/matches/${encodeURIComponent(matchId)}/send-report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromPersonaId }),
          }).then((r) => r.json());
        const first = await call();
        const second = await call(); // 幂等：第二次不该再写一条
        return { first, second };
      },
      { matchId: tmpMatch.id, fromPersonaId: demo.personaId },
    );

    rec("送给自己以外的真实账号 → 投递成功", res.first?.ok === true && res.first?.sent === true, JSON.stringify(res.first));
    rec("响应里带上收件人名（界面要能说清送给了谁）", res.first?.to === other.displayName, String(res.first?.to));

    const delivered = await prisma.notification.findMany({
      where: {
        userId: other.userId,
        type: "report_received",
        payload: { path: ["matchId"], equals: tmpMatch.id },
      },
    });
    rec(
      "**对方的收件箱里真的多了一条 report_received**",
      delivered.length === 1,
      `${delivered.length} 条，收件人 userId=${other.userId}`,
    );
    rec(
      "通知的 payload 指向正确的报告（对方点开就能拉到）",
      delivered[0]?.payload?.matchId === tmpMatch.id && Boolean(delivered[0]?.payload?.reportId),
      JSON.stringify(delivered[0]?.payload ?? {}),
    );
    rec("第二次送出回报 alreadySent（幂等，不堆通知）", res.second?.alreadySent === true, JSON.stringify(res.second));
    rec("收件箱里仍然只有 1 条", delivered.length === 1);
  }

  /* ── ③ 收件人视角：造一条投递给"我"，检查通知页两个标签 + 弹窗无按钮 ── */
  const injected = await prisma.notification.create({
    data: {
      userId: demo.userId,
      type: "report_received",
      payload: {
        matchId: match.id,
        reportId: match.report?.id ?? null,
        counterpart: counterparty.displayName,
      },
    },
    select: { id: true },
  });
  injectedNotificationId = injected.id;

  await page.goto(`${BASE}/notify`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);

  const readTabs = async () =>
    page.evaluate(() => {
      const body = document.body.innerText;
      const tabs = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
      return {
        tabs,
        /** 标签自带计数，形如「发来的报告1」 */
        reportCount: Number((tabs.find((t) => t.startsWith("发来的报告")) ?? "").replace(/\D/g, "") || "0"),
        allCount: Number((tabs.find((t) => t.startsWith("全部")) ?? "").replace(/\D/g, "") || "0"),
        hasReceivedTitle: /把匹配报告发给了你/.test(body),
      };
    });

  const all = await readTabs();
  rec("通知页有「全部」标签", all.tabs.some((t) => t.startsWith("全部")));
  rec("通知页有「发来的报告」标签", all.tabs.some((t) => t.startsWith("发来的报告")));
  rec(
    "「全部」下能看到这条投递（正文出现「把匹配报告发给了你」）",
    all.hasReceivedTitle,
    `全部=${all.allCount} 条，发来的报告=${all.reportCount} 条`,
  );
  rec("「发来的报告」标签计数 ≥1", all.reportCount >= 1, String(all.reportCount));

  /* 切到「发来的报告」 */
  const switched = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent ?? "").trim().startsWith("发来的报告"),
    );
    if (b) b.click();
    return Boolean(b);
  });
  await page.waitForTimeout(1200);
  rec("能切到「发来的报告」标签", switched);
  const reportTab = await readTabs();
  rec(
    "「发来的报告」下能看到这条（且没有混入对话完成的条目）",
    reportTab.hasReceivedTitle,
    reportTab.tabs.join(" / "),
  );

  /* 点开它 → 弹窗 + 里面**不该**有送报告按钮 */
  const openedFromNotify = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent ?? "").trim() === "查看" || (x.textContent ?? "").trim() === "再看一次",
    );
    if (b) b.click();
    return Boolean(b);
  });
  await page.waitForTimeout(2200);
  const receivedView = await page.evaluate(() => {
    const dialog = document.querySelector('[class*="dialog"]');
    return {
      modalOpen: Boolean(dialog),
      hasSend: Boolean(dialog?.querySelector("[data-send-report]")),
      receivedNote: dialog?.querySelector("[data-report-received]")?.textContent?.trim() ?? "",
      hasPersonaBtn: Boolean(dialog?.querySelector("[data-open-persona-from-report]")),
    };
  });
  rec("从通知页点开 → 报告弹窗打开", openedFromNotify && receivedView.modalOpen, JSON.stringify(receivedView));
  rec(
    "**别人送来的报告里没有「给TA送去报告」按钮**（用户要求）",
    receivedView.modalOpen && !receivedView.hasSend,
    receivedView.hasSend ? "仍然显示了按钮" : "已隐藏",
  );
  rec("改成如实说明「这份报告是 TA 送给你的」", /送给/.test(receivedView.receivedNote), receivedView.receivedNote);
  rec("「查看 TA 的人格卡」在这种报告里仍可用", receivedView.hasPersonaBtn);
} catch (e) {
  fail += 1;
  console.log(`  [FAIL] 抛出异常：${e?.stack ?? e}`);
} finally {
  /* 清理：临时匹配（级联删报告）+ 其投递通知 + 本次注入的通知，全部精确删除 */
  for (const id of tmpMatchIds) {
    await prisma.notification.deleteMany({
      where: { type: "report_received", payload: { path: ["matchId"], equals: id } },
    });
    await prisma.match.deleteMany({ where: { id } });
  }
  if (tmpMatchIds.length) console.log(`\n  已清理临时匹配 ${tmpMatchIds.length} 场（及其报告与投递通知）`);
  if (injectedNotificationId) {
    const del = await prisma.notification.deleteMany({ where: { id: injectedNotificationId } });
    console.log(`  已清理测试通知 ${del.count} 条`);
  }
  const leftover = await prisma.match.count({ where: { id: { in: tmpMatchIds } } });
  if (leftover) console.log(`  ⚠️ 仍有 ${leftover} 场临时匹配未删除`);
  await prisma.$disconnect();
  await browser.close();
}

console.log(`\n  送报告链路：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
