#!/usr/bin/env node
/**
 * 从线上登录页 HTML 里抽出「登录卡片下方的 meta 文案」，
 * 用来判断部署的是哪一版（旧文案含"演示原型"，新版含"已接入知乎开放平台"）。
 */
const BASE = process.argv[2] || "https://www.zhiyuapp.site";

const html = await fetch(BASE + "/", { redirect: "manual" }).then((r) => r.text());

console.log(`HTML 长度：${html.length}`);

for (const needle of ["演示原型", "已接入知乎开放平台", "正在检查登录状态", "知遇的用户协议"]) {
  console.log(`  含「${needle}」= ${html.includes(needle)}`);
}

/* 把所有 class="meta" 的文本抓出来，看看卡片下方那行到底是什么 */
const metas = [...html.matchAll(/class="meta"[^>]*>([^<]{2,80})</g)].map((m) => m[1].trim());
console.log("\n页面里 class=\"meta\" 的文案：");
for (const m of metas) console.log(`   - ${m}`);
