#!/usr/bin/env node
// 对比设置页各类行控件的右对齐：开关 vs 「去接入」按钮 vs 面板内边缘
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = "http://127.0.0.1:4188/";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(BASE + "zhiyu-settings.html", { waitUntil: "load" });
await page.waitForTimeout(700);

const data = await page.evaluate(() => {
  const panel = document.querySelector(".panel") || document.querySelector(".s-card");
  const panelRect = panel.getBoundingClientRect();
  const pcs = getComputedStyle(panel);
  const innerRight = panelRect.right - parseFloat(pcs.paddingRight);

  const rows = [...document.querySelectorAll(".s-row")].map((row) => {
    const h3 = row.querySelector(".s-body h3");
    const pEl = row.querySelector(".s-body p");
    const ctl = row.querySelector(".s-ctl");
    const r = row.getBoundingClientRect();
    const h3r = h3 ? h3.getBoundingClientRect() : null;
    const pr = pEl ? pEl.getBoundingClientRect() : null;
    const cr = ctl ? ctl.getBoundingClientRect() : null;
    const target = row.querySelector(".switch") || row.querySelector(".btn");
    const tr = target ? target.getBoundingClientRect() : null;
    return {
      title: h3 ? h3.textContent.trim().slice(0, 22) : "(无)",
      rowBox: `${Math.round(r.width)}x${Math.round(r.height)}`,
      h3Box: h3r ? `${Math.round(h3r.width)}x${Math.round(h3r.height)}` : null,
      pBox: pr ? `${Math.round(pr.width)}x${Math.round(pr.height)}` : null,
      textRight: pr ? Math.round(pr.right) : h3r ? Math.round(h3r.right) : null,
      ctlBox: cr ? `${Math.round(cr.width)}x${Math.round(cr.height)}` : null,
      ctlRight: cr ? Math.round(cr.right) : null,
      targetBox: tr ? `${Math.round(tr.width)}x${Math.round(tr.height)}` : null,
      ctlRightGap: cr ? Math.round(innerRight - cr.right) : null,
      /* 控件中心 vs 标题行中心 */
      ctlCenterY: cr ? Math.round(cr.top + cr.height / 2) : null,
      h3CenterY: h3r ? Math.round(h3r.top + h3r.height / 2) : null,
      /* 标题行右端到控件的水平距离 */
      gapFromText: cr && h3r ? Math.round(cr.left - h3r.right) : null,
    };
  });

  return {
    panel: { box: `${Math.round(panelRect.width)}x${Math.round(panelRect.height)}`, innerRight: Math.round(innerRight), padding: pcs.padding },
    rows,
  };
});

console.log(`面板 ${data.panel.box}  padding=${data.panel.padding}  内容右内边缘=${data.panel.innerRight}`);
console.log("\n标题                        文字右端   控件盒       控件右端  距内边缘   标题行中心  控件中心  差异   文字→控件间距");
console.log("-".repeat(122));
for (const r of data.rows) {
  const dy = r.ctlCenterY != null && r.h3CenterY != null ? r.ctlCenterY - r.h3CenterY : null;
  console.log(
    `${r.title.padEnd(24)} ${String(r.textRight).padStart(8)}   ${String(r.targetBox).padEnd(10)}  ${String(r.ctlRight).padStart(8)}  ${String(r.ctlRightGap).padStart(8)}  ${String(r.h3CenterY).padStart(10)}  ${String(r.ctlCenterY).padStart(8)}  ${String(dy).padStart(5)}  ${String(r.gapFromText).padStart(12)}`,
  );
}

await browser.close();
