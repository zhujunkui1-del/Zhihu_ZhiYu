#!/usr/bin/env node
/**
 * 日期格式化回归测试。
 *
 * 背景：这是修掉一个真实 hydration bug 后加的锁。
 * 服务端（Vercel）跑在 UTC，浏览器在用户本地时区。页面此前用裸
 * `toLocaleDateString("zh-CN")`，两边渲染出**不同文本**（实测差 8 小时），
 * 触发 React #418，整棵服务端树被客户端重建。
 *
 * 核心断言：**在不同 TZ 环境下，同一时刻必须格式化成同一字符串。**
 *
 * 用法：node scripts/test-datetime.mjs
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

/** Windows 上绝对路径必须是 file:// URL，ESM 加载器才接受 */
const DT = pathToFileURL(join(process.cwd(), "lib", "datetime.ts")).href;

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

/** 在指定 TZ 下跑一段脚本，取回它打印的结果 */
function runInTz(tz, body) {
  const code = `import { formatListTime, formatFullTime, formatDate } from "${DT}";\n${body}`;
  return execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  }).trim();
}

const PROBE = `
const d = new Date("2026-09-13T16:40:00.000Z");
const now = new Date("2026-09-14T10:00:00.000Z");
console.log(JSON.stringify({
  list: formatListTime(d, now),
  full: formatFullTime(d),
  date: formatDate(d),
}));
`;

console.log("日期格式化回归测试（时区一致性）");
console.log("=".repeat(80));

/* ① 关键：不同时区结果必须一致 */
{
  const utc = runInTz("UTC", PROBE);
  const sh = runInTz("Asia/Shanghai", PROBE);
  const ny = runInTz("America/New_York", PROBE);
  rec("UTC 与 Asia/Shanghai 结果一致（修掉 #418 的关键）", utc === sh,
    utc === sh ? utc : `UTC: ${utc}\n      SH : ${sh}`);
  rec("再换一个时区（纽约）也一致", utc === ny, utc === ny ? "" : `NY: ${ny}`);
}

/* ② 内容正确性：2026-09-13T16:40Z = 北京时间 09-14 00:40 */
{
  const r = JSON.parse(runInTz("UTC", PROBE));
  rec("formatFullTime 按北京时间展示", r.full === "2026/09/14 00:40", r.full);
  rec("formatDate 按北京时间展示", r.date === "2026/09/14", r.date);
  rec("与基准同一天 → 显示「今天」", r.list.startsWith("今天"), r.list);
}

/* ③ 跨天判断用展示时区，不是 UTC */
{
  const body = `
const d = new Date("2026-09-13T23:00:00.000Z");   // 北京 09-14 07:00
const now = new Date("2026-09-14T00:00:00.000Z"); // 北京 09-14 08:00
console.log(formatListTime(d, now));
`;
  const r = runInTz("UTC", body);
  rec("跨天判断按展示时区（UTC 下不误判成昨天）", r.startsWith("今天"), r);
}

/* ④ 非法输入不崩 */
{
  const body = `
console.log(JSON.stringify([
  formatListTime("not-a-date"),
  formatFullTime("not-a-date"),
  formatDate("not-a-date"),
]));
`;
  const r = JSON.parse(runInTz("UTC", body));
  rec("非法日期返回空串而不是崩溃或 NaN", r.every((x) => x === ""), JSON.stringify(r));
}

/* ⑤ 页面里不再有裸 toLocale* 调用 */
{
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  for (const d of ["app", "components", "lib"]) walk(d);

  const offenders = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    /* 去掉注释再找，避免把说明文字算成违规 */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (/toLocale(String|DateString|TimeString)\s*\(/.test(code)) offenders.push(f);
  }
  rec("组件里没有裸 toLocale* 调用（必须走 lib/datetime）",
    offenders.length === 0, offenders.join(", ") || "全部已收口");
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
