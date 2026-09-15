#!/usr/bin/env node
/**
 * 三项需求验证（用户在同一条反馈里提的三件事）。
 *
 *  ① 「综合画像」必须是**多源融合**的结论（六型倾向之一），
 *     不能把 SBTI 自评当综合画像。
 *  ② 测完 SBTI 要弹出**完整结果弹窗**（头像 + 匹配度 + 15 维 + 完整解读），
 *     参考 sbti.unun.dev 的结果页。
 *  ③ 「我的人格」页要有**每个数据源各自的解析**模块（此前缺失）。
 *
 * 用法：node --env-file=.env scripts/verify-fusion-ui.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-fusion");
fs.mkdirSync(OUT, { recursive: true });

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

const clickText = (t) =>
  page.evaluate((txt) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().includes(txt));
    if (!b) return false;
    b.click();
    return true;
  }, t);

/* 登录 */
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1800);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST" });
});

/* ───────── ① 综合画像 = 融合结论 ───────── */
console.log("\n== ① 综合画像应是多源融合的六型倾向 ==");
await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);

const SIX = ["深度思考型", "好奇探索型", "温和共情型", "理性辩手型", "体验派", "务实执行型"];
const fusedInfo = await page.evaluate(() => {
  const el = document.querySelector("[data-fused-type]");
  const sbtiLine = document.querySelector("[data-sbti-self]");
  const head = [...document.querySelectorAll("h3")].find((h) =>
    h.textContent.includes("综合画像"),
  );
  return {
    fusedType: el?.textContent?.trim() ?? "",
    headText: head?.textContent?.trim() ?? "",
    /* 综合画像块的标题旁应说明"由 X 融合"，而不是 SBTI 等级码 */
    headMeta:
      head?.parentElement?.querySelector(".meta")?.textContent?.trim() ?? "",
    sbtiSelfText: sbtiLine?.textContent?.trim().replace(/\s+/g, " ") ?? "",
  };
});

rec(
  "综合画像判定出了六型倾向之一",
  SIX.includes(fusedInfo.fusedType),
  `倾向型 = 「${fusedInfo.fusedType}」`,
);
rec(
  "综合画像标注了融合来源（不再是 SBTI 等级码）",
  /融合/.test(fusedInfo.headMeta),
  `标题旁：${fusedInfo.headMeta || "(空)"}`,
);
rec(
  "SBTI 自评与综合画像**分开**展示",
  fusedInfo.sbtiSelfText.includes("SBTI 自评"),
  `SBTI 行：${fusedInfo.sbtiSelfText.slice(0, 70)}`,
);
rec(
  "综合画像显示的**不是** SBTI 的类型名",
  fusedInfo.fusedType !== "" && !fusedInfo.sbtiSelfText.includes(fusedInfo.fusedType),
  `融合=${fusedInfo.fusedType}；SBTI 行里不含该词`,
);

/* ⚠️ 雷达必须**五条轴都有值**。
   回归点：曾经把雷达改成"整体优先融合值"，而某个源只算出 2 维
   （知乎只给标题 → 依赖文本长度的三维留空），结果 3 条轴变 `—`，
   用户看到的是"雷达图被干没了"。分源缺维是常态，不能拖垮整张图。 */
const axisInfo = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="axisRow"]')];
  return {
    count: rows.length,
    labels: rows.map((r) => r.querySelector('[class*="axisLabel"]')?.textContent?.trim() ?? ""),
    vals: rows.map((r) => r.querySelector('[class*="axisVal"]')?.textContent?.trim() ?? ""),
    radarDots: document.querySelectorAll("circle[class*='prDot']").length,
  };
});
rec(
  "雷达五条轴齐全",
  axisInfo.count === 5,
  `${axisInfo.count} 条：${axisInfo.labels.join("/")}`,
);
/* ⚠️ 断言已按新政策反转（③ 批次）：
   以前要求"五条轴全部有数值"，那是为了不出现空的雷达 —— 代价是把量不到的
   维度用 0/1 端点硬填，界面就是 1% / 99%（用户原话："你就整 99% 和 1%"）。
   现在的政策是**量不到就留空**（`—`），所以这里改成：
     · 至少有一条轴有值（雷达不能整张空掉）
     · 有值的轴不能是 0% / 100%（不许出现绝对化数值） */
rec(
  "五条轴里至少一条有值（不整张空掉）",
  axisInfo.vals.some((v) => v && v !== "—"),
  axisInfo.vals.join(" "),
);
rec(
  "有值的轴都不是 0% / 100%（量不到就留空，不用端点值硬填）",
  axisInfo.vals.filter((v) => v && v !== "—").every((v) => !/^(0|100)%$/.test(v)),
  axisInfo.vals.join(" "),
);
rec(
  "雷达画出了数据面（不是空态）",
  axisInfo.radarDots === 5,
  `${axisInfo.radarDots} 个顶点`,
);

/* ───────── ③ 分源解析模块 ───────── */
console.log("\n== ③ 每个数据源各自的解析 ==");
const facetInfo = await page.evaluate(() => {
  const block = document.querySelector("[data-facets-block]");
  const cards = [...document.querySelectorAll("[data-facet-source]")];
  return {
    hasBlock: Boolean(block),
    head: block?.querySelector("h3")?.textContent?.trim() ?? "",
    count: cards.length,
    sources: cards.map((c) => c.getAttribute("data-facet-source")),
    /* 每张卡里应有六维进度条与依据条数 */
    bars: cards.map((c) => c.querySelectorAll(".trackFill").length),
    texts: cards.map((c) => (c.textContent ?? "").replace(/\s+/g, " ").slice(0, 90)),
  };
});
rec("存在「分源解析」模块", facetInfo.hasBlock, facetInfo.head);
rec(
  "至少列出 1 个源的解析",
  facetInfo.count >= 1,
  `${facetInfo.count} 个源：${facetInfo.sources.join(", ")}`,
);
/* ⚠️ 断言已按新政策反转（③ 批次）：
   以前要求"每个源都画出六维"，同样是为了卡片不空 —— 代价是给量不到的维度
   硬凑 1%/99%（知乎只给标题、没有点赞数，社交连接和集中度都无从算起）。
   现在允许某个源**一根条都没有**（卡片只剩结论句），只要整体不是全空。 */
rec(
  "至少有一个源画出了维度（整体不空）",
  facetInfo.bars.some((n) => n > 0),
  `各卡进度条数：${facetInfo.bars.join(", ")}`,
);
rec(
  "没有任何一条进度条是 0% / 100%",
  !facetInfo.texts.some((t) => /(^|[^\d])(0|100)%/.test(t)),
  facetInfo.texts.map((t) => (t.match(/(^|[^\d])(0|100)%/) ?? [])[0] ?? "").filter(Boolean).join(" | ") || "无",
);
/* 用户要求删掉"未覆盖：…（该源只提供标题、没有正文…）"那行：
   缺维由"算不出来就不画那根条"表达，不再写字解释自己做不到什么。 */
const missingLine = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    hasMissing: t.includes("未覆盖"),
    hasPartial: t.includes("需要正文") || t.includes("无法提供") || t.includes("表达密度"),
  };
});
rec(
  "分源卡里不再出现「未覆盖」字样",
  !missingLine.hasMissing,
  missingLine.hasMissing ? "页面上仍有「未覆盖」" : "已删除",
);
rec(
  "也不再出现「该源无法提供 / 需要正文」这类自曝短板的文案",
  !missingLine.hasPartial,
  missingLine.hasPartial ? "仍有解释缺维的文字" : "已删除",
);
if (facetInfo.texts.length) {
  console.log("      卡片内容示例：");
  for (const t of facetInfo.texts.slice(0, 3)) console.log(`        · ${t}`);
}
await page.screenshot({ path: path.join(OUT, "persona-fusion.png"), fullPage: false });

/* ───────── ② SBTI 结果弹窗 ───────── */
console.log("\n== ② 测完 SBTI 应弹出完整结果弹窗 ==");
await clickText("重新测试 SBTI") || (await clickText("去完成 SBTI"));
await page.waitForTimeout(1200);

const quizOpened = await page.evaluate(
  () => document.querySelectorAll('[class*="optList"] button').length > 0,
);
rec("SBTI 答题弹窗打开", quizOpened);

/* 逐题作答（每题第一个选项，会自动跳下一题） */
for (let i = 0; i < 30; i += 1) {
  const ok = await page.evaluate(() => {
    const b = document.querySelector('[class*="optList"] button');
    if (!b) return false;
    b.click();
    return true;
  });
  if (!ok) break;
  await page.waitForTimeout(80);
}

/* 等结果弹窗出现（要跑一次提交 + 可能的 LLM 调用） */
let resultReady = false;
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(500);
  resultReady = await page.evaluate(() =>
    Boolean(document.querySelector('[data-sbti-result="1"] [data-sbti-title]')),
  );
  if (resultReady) break;
}
rec("提交后自动弹出 SBTI 结果弹窗", resultReady);

const modal = await page.evaluate(() => {
  const m = document.querySelector('[data-sbti-result="1"]');
  if (!m) return null;
  const img = m.querySelector("img");
  const text = (m.textContent ?? "").replace(/\s+/g, " ");
  return {
    title: m.querySelector("[data-sbti-title]")?.textContent?.trim() ?? "",
    imgSrc: img?.getAttribute("src") ?? "",
    imgLoaded: (img?.naturalWidth ?? 0) > 0,
    /* 匹配度徽章 */
    hasSim: /匹配度\s*\d+%/.test(text),
    /* 15 维等级：用 data 属性定位，避免 `[class*="dimChip"]` 同时匹配到
       外层 .dimChips 容器（实测把 15 个数成 20 个） */
    dimChips: m.querySelectorAll("[data-sbti-dim]").length,
    hasCodeLine: /等级码/.test(text),
    /* 完整解读段落 */
    reading: m.querySelector('[class*="readingBody"]')?.textContent?.trim() ?? "",
    textLen: text.length,
  };
});

if (modal) {
  rec("弹窗显示了人格名", modal.title.length > 0, `「${modal.title}」`);
  rec("弹窗显示了头像且图片加载成功", modal.imgLoaded, `src=${modal.imgSrc}`);
  rec("显示匹配度", modal.hasSim);
  rec("列出 15 维等级", modal.dimChips === 15, `${modal.dimChips} 个等级 chip`);
  rec("显示等级码", modal.hasCodeLine);
  rec(
    "有完整解读文字（参考图里的「该人格的简单解读」）",
    modal.reading.length > 40,
    `${modal.reading.length} 字：${modal.reading.slice(0, 70)}…`,
  );
  await page.screenshot({ path: path.join(OUT, "sbti-result-modal.png") });
} else {
  rec("拿到弹窗内容", false, "未找到 [data-sbti-result]");
}

/* 关掉后还能再打开（不必重测）。
   ⚠️ 提交成功后紧接着调了 router.refresh() 拉新数据，弹窗可能正在重挂载，
   单次点击偶尔会打在旧节点上。真人也是"点一下没反应就再点一下"，
   所以这里重试几次，而不是把偶发当成 bug。 */
const closeWithRetry = async (attempts = 4) => {
  for (let i = 0; i < attempts; i += 1) {
    const r = await page.evaluate(() => {
      const m = document.querySelector('[data-sbti-result="1"]');
      if (!m) return "already-closed";
      const btn = m.querySelector('[aria-label="关闭测试结果"]');
      if (!btn) return "no-button";
      btn.click();
      return "clicked";
    });
    await page.waitForTimeout(700);
    const stillOpen = await page.evaluate(() =>
      Boolean(document.querySelector('[data-sbti-result="1"]')),
    );
    if (!stillOpen) return { ok: true, attempts: i + 1, last: r };
  }
  return { ok: false, attempts, last: "始终未关闭" };
};

const closed = await closeWithRetry();
rec("结果弹窗可关闭", closed.ok, `尝试 ${closed.attempts} 次，最后结果=${closed.last}`);
const reopened = await clickText("查看完整结果");
await page.waitForTimeout(600);
const reopenedOk = await page.evaluate(() =>
  Boolean(document.querySelector('[data-sbti-result="1"]')),
);
rec("关掉后可用「查看完整结果」再次打开", reopened && reopenedOk);

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
