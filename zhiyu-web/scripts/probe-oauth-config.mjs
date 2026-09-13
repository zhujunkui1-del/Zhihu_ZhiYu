/**
 * 用真实 app_id 探测 authorize 端点，判断凭证与回调登记状态。
 *
 * 只发一个 GET、不跟随重定向，看知乎返回什么。
 * 这不消费任何凭证、也不完成授权（授权需要用户本人点同意）。
 */
const APP_ID = process.env.PROBE_APP_ID;
if (!APP_ID) {
  console.error("用法：PROBE_APP_ID=xxx node scripts/probe-oauth-config.mjs [redirectUri]");
  process.exit(1);
}
const redirectUri = process.argv[2] || "https://example.com/api/auth/zhihu/callback";

const u = new URL("https://openapi.zhihu.com/authorize");
u.searchParams.set("redirect_uri", redirectUri);
u.searchParams.set("app_id", APP_ID);
u.searchParams.set("response_type", "code");
u.searchParams.set("state", "probe-" + Date.now());

console.log(`探测 authorize：app_id=${APP_ID} redirect_uri=${redirectUri}`);
console.log(`URL: ${u.toString().slice(0, 140)}…\n`);

try {
  const r = await fetch(u.toString(), { redirect: "manual" });
  const text = await r.text().catch(() => "");
  console.log(`HTTP ${r.status}`);
  console.log(`location: ${r.headers.get("location") ?? "(无)"}`);
  console.log(`content-type: ${r.headers.get("content-type") ?? "(无)"}`);
  console.log(`body 前 300 字：${text.slice(0, 300).replace(/\s+/g, " ")}`);
} catch (e) {
  console.error("请求失败:", e.message);
}
