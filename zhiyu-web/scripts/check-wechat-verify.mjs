#!/usr/bin/env node
/**
 * 检查微信验证文件是否已经在线上可访问。
 *
 * 微信「完成网站管理员认证」要求文件能通过
 *   https://<域名>/<文件名>.txt
 * 访问到，且内容完全一致（一串 40 位十六进制）。
 */
const NAME = "add36feb1a6280bbd6b17d8324be60e5.txt";
const WANT = "2843b3397d3721335edbcfefb72fbd2aebb37cfc";
const CANDIDATES = [
  `https://www.zhiyuapp.site/${NAME}`,
  `https://zhiyuapp.site/${NAME}`,
];

for (const url of CANDIDATES) {
  try {
    const r = await fetch(url, { redirect: "follow" });
    const text = (await r.text()).trim();
    const ok = text === WANT;
    console.log(`${ok ? "✅" : "⚠️ "} ${r.status}  ${url}`);
    console.log(`     内容: [${text.slice(0, 60)}]`);
    console.log(`     一致: ${ok}`);
  } catch (e) {
    console.log(`❌ ERR  ${url}\n     ${e.message}`);
  }
}

/* 顺带确认首页仍然正常（排除"整个站点挂了"） */
try {
  const r = await fetch("https://www.zhiyuapp.site/", { redirect: "manual" });
  console.log(`\n首页: ${r.status}`);
} catch (e) {
  console.log(`\n首页: ERR ${e.message}`);
}
