#!/usr/bin/env node
/**
 * 检查**线上**会话 Cookie 的属性（#2 的关键）。
 *
 * 修 #2 的做法是生产环境把会话 Cookie 改成 `SameSite=None; Secure`
 * （Safari 从知乎跳回时不发 Lax Cookie，见 WebKit bug 219650）。
 * 这个属性只在本站**真的下发 Cookie** 时才能看到。
 *
 * 生产环境没有可用的演示登录（被 403 挡掉），所以这里直接观察
 * 授权链路里所有会产生 Set-Cookie 的响应。若拿不到，
 * 就退而报告"无法在未授权状态下验证"，而不是假装通过。
 */
const BASE = process.argv[2] || "https://www.zhiyuapp.site";

const show = (r, label) => {
  const cookies = r.headers.getSetCookie?.() ?? [];
  console.log(`\n${label}`);
  console.log(`  status=${r.status}`);
  if (!cookies.length) {
    console.log("  Set-Cookie：（无）");
    return;
  }
  for (const c of cookies) {
    const [pair, ...attrs] = c.split(";");
    const name = pair.split("=")[0];
    console.log(`  Set-Cookie: ${name}  ← 属性：${attrs.map((a) => a.trim()).join("; ") || "(无)"}`);
  }
};

/* ① 授权入口：会生成并落库 state，但**不**下发给浏览器 Cookie */
show(await fetch(`${BASE}/api/auth/zhihu`, { redirect: "manual" }), "GET /api/auth/zhihu");

/* ② 回调（故意用无效 code）：失败路径也会清 Cookie 吗 */
show(
  await fetch(`${BASE}/api/auth/zhihu/callback?code=invalid-probe-code&state=invalid`, {
    redirect: "manual",
  }),
  "GET /api/auth/zhihu/callback?code=invalid（失败路径）",
);

/* ③ 退出登录：即使未登录，也会走清 Cookie 分支 */
show(
  await fetch(`${BASE}/api/auth/session`, {
    method: "DELETE",
    headers: { origin: BASE },
  }),
  "DELETE /api/auth/session（带 Origin）",
);

/* ④ 不带 Origin 对照：应被 CSRF 拦下且**不**下发任何 Cookie */
show(
  await fetch(`${BASE}/api/auth/session`, { method: "DELETE" }),
  "DELETE /api/auth/session（不带 Origin，应 403）",
);
