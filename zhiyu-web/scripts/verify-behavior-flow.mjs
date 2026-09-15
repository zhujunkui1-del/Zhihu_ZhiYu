#!/usr/bin/env node
/**
 * 端到端验证：**导入 → 行为变量落库 → 人格页雷达改用行为轴**。
 *
 * 为什么必须单独跑这一条：`behavior.ts` 的纯函数测试（test-behavior.mjs）已经
 * 覆盖了算法，但从没人验证过"导入接口真的把行为变量算出来并落库、页面真的画出来"。
 * 这条链路跨了 解析器 → 接口 → Prisma → persona-view → React，任何一环断了
 * 用户看到的还是空卡片。
 *
 * ⚠️ 用的是**合成数据**（不是你的私人聊天），并且会在结束时精确删掉自己写进去的行。
 *
 * 用法：node scripts/verify-behavior-flow.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const MARK = "行为链路自测"; // 写进去的每一行都带这个前缀，便于精确清理

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/* ── ① 合成一份 WeFlow 形态的微信导出（90 天、两方、带时间与方向） ─────── */
const T0 = 1_735_689_600; // 2025-01-01 00:00 (UTC+8)
const messages = [];
let id = 1;
for (let d = 0; d < 90; d += 1) {
  if (d % 7 === 3) continue; // 留几天不聊，"活跃天占比"才有意义
  const perDay = 4 + (d % 5) * 3;
  for (let k = 0; k < perDay; k += 1) {
    const at = T0 + d * 86400 + (k < perDay / 2 ? 13 * 3600 : 20 * 3600) + k * 90;
    const mine = k % 2 === 0; // 每天由我开场（主动发起率应偏高）
    messages.push({
      localId: id,
      createTime: at,
      formattedTime: new Date((at + 8 * 3600) * 1000).toISOString().slice(0, 19).replace("T", " "),
      type: "文本消息",
      localType: 1,
      content: `${MARK}${mine ? "我" : "对方"}第${d}天第${k}条：${["今天这个方案的取舍值得再讨论","我在读一本书讲系统思维","周末想去爬山，顺便吃东西","这个功能的设计我认为可以更简单"][k % 4]}`,
      isSend: mine ? 1 : 0,
      senderUsername: mine ? "wxid_me" : "wxid_peer",
      senderDisplayName: mine ? "我" : "对方",
      source: "",
      senderAvatarKey: "",
      platformMessageId: String(900000 + id),
    });
    id += 1;
  }
}
const payload = {
  weflow: { version: "1.0.3" },
  session: { displayName: "自测对象", type: "private" },
  messages,
  avatars: {},
};
const tmp = path.resolve("../RECON/behavior-selftest.json");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const demo = await page.evaluate(async () => {
    const r = await fetch("/api/auth/demo", { method: "POST" });
    return { status: r.status, body: await r.text() };
  });
  rec("本地演示登录可用（端到端前置）", demo.status === 200, `HTTP ${demo.status}`);
  const personaId = JSON.parse(demo.body).personaId;

  /* ── ② 通过真实接口导入（append，避免动到演示数据） ─────────────────── */
  const before = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/persona/${pid}`).then((x) => x.json());
    const b = r.persona ?? r;
    return {
      behavior: b.behavior?.bySource?.map((f) => f.source) ?? null,
      axes: b.axes?.length ?? 0,
    };
  }, personaId);
  console.log(`      导入前：behavior 源=${JSON.stringify(before.behavior)} 轴数=${before.axes}`);

  const uploaded = await page.evaluate(
    async ({ text, name }) => {
      /* ⚠️ source / mode 都在 **form 字段**里，不是 query 参数
         （route.ts:121 读的是 form.get("source")）—— 写成 query 会拿到
         "不支持的数据源：（空）"，实测踩过。 */
      const fd = new FormData();
      fd.append("source", "wechat");
      fd.append("mode", "append");
      fd.append("file", new File([text], name, { type: "application/json" }));
      const r = await fetch("/api/import", { method: "POST", body: fd });
      const t = await r.text();
      let j = null;
      try {
        j = JSON.parse(t);
      } catch {
        /* 下面按原始文本回报 */
      }
      return { status: r.status, ok: j?.ok ?? false, written: j?.written ?? j?.evidenceWritten ?? null, warnings: j?.warnings ?? [], raw: t.slice(0, 200) };
    },
    { text: JSON.stringify(payload), name: "行为链路自测.json" },
  );
  rec("导入接口 200", uploaded.status === 200, `HTTP ${uploaded.status} ${uploaded.ok ? "" : uploaded.raw}`);
  if (uploaded.status !== 200) {
    console.log(`      导入失败，后续断言无意义：${uploaded.raw}`);
  }

  /* ── ③ 页面上真的画出来了吗（从渲染结果读，不读接口） ─────────────────
     ⚠️ 不能从 `/api/persona/:id` 读行为变量：那是**人格卡弹窗**用的精简结构，
     不含 behavior/fused（页面走的是服务端 buildPersonaBoard）。所以这里直接
     看渲染出来的 DOM —— 反正用户看到的也是它。 */
  await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  const ui = await page.evaluate(() => {
    const card = document.querySelector('[data-facet-source="wechat"]');
    const rows = [...(card?.querySelectorAll('[class*="dimRow"]') ?? [])].map((r) => ({
      label: r.querySelector('[class*="dimLabel"]')?.textContent?.trim() ?? "",
      pct: r.querySelector('[class*="dimVal"]')?.textContent?.trim() ?? "",
    }));
    return {
      hasBehaviorCard: document.querySelectorAll("[data-facet-behavior]").length > 0,
      rows,
      cardText: (card?.textContent ?? "").replace(/\s+/g, " ").slice(0, 240),
      axisLabels: [...document.querySelectorAll('[class*="axisLabel"]')].map((x) => x.textContent?.trim()),
      axisVals: [...document.querySelectorAll('[class*="axisVal"]')].map((x) => x.textContent?.trim()),
      hasFactText: /互动平衡|单段消息数|最长连续交流/.test(document.body.innerText),
      zeroOrFull: /(^|[^\d])(0|100)%/.test(document.body.innerText),
    };
  });

  rec("分源卡里出现了行为变量", ui.hasBehaviorCard, ui.cardText);
  const labels = ui.rows.map((r) => r.label);
  for (const need of ["主动发起率", "回应速度", "活跃天占比", "深夜活跃", "表达丰富度"]) {
    rec(`卡片里画出了「${need}」`, labels.includes(need), labels.join("/"));
  }
  const pcts = ui.rows
    .map((r) => String(r.pct))
    .filter((s) => /^(\d+)%$/.test(s))
    .map((s) => Number(s.replace("%", "")));
  rec(
    "行为变量至少有 5 条",
    ui.rows.length >= 5,
    `${ui.rows.length} 条：${ui.rows.map((r) => r.label + r.pct).join(" ")}`,
  );
  rec(
    "**没有任何一条是 0% / 100%**（贴边的写「<1%」「>99%」）",
    ui.rows.length > 0 && !ui.rows.some((r) => /^(0|100)%$/.test(String(r.pct))),
    ui.rows.map((r) => r.pct).join(" "),
  );
  rec(
    "主动发起率明显偏高（合成数据里我每天开场）",
    Number(String(ui.rows.find((r) => r.label === "主动发起率")?.pct ?? "").replace("%", "")) > 60,
    ui.rows.find((r) => r.label === "主动发起率")?.pct ?? "",
  );
  rec("事实行（互动平衡/单段消息数/最长连续交流）也画出来了", ui.hasFactText);
  rec("雷达轴标签是行为变量", ui.axisLabels.includes("主动发起率") && ui.axisLabels.includes("回应速度"), ui.axisLabels.join("/"));
  rec(
    "雷达轴上的值也都不是 0% / 100%",
    ui.axisVals.filter((v) => v && v !== "—").every((v) => !/^(0|100)%$/.test(v)),
    ui.axisVals.join(" "),
  );
  rec("整页没有 0% / 100%", !ui.zeroOrFull, ui.zeroOrFull ? "页面上存在 0% 或 100%" : "无");

  /* ── ⑤ 清理：只删本次写进去的行（按 MARK 前缀精确匹配） ───────────────
     清理放在这个进程里用 Prisma 做，而不是加一个"自测清理"接口 ——
     生产代码里不该有测试专用的写接口。 */
  const { prisma } = await import("../lib/db.ts");
  const delEv = await prisma.personaEvidence.deleteMany({
    where: { personaId, source: "wechat", note: { startsWith: MARK } },
  });
  const delBe = await prisma.personaFeature.deleteMany({
    where: { personaId, key: "behavior:wechat" },
  });
  rec(
    "自测写入的数据已精确清理",
    delEv.count > 0,
    `删除证据 ${delEv.count} 条、行为变量 ${delBe.count} 份`,
  );
  const left = await prisma.personaEvidence.count({
    where: { personaId, note: { startsWith: MARK } },
  });
  rec("确认没有残留", left === 0, `残留 ${left} 条`);
  await prisma.$disconnect();
} catch (e) {
  fail += 1;
  console.log(`  [FAIL] 抛出异常：${e?.stack ?? e}`);
} finally {
  await browser.close();
}

console.log(`\n  行为链路端到端：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
