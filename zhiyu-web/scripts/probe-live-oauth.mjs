#!/usr/bin/env node
/**
 * 探测线上域名的跳转与 Set-Cookie 行为。
 *
 * 为什么需要：手机端"授权后又跳回登录页"最可能的成因是
 *   ① apex ↔ www 之间跳转导致 Cookie 域不一致
 *   ② 回调的 Set-Cookie 在跨站 302 后被浏览器丢掉
 * 所以这里先把线上真实的跳转链和 Cookie 属性打出来，再谈修法。
 *
 * 用法：node scripts/probe-live-oauth.mjs
 */
const urls = [
  "https://zhiyuapp.site/",
  "https://www.zhiyuapp.site/",
  "https://www.zhiyuapp.site/api/auth/session",
  "https://www.zhiyuapp.site/api/auth/zhihu",
];

for (const u of urls) {
  try {
    const r = await fetch(u, { redirect: "manual" });
    const setCookie = r.headers.getSetCookie?.() ?? [];
    console.log(`\n${u}`);
    console.log(`  status=${r.status}`);
    console.log(`  location=${r.headers.get("location") ?? "(无)"}`);
    if (setCookie.length) {
      for (const c of setCookie) {
        /* 只打印属性，token 值本身不打印 */
        const [, ...attrs] = c.split(";");
        console.log(`  Set-Cookie 属性:${attrs.join(";")}`);
      }
    }
    if (u.endsWith("/api/auth/session")) {
      const body = await r.text();
      console.log(`  body=${body.slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`\n${u}\n  ERR ${e.message}`);
  }
}
