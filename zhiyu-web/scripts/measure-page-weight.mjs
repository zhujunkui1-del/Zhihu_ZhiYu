#!/usr/bin/env node
/**
 * 量一下某个页面在**冷缓存**下到底传了多少字节、最大的几个文件是谁。
 *
 * 为什么需要：用户反馈「手机端登录页加载太慢」。慢有很多种可能
 * （首字节慢 / JS 太大 / 图片太大 / 请求太多），不量就只能猜。
 * 这里用 CDP 的 Network 域把每个资源的编码后大小（含 header）加起来，
 * 给出总量 + Top N，作为优化前后的同一把尺子。
 *
 * 用法：node scripts/measure-page-weight.mjs [url] [--mobile]
 */
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const url = process.argv[2] || "http://127.0.0.1:3000/";
const mobile = process.argv.includes("--mobile");
const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport });

const byId = new Map();
const done = [];
page.connection.on("Network.requestWillBeSent", (ev) => {
  byId.set(ev.requestId, { url: ev.request?.url ?? "", type: ev.type ?? "Other" });
});
page.connection.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
  const r = byId.get(requestId);
  if (!r || r.url.startsWith("data:")) return;
  done.push({ ...r, bytes: encodedDataLength ?? 0 });
});

const t0 = Date.now();
await page.goto(url, { waitUntil: "load", timeout: 90000 });
const tLoad = Date.now() - t0;
/* 等一等，让懒加载 / 进场动画触发的资源也冒出来 */
await page.waitForTimeout(3000);

const total = done.reduce((a, b) => a + b.bytes, 0);
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`\n${url}  ${mobile ? "手机" : "桌面"} ${viewport.width}×${viewport.height}  冷缓存`);
console.log(`  load 事件：${tLoad} ms（本机连本机，只看结构不看绝对速度）`);
console.log(`  请求数：${done.length}    传输总量：${kb(total)}`);
const byType = new Map();
for (const d of done) byType.set(d.type, (byType.get(d.type) ?? 0) + d.bytes);
console.log(
  `  分类：${[...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${kb(v)}`)
    .join("  ")}`,
);
console.log("  最大的 12 个资源：");
for (const d of [...done].sort((a, b) => b.bytes - a.bytes).slice(0, 12)) {
  console.log(`    ${kb(d.bytes).padStart(9)}  ${d.type.padEnd(10)} ${d.url.replace(/^https?:\/\/[^/]+/, "")}`);
}

await browser.close();
