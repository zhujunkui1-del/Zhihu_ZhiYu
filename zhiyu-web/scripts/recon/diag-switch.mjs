#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 量设置页三个开关的几何：.s-ctl / .switch-wrap / .switch / input / i / i::after 的位置与尺寸
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "switch-verify");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
await page.goto(BASE + "zhiyu-settings.html", { waitUntil: "load" });
await page.waitForTimeout(700);

const rows = await page.evaluate(() => {
  const ids = [
    ["sw-agent", "允许他人派 Agent 与我对话"],
    ["sw-quick", "允许在快速匹配中展示相似度"],
    ["sw-notify", "允许对方发送匹配报告给我"],
  ];
  const out = [];
  for (const [id, title] of ids) {
    const input = document.getElementById(id);
    if (!input) { out.push({ id, missing: true }); continue; }
    const wrap = input.closest(".switch-wrap");
    const sw = input.closest(".switch");
    const ctl = input.closest(".s-ctl");
    const i = sw.querySelector("i");
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cy: Math.round(r.top + r.height / 2) };
    };
    const after = getComputedStyle(i, "::after");
    const swCS = getComputedStyle(sw);
    const iCS = getComputedStyle(i);
    out.push({
      id,
      title,
      ctl: rect(ctl),
      wrap: rect(wrap),
      sw: rect(sw),
      input: rect(input),
      i: rect(i),
      swDisplay: swCS.display,
      swPos: swCS.position,
      swWH: swCS.width + " x " + swCS.height,
      iPos: iCS.position,
      iInset: iCS.top + " " + iCS.right + " " + iCS.bottom + " " + iCS.left,
      afterTop: after.top,
      afterLeft: after.left,
      afterWH: after.width + " x " + after.height,
      afterTransform: after.transform,
      checked: input.checked,
      /* 垂直居中对齐检查：i 的中心 vs switch 的中心 */
      delta: rect(i) && rect(sw) ? rect(i).cy - rect(sw).cy : null,
      /* i 是否溢出 switch */
      overflows: rect(i) && rect(sw)
        ? { dx: rect(i).w - rect(sw).w, dy: rect(i).h - rect(sw).h }
        : null,
    });
  }
  return out;
});

console.log("=== 设置页三个开关的几何 ===");
for (const r of rows) {
  if (r.missing) { console.log(`${r.id}: 未找到`); continue; }
  console.log(`\n【${r.id}】${r.title}`);
  console.log(`  .s-ctl        x=${r.ctl.x} y=${r.ctl.y} ${r.ctl.w}x${r.ctl.h}  中线=${r.ctl.cy}`);
  console.log(`  .switch-wrap  x=${r.wrap.x} y=${r.wrap.y} ${r.wrap.w}x${r.wrap.h}  中线=${r.wrap.cy}`);
  console.log(`  .switch       x=${r.sw.x} y=${r.sw.y} ${r.sw.w}x${r.sw.h}  中线=${r.sw.cy}   display=${r.swDisplay} position=${r.swPos} size声明=${r.swWH}`);
  console.log(`  input         x=${r.input.x} y=${r.input.y} ${r.input.w}x${r.input.h}`);
  console.log(`  i             x=${r.i.x} y=${r.i.y} ${r.i.w}x${r.i.h}  中线=${r.i.cy}   position=${r.iPos} inset=${r.iInset}`);
  console.log(`  i::after      top=${r.afterTop} left=${r.afterLeft} ${r.afterWH}  transform=${r.afterTransform}`);
  console.log(`  → i 与 switch 中线差=${r.delta}px   i 相对 switch 溢出=${JSON.stringify(r.overflows)}   checked=${r.checked}`);
}

/* 截三个开关区域 */
const box = await page.evaluate(() => {
  const first = document.querySelector('[data-od-id="row-allow-agent"] .s-ctl');
  const last = document.querySelector('[data-od-id="row-report-notify"] .s-ctl');
  if (!first || !last) return null;
  const a = first.getBoundingClientRect();
  const b = last.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(a.left - 30)),
    y: Math.max(0, Math.round(a.top - 16)),
    width: Math.round(a.width + 60),
    height: Math.round(b.bottom - a.top + 32),
  };
});
if (box) {
  await page.screenshot({ path: path.join(OUT, "switches-3x.png"), clip: box });
  console.log(`\n截图 → RECON/switch-verify/switches-3x.png (${box.width}x${box.height} @3x)`);
}

await browser.close();
