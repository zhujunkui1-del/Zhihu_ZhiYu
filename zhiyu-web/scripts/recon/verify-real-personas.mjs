#!/usr/bin/env node
/**
 * 验证：从知乎抓来的真实用户是否出现在发现页、可被检索。
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  await fetch("/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
});

console.log("验证真实知乎用户出现在发现页");
console.log("=".repeat(80));

await page.goto(BASE + "/find", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(3000);

const overview = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("article")];
  const meta = document.querySelector('[class*="resultMeta"]')?.textContent?.trim() ?? "";
  /* 名字在 [class*="pTitle"] 里（不是 h3 —— 一开始按 h3 取，结果全是空字符串） */
  const nameOf = (c) =>
    (c.querySelector('[class*="pTitle"]')?.textContent ?? "").trim();
  return {
    total: cards.length,
    meta,
    names: cards.slice(0, 60).map(nameOf).filter(Boolean),
  };
});
rec("发现页渲染出候选", overview.total > 0, `共 ${overview.total} 位｜${overview.meta}`);

const KNOWN = ["张佳玮", "毕导", "丁香医生", "李松蔚", "王瑞恩", "铁木君", "虎山行不行"];
const found = KNOWN.filter((n) => overview.names.some((x) => x.includes(n)));
rec("真实知乎用户出现在候选里", found.length > 0,
  `命中 ${found.length}/${KNOWN.length}：${found.join(" / ")}`);

/* 搜索一个真实用户 */
{
  await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="搜索关键词"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "张佳玮");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("article")];
    return {
      n: cards.length,
      names: cards.map((c) => (c.querySelector('[class*="pTitle"]')?.textContent ?? "").trim()),
    };
  });
  rec("能按名字搜索到真实用户", r.n > 0 && r.names.some((x) => x.includes("张佳玮")),
    `搜「张佳玮」得 ${r.n} 张：${r.names.slice(0, 3).join(" / ")}`);
}

/* 打开他的卡片，确认显示的是他。
   注意：现在是**就地弹窗**打开（产品要求不跳页），所以要看弹窗里的标题，
   而不是跳转后的 h1。 */
{
  const pathBefore = await page.evaluate(() => location.pathname);
  const clicked = await page.evaluate(() => {
    const first = document.querySelector("article");
    if (!first) return false;
    const btn = [...first.querySelectorAll("button")].find((b) => /人格卡|查看/.test(b.textContent));
    if (btn) { btn.click(); return true; }
    first.click();
    return true;
  });
  /* 等弹窗内容渲染出来（dev 下要拉 /api/persona/[id]） */
  let title = "";
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(400);
    title = await page.evaluate(
      () =>
        document.querySelector('[data-persona-modal="1"] [data-modal-title="1"]')?.textContent?.trim() ??
        "",
    );
    if (title && !title.includes("正在打开")) break;
  }
  const info = await page.evaluate(() => ({
    path: location.pathname,
    text: document.body.innerText || "",
  }));
  rec(
    "点开后是对方的人格卡（弹窗形式，不跳页）",
    clicked && title.includes("的人格卡") && info.path === pathBefore,
    `弹窗标题「${title}」，URL ${pathBefore} → ${info.path}`,
  );
  rec(
    "弹窗里显示来自知乎的数据",
    /知乎|公开表达|公共表达/.test(info.text),
    /知乎/.test(info.text) ? "有知乎相关字段" : "未看到知乎字段",
  );
}

/* 雷达里也应包含真实用户 */
{
  await page.goto(BASE + "/find", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("相遇雷达"));
    if (b) b.click();
  });
  await page.waitForTimeout(2200);
  const radar = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-action="profile"]')];
    return {
      nodes: nodes.length,
      /* 名字在按钮的 aria-label 里（按钮内只有头像和 ✓ 角标，textContent 是空的） */
      labels: nodes.map((n) => n.getAttribute("aria-label") ?? ""),
      /* 真实知乎用户的人设 id 以 zhihu- 开头 */
      zhihuIds: nodes.map((n) => n.getAttribute("data-id") ?? "").filter((x) => x.startsWith("zhihu-")),
    };
  });
  const named = radar.labels.filter((n) => KNOWN.some((k) => n.includes(k))).length;
  rec("相遇雷达里也包含真实用户",
    radar.nodes > 0 && radar.zhihuIds.length > 0,
    `节点 ${radar.nodes} 个；其中知乎真实用户 ${radar.zhihuIds.length} 个；题干命中 ${named} 个`);
}

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
