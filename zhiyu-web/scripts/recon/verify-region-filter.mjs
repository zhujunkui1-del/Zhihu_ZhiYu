#!/usr/bin/env node
/**
 * 地区筛选完整性验证（#6）：
 *   · 省份下拉包含全部 34 个省级单位 + 海外
 *   · 抽查几个容易漏的地区（港澳台、海南县级市、新疆兵团市、省直辖县级市）
 *   · 城市联动正确
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

console.log("地区筛选完整性验证（#6）");
console.log("=".repeat(80));

await page.goto(BASE + "/find", { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2800);

const opts = await page.evaluate(() => {
  const sel = document.querySelector("#f-prov");
  return sel ? [...sel.options].map((o) => o.textContent.trim()) : [];
});
console.log(`省份下拉共 ${opts.length} 项（含「全部省份」占位）\n`);

const EXPECT = [
  "北京", "天津", "河北", "山西", "内蒙古",
  "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东",
  "河南", "湖北", "湖南", "广东", "广西", "海南",
  "重庆", "四川", "贵州", "云南", "西藏",
  "陕西", "甘肃", "青海", "宁夏", "新疆",
  "台湾", "香港", "澳门",
];
const missing = EXPECT.filter((p) => !opts.some((o) => o.startsWith(p)));
rec("34 个省级单位全部在下拉里", missing.length === 0,
  missing.length ? `缺：${missing.join("、")}` : `实有 ${opts.length - 1} 个省级项`);

rec("港澳台都在（一个都不能少）",
  ["台湾", "香港", "澳门"].every((p) => opts.some((o) => o.startsWith(p))),
  opts.filter((o) => /台湾|香港|澳门/.test(o)).join(" / "));

rec("有「海外」分组（抓到的真实用户里有海外账号）",
  opts.some((o) => o.startsWith("海外")), opts.find((o) => o.startsWith("海外")) ?? "缺失");

/* 抽查容易漏的城市 */
const PROBE = [
  ["湖北", ["仙桃", "潜江", "天门", "神农架林区"]],
  ["河南", ["济源"]],
  ["海南", ["五指山", "琼海", "文昌", "万宁", "东方"]],
  ["新疆", ["石河子", "阿拉尔", "图木舒克", "五家渠", "可克达拉", "胡杨河"]],
  ["台湾", ["台北", "高雄", "澎湖县", "金门县", "连江县"]],
  ["内蒙古", ["兴安盟", "锡林郭勒盟", "阿拉善盟"]],
  ["云南", ["西双版纳傣族自治州", "大理白族自治州"]],
  ["黑龙江", ["大兴安岭地区"]],
];

for (const [prov, cities] of PROBE) {
  await page.evaluate((p) => {
    const sel = document.querySelector("#f-prov");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(sel, p);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, prov);
  await page.waitForTimeout(600);
  const cityOpts = await page.evaluate(() =>
    [...document.querySelectorAll("#f-city option")].map((o) => o.textContent.trim()),
  );
  const miss = cities.filter((c) => !cityOpts.includes(c));
  rec(`${prov} 的城市齐全`,
    miss.length === 0,
    miss.length ? `缺 ${miss.join("、")}｜现有 ${cityOpts.slice(1, 8).join("、")}…` : `${cityOpts.length - 1} 个城市`);
}

/* 海外分组的国家 */
await page.evaluate(() => {
  const sel = document.querySelector("#f-prov");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(sel, "海外");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(600);
const overseas = await page.evaluate(() =>
  [...document.querySelectorAll("#f-city option")].map((o) => o.textContent.trim()),
);
rec("海外分组含美/澳等（库里真实存在的）",
  overseas.includes("美国") && overseas.includes("澳大利亚"),
  `共 ${overseas.length - 1} 个国家和地区`);

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
