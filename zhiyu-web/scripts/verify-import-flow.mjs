#!/usr/bin/env node
/**
 * 「接入数据 → 手动导入」端到端验证。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「我的人格页面的接入数据一栏，微信、QQ、飞书、钉钉的导入数据按键点击后
 *     无交互。马上补齐功能。……点击按钮后要能跳出用户的电脑窗口，然后让用户
 *     把 json、txt 等文件格式的产品支持的可以用于蒸馏的文件数据导入到网站上。」
 *
 * 这里逐条把它钉住（真浏览器、真上传、真落库）：
 *   ① 四个源的按钮**不是 disabled**，且**真的会触发系统文件选择窗口**
 *      —— 通过拦截 `HTMLInputElement.prototype.click` 证明原生选择器被调起
 *   ② 选文件 → 解析 → 落库 → 结果如实展示（读了多少条、识别到谁、跳过什么）
 *   ③ 导入后：源状态变「已注入」、分源解析出现该源、完整度提升
 *   ④ 重新导入是**替换**而不是累加（证据条数不翻倍）
 *   ⑤ 钉钉走 distilly 采集产物的格式（docs.txt）也能导入
 *   ⑥ 分源解析里不出现 0% / 100%（产品硬要求）
 *   ⑦ 非本人视角按钮禁用（不能往别人的人格导数据）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env scripts/verify-import-flow.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-import");
fs.mkdirSync(OUT, { recursive: true });

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/* ── 样例文件（内容形态与实际导出一致）──────────────────────────────── */

const WECHAT_JSON = JSON.stringify({
  messages: [
    {
      talker: "演示用户",
      content:
        "这个方案我建议先把风险列出来再决定要不要推进：一是数据合规边界，二是上线节奏会不会挤压别的排期，三是出错怎么回滚。",
      createTime: "2024-01-01 10:00:00",
    },
    { talker: "小李", content: "行 我今天整理一下", createTime: "2024-01-01 10:01:00" },
    { talker: "演示用户", content: "[图片]", createTime: "2024-01-01 10:02:00" },
    { talker: "演示用户", content: "我最近在读技术伦理相关的书，也在写长文，想把想法系统化", createTime: "2024-01-01 10:05:00" },
    { talker: "演示用户", content: "先做小范围灰度，出问题也好回滚", createTime: "2024-01-01 10:06:00" },
  ],
});

const QQ_TXT = [
  "2024-03-05 21:00:00 演示用户",
  "我最近在折腾一个开源项目，主要是想把聊天记录做成可检索的知识库，顺便练手",
  "2024-03-05 21:01:12 小美",
  "哇 好厉害",
  "2024-03-05 21:02:00 演示用户",
  "难点其实在隐私边界：本地解析和上传云端是两种完全不同的承诺，我倾向于把选择权交回用户",
].join("\n");

/* distilly `dingtalk_auto_collector.py` 的真实产物形态 */
const DINGTALK_DOCS = [
  "# 文档内容（钉钉自动采集）",
  "",
  "目标：演示用户",
  "",
  "---",
  "",
  "## 《Q3 技术规划》",
  "",
  "本季度重点是稳定性治理：先把告警收敛做掉，再谈新功能。",
  "",
  "## 《复盘：一次线上事故》",
  "",
  "根因不是代码，是发布流程缺少灰度环节，这条要写进流程文档。",
].join("\n");

const FEISHU_JSON = JSON.stringify({
  code: 0,
  data: {
    messages: [
      {
        sender_name: "演示用户",
        content: { text: "这个季度的目标我建议拆成两条线：一条保交付，一条做技术债清理，不然永远在救火" },
        timestamp: "1710000000",
      },
      { sender_name: "同事A", content: { text: "同意" }, timestamp: "1710000060" },
    ],
  },
});

/* ── 浏览器 ───────────────────────────────────────────────────────────── */

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});

/**
 * 往隐藏的 file input 塞一个真 File 并触发 change（等价于用户选完文件）。
 *
 * ⚠️ 文件信息要在 dispatch **之前**读：弹窗的 onChange 里会 `e.target.value = ""`
 * （为了允许"再选同一个文件"也能触发 change），那一行会立刻清空 `input.files`，
 * 之后再读就是空数组（实测踩过）。
 */
const attachFile = (selector, name, text, mime = "application/json") =>
  page.evaluate(
    ({ sel, n, t, m }) => {
      const input = document.querySelector(sel);
      if (!input) return { ok: false, error: "找不到 input" };
      const dt = new DataTransfer();
      dt.items.add(new File([t], n, { type: m }));
      input.files = dt.files;
      const picked = { name: input.files[0]?.name, size: input.files[0]?.size };
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, ...picked };
    },
    { sel: selector, n: name, t: text, m: mime },
  );

const clickSel = (sel) =>
  page.evaluate((s) => {
    const b = document.querySelector(s);
    if (!b) return false;
    b.click();
    return true;
  }, sel);

const waitFor = async (fn, ms = 20000, step = 400) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(step);
  }
  return false;
};

/** 打开「我的人格」的接入数据页 */
const gotoSources = async () => {
  await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.trim().includes("注入数据"),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(900);
  return ok;
};

/* 登录（演示用户） */
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST" });
});
await page.waitForTimeout(600);

const me = await prisma.user.findFirst({
  where: { username: "demo" },
  select: { id: true, persona: { select: { id: true } } },
});
const personaId = me?.persona?.id;
rec("拿到演示用户的 persona", Boolean(personaId), `${personaId}`);

const evidenceCount = (source) =>
  prisma.personaEvidence.count({ where: { personaId, source } });

/* ───────── ① 四个按钮真的能点，且会调起系统文件窗口 ───────── */
console.log("\n== ① 四个源的导入按钮：可点 + 真的调起系统文件选择窗口 ==");
await gotoSources();

const btnState = await page.evaluate(() =>
  ["wechat", "qq", "feishu", "dingtalk"].map((s) => {
    const b = document.querySelector(`[data-open-import="${s}"]`);
    return { s, exists: Boolean(b), disabled: b ? b.disabled : null, text: b?.textContent?.trim() ?? "" };
  }),
);
for (const b of btnState) {
  rec(`${b.s} 按钮存在且**不是** disabled`, b.exists && b.disabled === false, `「${b.text}」`);
}

/* 拦截 input.click，证明"跳出电脑窗口"的那一步真的发生了 */
const dialogProbe = await page.evaluate(() => {
  window.__pickerCalls = 0;
  const orig = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function patched(...args) {
    if (this.type === "file") window.__pickerCalls += 1;
    return orig.apply(this, args);
  };
  return true;
});
rec("已装载文件选择器探针", dialogProbe === true);

const opened = await clickSel('[data-open-import="wechat"]');
await page.waitForTimeout(600);
const dlg = await page.evaluate(() => {
  const d = document.querySelector("[data-import-dialog]");
  return {
    exists: Boolean(d),
    source: d?.getAttribute("data-import-dialog") ?? "",
    pickerCalls: window.__pickerCalls ?? 0,
    hasInput: Boolean(document.querySelector('[data-import-input="1"]')),
    title: document.querySelector("[data-import-title]")?.textContent?.trim() ?? "",
  };
});
rec("点按钮弹出了导入弹窗", opened && dlg.exists, `source=${dlg.source}｜标题「${dlg.title}」`);
rec(
  "⚠️ 弹窗打开即调起**原生文件选择器**（需求：跳出用户的电脑窗口）",
  dlg.pickerCalls >= 1 && dlg.hasInput,
  `type=file 的 click() 被调用 ${dlg.pickerCalls} 次`,
);
await page.screenshot({ path: path.join(OUT, "01-dialog-wechat.png") });

/* ───────── ② 微信 JSON：导入 → 落库 → 结果如实展示 ───────── */
console.log("\n== ② 微信 JSON 导入 ==");
const before = await evidenceCount("wechat");
const attach = await attachFile('[data-import-input="1"]', "wechat-chat.json", WECHAT_JSON);
rec("文件已塞入 input", attach.ok && attach.name === "wechat-chat.json", `${attach.name} ${attach.size}B`);

await page.evaluate(() => {
  const i = document.querySelector('[data-import-selfname="1"]');
  if (i) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(i, "演示用户");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await clickSel('[data-import-submit="1"]');

const gotResult = await waitFor(
  () => Boolean(document.querySelector('[data-import-result="ok"]')),
  30000,
);
rec("导入返回成功并展示结果", gotResult);
await page.screenshot({ path: path.join(OUT, "02-import-wechat-ok.png") });

const result = await page.evaluate(() => {
  const box = document.querySelector('[data-import-result="ok"]');
  return {
    text: box?.textContent ?? "",
    dims: [...(box?.querySelectorAll(".num") ?? [])].map((e) => e.textContent.trim()),
  };
});
rec(
  "结果里写明了读到多少条 / 写入多少证据",
  /读到\s*\d+\s*条原始内容/.test(result.text) && /写入证据/.test(result.text),
  result.text.slice(0, 150),
);
rec(
  "结果里列出了文件中的发言者（能发现昵称填错）",
  result.text.includes("发言者") && result.text.includes("小李"),
);
rec("结果里展示了该源解析出的维度", result.dims.length >= 3, result.dims.join(" "));
rec(
  "维度百分比不出现 0% / 100%",
  result.dims.every((d) => d !== "0%" && d !== "100%"),
  result.dims.join(" "),
);

const after = await evidenceCount("wechat");
/* 断言写成"等于本次解析出的条数"，而不是"比上次多" —— 重新导入是替换语义，
   而且这个套件可以在同一个库上反复跑（第一次跑之前可能残留别的数据）。 */
rec(
  `证据落库条数与解析结果一致（wechat ${before} → ${after}，本次解析 3 条）`,
  after === 3,
  `${before} → ${after}`,
);
const leaked = await prisma.personaEvidence.count({
  where: { personaId, source: "wechat", note: { contains: "我今天整理一下" } },
});
rec(
  "对方（小李）的消息**没有**写进我的人格",
  leaked === 0,
  `匹配「我今天整理一下」的证据 ${leaked} 条`,
);
const sourceRow = await prisma.personaSource.findFirst({ where: { personaId, type: "wechat" } });
rec("PersonaSource 标记为已注入", sourceRow?.status === "injected", `${sourceRow?.status}`);
rec(
  "源 meta 里留下了文件与解析方式的记录",
  Boolean(
    sourceRow?.meta &&
      Array.isArray(sourceRow.meta.fileNames) &&
      sourceRow.meta.fileNames[0] === "wechat-chat.json",
  ),
  JSON.stringify(sourceRow?.meta ?? {}).slice(0, 150),
);

/* ───────── ③ 页面上的状态跟着变 ───────── */
console.log("\n== ③ 导入后：源状态 / 完整度 / 分源解析都要跟着变 ==");
/* 导入结果区应当**当场**出现（不是一句 alert，也不是刷新后才有） */
const boxNow = await page.evaluate(() => {
  const box = document.querySelector("[data-import-box]");
  return { exists: Boolean(box), text: box?.textContent?.replace(/\s+/g, " ").slice(0, 120) ?? "" };
});
rec(
  "导入结果区当场出现在页面里（不是 alert 一闪而过）",
  boxNow.exists,
  boxNow.text,
);

await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(500);
await gotoSources();

const pageState = await page.evaluate(() => {
  const card = document.querySelector('[data-open-import="wechat"]')?.closest("article");
  return { wechatCard: card?.textContent ?? "" };
});
rec(
  "微信卡片变成「已注入」",
  pageState.wechatCard.includes("已注入"),
  pageState.wechatCard.replace(/\s+/g, " ").slice(0, 90),
);

/* 分源解析块（在「人格卡」页签） */
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    x.textContent.trim().includes("人格卡"),
  );
  b?.click();
});
await page.waitForTimeout(1200);
const facets = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-facet-source]")];
  return cards.map((c) => ({
    source: c.getAttribute("data-facet-source"),
    text: c.textContent ?? "",
  }));
});
rec(
  "分源解析里出现了微信源",
  facets.some((f) => f.source === "wechat"),
  facets.map((f) => f.source).join("、"),
);
const wechatFacet = facets.find((f) => f.source === "wechat");
rec(
  "微信这一卡写明了实际量了什么（平均字数 / 重复率）",
  Boolean(wechatFacet && wechatFacet.text.includes("重复率")),
  wechatFacet?.text.replace(/\s+/g, " ").slice(0, 150),
);
rec(
  "微信这一卡如实说明缺了哪两维及原因",
  Boolean(wechatFacet && wechatFacet.text.includes("未覆盖") && wechatFacet.text.includes("学习成长")),
  wechatFacet?.text.replace(/\s+/g, " ").match(/未覆盖[^）]*）/)?.[0] ?? "(没找到未覆盖说明)",
);

/* 页面上的所有百分比都不许是 0% / 100% */
const badPcts = await page.evaluate(() => {
  const txt = document.body.innerText;
  return (txt.match(/\d+%/g) ?? []).filter((x) => x === "0%" || x === "100%");
});
rec("整页不出现 0% / 100%", badPcts.length === 0, badPcts.join(" ") || "无");
await page.screenshot({ path: path.join(OUT, "03-facets-after-wechat.png"), fullPage: false });

/* ───────── ④ 重新导入是替换，不是累加 ───────── */
console.log("\n== ④ 重新导入应**替换**该源旧证据（文件才是事实来源）==");
const beforeRe = await evidenceCount("wechat");
await gotoSources();
await clickSel('[data-open-import="wechat"]');
await page.waitForTimeout(500);
await attachFile('[data-import-input="1"]', "wechat-chat.json", WECHAT_JSON);
/* 这次**也填昵称**，两次导入的解析结果应当完全一致 —— 只有这样才能验证"替换" */
await page.evaluate(() => {
  const i = document.querySelector('[data-import-selfname="1"]');
  if (i) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(i, "演示用户");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await clickSel('[data-import-submit="1"]');
await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 30000);
const afterRe = await evidenceCount("wechat");
rec(
  "同样的文件导入两次，证据条数**完全相同**（替换而非累加）",
  afterRe === beforeRe && afterRe === 3,
  `${beforeRe} → ${afterRe}（若累加会是 6）`,
);

/* ───────── ⑤ 钉钉：distilly 采集产物 ───────── */
console.log("\n== ⑤ 钉钉：直接导入 distilly 采集脚本的 docs.txt ==");
await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();
await clickSel('[data-open-import="dingtalk"]');
await page.waitForTimeout(500);
const dtAttach = await attachFile('[data-import-input="1"]', "docs.txt", DINGTALK_DOCS, "text/plain");
rec("塞入 docs.txt", dtAttach.ok, `${dtAttach.name}`);
await clickSel('[data-import-submit="1"]');
const dtOk = await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 30000);
rec("钉钉 docs.txt 导入成功", dtOk);
const dtResult = await page.evaluate(
  () => document.querySelector('[data-import-result="ok"]')?.textContent ?? "",
);
rec(
  "两段文档都被读成内容（不是 0 条）",
  /其中\s*2\s*条可用于蒸馏/.test(dtResult) || /读到\s*3\s*条/.test(dtResult),
  dtResult.slice(0, 130),
);
await page.screenshot({ path: path.join(OUT, "04-import-dingtalk.png") });
const dtRows = await evidenceCount("dingtalk");
rec("钉钉证据落库", dtRows >= 2, `${dtRows} 条`);
const dtFacet = await prisma.personaFeature.findFirst({
  where: { personaId, key: "facets:dingtalk" },
});
rec("钉钉的分源解析也写了库", Boolean(dtFacet), `${dtFacet?.key ?? "无"}`);

/* ───────── ⑥ 飞书 JSON + QQ TXT ───────── */
console.log("\n== ⑥ 飞书 JSON 与 QQ TXT ==");
await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();
await clickSel('[data-open-import="feishu"]');
await page.waitForTimeout(500);
await attachFile('[data-import-input="1"]', "feishu.json", FEISHU_JSON);
await clickSel('[data-import-submit="1"]');
rec("飞书 JSON 导入成功", await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 30000));
rec("飞书证据落库", (await evidenceCount("feishu")) >= 1, `${await evidenceCount("feishu")} 条`);

await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();
await clickSel('[data-open-import="qq"]');
await page.waitForTimeout(500);
await attachFile('[data-import-input="1"]', "qq.txt", QQ_TXT, "text/plain");
await page.evaluate(() => {
  const i = document.querySelector('[data-import-selfname="1"]');
  if (i) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(i, "演示用户");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await clickSel('[data-import-submit="1"]');
rec("QQ TXT 导入成功", await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 30000));
const qqRows = await evidenceCount("qq");
rec("QQ 只留下我发的 2 条（跳过对方那条）", qqRows === 2, `${qqRows} 条`);

/* ───────── ⑦ 大文件：真实体量（我们踩过的超时坑）───────── */
console.log("\n== ⑦ 大文件导入（几百条消息 / 200 条证据）==");
/* 这一节是为一个**实际发生过的故障**立的回归：
   逐条 create 200 条证据 = 200 次往返，Neon 在新加坡，累计 30 秒，
   而 Prisma 交互式事务默认 5 秒超时 → 500 且**响应体为空**，
   用户看到的是 "Unexpected end of JSON input"。
   小文件（3 条）永远测不出来，所以这里造一份 400 条消息的文件。 */
const bigMessages = Array.from({ length: 400 }, (_, i) => ({
  localId: i + 1,
  type: "文本消息",
  /* 交替长短，保证既有长消息也有短消息 */
  content:
    i % 3 === 0
      ? `第 ${i} 条：这个方案我建议先把风险列出来再决定要不要推进，一是合规边界，二是排期挤压，三是回滚方案。`
      : `第 ${i} 条：好`,
  isSend: i % 2 === 0 ? 1 : 0,
  senderDisplayName: i % 2 === 0 ? "演示用户" : "对方",
}));
const bigFile = JSON.stringify({
  weflow: { version: "1.0.3", generator: "WeFlow" },
  session: { displayName: "对方", type: "私聊" },
  messages: bigMessages,
});

await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();
await clickSel('[data-open-import="qq"]');
await page.waitForTimeout(500);
const bigAttach = await attachFile('[data-import-input="1"]', "big.json", bigFile);
rec("塞入 400 条消息的文件", bigAttach.ok, `${(bigAttach.size / 1024).toFixed(0)} KB`);

const t0 = Date.now();
await clickSel('[data-import-submit="1"]');
const bigOk = await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 90000);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
rec(`大文件导入成功（用时 ${secs}s，没有事务超时）`, bigOk);

const bigResult = await page.evaluate(
  () => document.querySelector('[data-import-result="ok"]')?.textContent ?? "",
);
rec(
  "没有出现空响应 / JSON 解析错误",
  !bigResult.includes("空响应") && !bigResult.includes("Unexpected end"),
  bigResult.slice(0, 120),
);
const bigRows = await evidenceCount("qq");
rec("200 条证据一次写入（createMany）", bigRows === 200, `${bigRows} 条`);
const bigMine = await page.evaluate(
  () => document.querySelector("[data-import-mine-by]")?.getAttribute("data-import-mine-by"),
);
rec("大文件也按文件自带的 isSend 判断", bigMine === "flag", `${bigMine}`);

/* ───────── ⑧ 多文件：一次选多份，合并成一个源 ───────── */
console.log("\n== ⑧ 一次导入多个文件（用户问过：是覆盖还是追加）==");
const CHAT_A = JSON.stringify({
  session: { displayName: "小李", type: "私聊" },
  messages: [
    { content: "方案我建议先小范围灰度，出问题好回滚", isSend: 1, senderDisplayName: "演示用户", type: "文本消息" },
    { content: "行，那我排一下时间", isSend: 0, senderDisplayName: "小李", type: "文本消息" },
  ],
});
const CHAT_B = JSON.stringify({
  session: { displayName: "老王", type: "私聊" },
  messages: [
    { content: "这个季度的复盘我想按项目拆，而不是按人拆，这样能看出系统性问题", isSend: 1, senderDisplayName: "演示用户", type: "文本消息" },
    { content: "可以啊", isSend: 0, senderDisplayName: "老王", type: "文本消息" },
    { content: "另外技术债那张表我想单独拉一条线跟踪", isSend: 1, senderDisplayName: "演示用户", type: "文本消息" },
  ],
});

await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();
await clickSel('[data-open-import="wechat"]');
await page.waitForTimeout(500);

/* 一次塞两个文件（模拟用户多选/拖入两个） */
const multiAttach = await page.evaluate(
  ({ a, b }) => {
    const input = document.querySelector('[data-import-input="1"]');
    if (!input) return { ok: false };
    if (!input.multiple) return { ok: false, error: "input 没有 multiple 属性" };
    const dt = new DataTransfer();
    dt.items.add(new File([a], "chat-小李.json", { type: "application/json" }));
    dt.items.add(new File([b], "chat-老王.json", { type: "application/json" }));
    input.files = dt.files;
    /* 先读数再 dispatch：onChange 里会清空 input.value（连带 files） */
    const count = input.files.length;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, count };
  },
  { a: CHAT_A, b: CHAT_B },
);
rec("文件选择器支持多选（multiple）", multiAttach.ok && multiAttach.count === 2, JSON.stringify(multiAttach));

await page.waitForTimeout(500);
const listState = await page.evaluate(() => ({
  items: document.querySelectorAll("[data-import-file-item]").length,
  count: document.querySelector("[data-import-file-count]")?.getAttribute("data-import-file-count"),
  note: document.querySelector("[data-import-replace-note]")?.textContent?.trim() ?? "",
}));
rec("两个文件都列出来了", listState.items === 2, `${listState.items} 个（count=${listState.count}）`);
rec(
  "弹窗里常显写入方式说明（覆盖=删旧的 / 添加=保留旧的）",
  listState.note.includes("覆盖") && listState.note.includes("添加"),
  listState.note.slice(0, 90),
);

await clickSel('[data-import-submit="1"]');
const multiOk = await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 60000);
rec("多文件一起导入成功", multiOk);
const multiText = await page.evaluate(
  () => document.querySelector('[data-import-result="ok"]')?.textContent ?? "",
);
rec(
  "结果里逐份列出了每个文件读到多少",
  multiText.includes("chat-小李.json") && multiText.includes("chat-老王.json"),
  multiText.replace(/\s+/g, " ").slice(0, 200),
);
const multiRows = await evidenceCount("wechat");
rec(
  "两份记录合并进同一个源（3 条我的消息，不是只剩最后一份）",
  multiRows === 3,
  `${multiRows} 条`,
);
const bothPartners = await prisma.personaEvidence.findMany({
  where: { personaId, source: "wechat" },
  select: { note: true },
});
rec(
  "两个会话的内容都在（证明是合并而不是互相覆盖）",
  bothPartners.some((r) => (r.note ?? "").includes("灰度")) &&
    bothPartners.some((r) => (r.note ?? "").includes("技术债")),
  bothPartners.map((r) => (r.note ?? "").slice(0, 14)).join(" ⏐ "),
);

/* 再单独导一份：应当是**替换**（只剩这一份） */
await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();
await clickSel('[data-open-import="wechat"]');
await page.waitForTimeout(500);
await attachFile('[data-import-input="1"]', "chat-老王.json", CHAT_B);
await clickSel('[data-import-submit="1"]');
await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 60000);
const afterSingle = await prisma.personaEvidence.findMany({
  where: { personaId, source: "wechat" },
  select: { note: true },
});
rec(
  "只选一份时是**替换**：旧的「小李」那份被清掉，只剩「老王」这份",
  afterSingle.length === 2 && afterSingle.every((r) => !(r.note ?? "").includes("灰度")),
  `${afterSingle.length} 条：${afterSingle.map((r) => (r.note ?? "").slice(0, 12)).join(" ⏐ ")}`,
);

/* ───────── ⑨ 越权与错误路径 ───────── */
console.log("\n== ⑨ 别人的卡片上不能导入（越权保护）==");
await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await page.goto(`${BASE}/persona?personaId=${encodeURIComponent("zhihu-jian-kang-zhong-guo")}`, {
  waitUntil: "load",
  timeout: 60000,
});
await page.waitForTimeout(2200);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    x.textContent.trim().includes("注入数据"),
  );
  b?.click();
});
await page.waitForTimeout(800);
const foreign = await page.evaluate(() =>
  ["wechat", "qq", "feishu", "dingtalk"].map((s) => {
    const b = document.querySelector(`[data-open-import="${s}"]`);
    return { s, disabled: b ? b.disabled : null };
  }),
);
rec(
  "看别人的卡片时导入按钮全部禁用",
  foreign.every((f) => f.disabled === true || f.disabled === null),
  foreign.map((f) => `${f.s}=${f.disabled}`).join(" "),
);

/* 服务端也要挡（前端禁用只是体验，不是安全边界） */
const direct = await page.evaluate(async () => {
  const fd = new FormData();
  fd.append("source", "wechat");
  fd.append("personaId", "zhihu-jian-kang-zhong-guo");
  fd.append("file", new File(["张三：测试"], "x.txt", { type: "text/plain" }));
  const r = await fetch("/api/import", { method: "POST", body: fd });
  return { status: r.status, body: await r.json() };
});
rec(
  "服务端对越权导入返回 403（不信任前端）",
  direct.status === 403 || direct.body?.code === "FORBIDDEN",
  `${direct.status} ${JSON.stringify(direct.body).slice(0, 110)}`,
);

const badExt = await page.evaluate(async () => {
  const fd = new FormData();
  fd.append("source", "wechat");
  fd.append("file", new File(["x"], "malware.exe", { type: "application/octet-stream" }));
  const r = await fetch("/api/import", { method: "POST", body: fd });
  return { status: r.status, body: await r.json() };
});
rec(
  "扩展名白名单生效（.exe 被拒）",
  badExt.status === 400 && badExt.body?.code === "BAD_EXT",
  badExt.body?.error ?? "",
);

const noContent = await page.evaluate(async () => {
  const fd = new FormData();
  fd.append("source", "wechat");
  fd.append("file", new File(["[图片]\n[表情]\n"], "empty.txt", { type: "text/plain" }));
  const r = await fetch("/api/import", { method: "POST", body: fd });
  return { status: r.status, body: await r.json() };
});
rec(
  "只有图片/表情的文件被拒，并给出可操作原因",
  noContent.status === 400 && noContent.body?.code === "NO_CONTENT",
  (noContent.body?.warnings ?? []).join(" ⏐ ").slice(0, 120),
);

/* ───────── ⑩ 按钮形态 ───────── */
console.log("\n== ⑩ 按钮形态（首次一个 / 已注入两个 / 平台源多一个同步）==");

/* 先把钉钉清成"未注入"，才能验证平台源的按钮形态 */
await prisma.personaEvidence.deleteMany({ where: { personaId, source: "dingtalk" } });
await prisma.personaSource.updateMany({
  where: { personaId, type: "dingtalk" },
  data: { status: "not_injected" },
});
await gotoSources();

const platCard = await page.evaluate(() => {
  const card = document.querySelector('[data-open-import="dingtalk"]')?.closest("article");
  return {
    buttons: [...(card?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()),
    text: (card?.textContent ?? "").replace(/\s+/g, " ").trim(),
    sync: Boolean(card?.querySelector("[data-provider-sync]")),
    appendMode: card
      ?.querySelector('[data-open-import="dingtalk"]')
      ?.getAttribute("data-import-mode"),
  };
});
rec(
  "飞书/钉钉卡片有「同步数据」按钮",
  platCard.sync && platCard.buttons.some((b) => b === "同步数据"),
  platCard.buttons.join(" ｜ "),
);
rec(
  "飞书/钉钉卡片有「手动导入数据」按钮，且是**只加不删**（append）",
  platCard.buttons.includes("手动导入数据") && platCard.appendMode === "append",
  `data-import-mode=${platCard.appendMode}`,
);
rec(
  "⚠️ 卡片上没有大段文字说明（用户要求删掉）",
  platCard.text.length < 160,
  `${platCard.text.length} 字：${platCard.text.slice(0, 120)}`,
);

const injected = await page.evaluate(() => {
  const card = document.querySelector('[data-open-import="wechat"]')?.closest("article");
  return [...(card?.querySelectorAll("button") ?? [])]
    .map((b) => ({ text: b.textContent.trim(), mode: b.getAttribute("data-import-mode") }))
    .filter((b) => b.mode);
});
rec(
  "微信（已注入）是两个按钮：「覆盖聊天记录」+「添加聊天记录」",
  injected.length === 2 &&
    injected.some((b) => b.text === "覆盖聊天记录" && b.mode === "replace") &&
    injected.some((b) => b.text === "添加聊天记录" && b.mode === "append"),
  injected.map((b) => `${b.text}(${b.mode})`).join(" ｜ "),
);

/* 添加模式真的追加（不删旧的） */
console.log("\n== ⑪ 「添加聊天记录」= 追加，不删旧的 ==");
const beforeAdd = await evidenceCount("wechat");
await clickSel('[data-open-import="wechat"][data-import-mode="append"]');
await page.waitForTimeout(600);
const appendDlg = await page.evaluate(() => {
  /* ⚠️ 选择器要限定在弹窗内：源卡片上的按钮也带 data-import-mode，
     不限定会选到按钮（它的文本是"添加聊天记录"，断言就会假失败） */
  const banner = document.querySelector('[data-import-dialog] [data-import-mode]');
  return {
    mode: banner?.getAttribute("data-import-mode"),
    banner: banner?.textContent?.trim() ?? "",
    title: document.querySelector("[data-import-title]")?.textContent?.trim() ?? "",
  };
});
rec(
  "弹窗明确是「添加」模式（标题 + 横幅都写清了不会删旧数据）",
  appendDlg.mode === "append" &&
    appendDlg.title.includes("添加") &&
    appendDlg.banner.includes("不会被删除"),
  `${appendDlg.title} ｜ ${appendDlg.banner.slice(0, 60)}`,
);
await attachFile('[data-import-input="1"]', "add-more.json", CHAT_A);
await clickSel('[data-import-submit="1"]');
await waitFor(() => Boolean(document.querySelector('[data-import-result="ok"]')), 60000);
const afterAdd = await evidenceCount("wechat");
rec(
  "追加后证据变多，且旧数据仍在（不是覆盖）",
  afterAdd > beforeAdd,
  `${beforeAdd} → ${afterAdd}`,
);
const oldStillThere = await prisma.personaEvidence.count({
  where: { personaId, source: "wechat", note: { contains: "技术债" } },
});
rec("上次导入的内容（「技术债」那条）还在", oldStillThere > 0, `${oldStillThere} 条`);

/* 授权引导 */
console.log("\n== ⑫ 「同步数据」的配置向导（三步跳转，无大段文字）==");
await page.evaluate(() => {
  document.querySelector('[data-import-dialog] button[aria-label="关闭"]')?.click();
});
await page.waitForTimeout(400);
await gotoSources();

/* 未配置凭证时点「同步数据」应弹出三步向导 */
await clickSel('[data-provider-link="feishu"] [data-provider-sync]');
await page.waitForTimeout(900);
const wizard = await page.evaluate(() => {
  const w = document.querySelector("[data-sync-setup]");
  if (!w) return null;
  const steps = [...w.querySelectorAll("[data-step]")].map((s) => ({
    n: s.getAttribute("data-step"),
    text: s.textContent.replace(/\s+/g, " ").trim(),
  }));
  return {
    provider: w.getAttribute("data-sync-setup"),
    steps,
    consoleLink: w.querySelector("[data-setup-open-console]")?.getAttribute("href") ?? "",
    redirect: w.querySelector("[data-setup-redirect]")?.textContent?.trim() ?? "",
    hasCopy: Boolean(w.querySelector("[data-setup-copy]")),
    hasAppId: Boolean(w.querySelector("[data-setup-appid]")),
    hasSecret: Boolean(w.querySelector("[data-setup-secret]")),
    chars: (w.textContent ?? "").replace(/\s+/g, " ").trim().length,
  };
});
rec("点「同步数据」弹出配置向导", Boolean(wizard), wizard ? `provider=${wizard.provider}` : "(没弹出)");
rec("向导是三步", wizard?.steps.length === 3, wizard?.steps.map((s) => s.n).join(","));
rec(
  "第 1 步直接跳平台开放平台（新标签打开）",
  wizard?.consoleLink.startsWith("https://open."),
  wizard?.consoleLink,
);
rec(
  "第 2 步给出**本站的**回调地址 + 一键复制",
  Boolean(wizard?.redirect.includes("/api/oauth/feishu/callback")) && wizard?.hasCopy === true,
  wizard?.redirect,
);
rec(
  "第 3 步就是两个输入框（App ID / Secret），不用去 Vercel 配环境变量",
  wizard?.hasAppId === true && wizard?.hasSecret === true,
);
rec(
  "⚠️ 向导总字数很少（不搞大段说明）",
  (wizard?.chars ?? 9999) < 260,
  `${wizard?.chars} 字`,
);

/* 填了凭证要能存下来（存完会自动跳授权，这里只验证保存接口本身） */
const saveRes = await page.evaluate(async () => {
  const r = await fetch("/api/oauth/app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "feishu",
      appId: "cli_selftest_only",
      appSecret: "selftest_secret_not_real",
    }),
  });
  const status = await fetch("/api/oauth/status").then((x) => x.json());
  return {
    save: await r.json(),
    configured: status.providers?.feishu?.configured,
    appId: status.providers?.feishu?.appId,
    leak: JSON.stringify(status).includes("selftest_secret_not_real"),
  };
});
rec("凭证能保存（存本站，不用配环境变量）", saveRes.save?.ok === true, JSON.stringify(saveRes.save).slice(0, 90));
rec("保存后状态变为已配置", saveRes.configured === true, `appId=${saveRes.appId}`);
rec("⚠️ 状态接口**不回传 secret**", saveRes.leak === false);

/* 收尾：把这把自测凭证删掉，恢复"未配置"（否则线上会带着假凭证） */
const cleaned = await page.evaluate(async () => {
  const r = await fetch("/api/oauth/app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "feishu", appId: "", appSecret: "" }),
  });
  const status = await fetch("/api/oauth/status").then((x) => x.json());
  return { ok: (await r.json()).ok, configured: status.providers?.feishu?.configured };
});
rec("自测凭证已清除，恢复未配置", cleaned.ok === true && cleaned.configured === false);

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" ⏐ "));

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
console.log(`截图：${OUT}`);

await prisma.$disconnect();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
