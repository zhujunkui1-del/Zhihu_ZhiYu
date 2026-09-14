#!/usr/bin/env node
/**
 * 线上到底跑的是哪一版？用新代码独有的标记去探测。
 *
 * 不要靠"我推了所以应该好了"来判断 —— 直接看线上有没有这些标记：
 *   #8 侧栏用户块 data-side-user、lib/sidebar-user 的兜底名
 *   #1 全局弹幕容器（代码里有，但没报错时不渲染，故只能测 CSS/JS 存在性）
 *   #2 会话 Cookie 的 SameSite 属性（生产应为 None）
 *   #7 设置页 03 区滑块 data-platform-llm（未登录会被重定向，改测 /api/persona/distill 的字段）
 */
const BASE = process.argv[2] || "https://www.zhiyuapp.site";

const get = async (path, init) => {
  const r = await fetch(BASE + path, { redirect: "manual", ...init });
  return r;
};

/* ① 登录页 HTML 里应有新文案（#2 改过：不再是"演示原型 · 接入开放平台后…"） */
{
  const r = await get("/");
  const html = await r.text();
  console.log("\n== 登录页 ==");
  console.log(`  status=${r.status}`);
  console.log(`  含旧文案「演示原型 · 接入开放平台后」= ${html.includes("演示原型")}  （新代码应为 false）`);
  console.log(`  含新文案「已接入知乎开放平台」= ${html.includes("已接入知乎开放平台")}  （新代码应为 true）`);
  console.log(`  含「检查登录状态」= ${html.includes("正在检查登录状态")}`);
}

/* ② 未登录访问 /settings：应 307 回 /（若已部署，会先在服务端解析身份） */
{
  const r = await get("/settings");
  console.log("\n== /settings（未登录） ==");
  console.log(`  status=${r.status} location=${r.headers.get("location") ?? "-"}`);
}

/* ③ 会话接口：新代码会多吐 platform 相关字段吗？（#7 只影响 distill） */
{
  const r = await get("/api/auth/session");
  const j = await r.json();
  console.log("\n== /api/auth/session ==");
  console.log(`  ${JSON.stringify(j)}`);
}

/* ④ #7：蒸馏就绪接口 —— 新代码才会返回 freeWindowOpen / freeUntil / usePlatformLlm */
{
  const r = await get("/api/persona/distill");
  const j = await r.json().catch(() => ({}));
  console.log("\n== /api/persona/distill（GET，未登录应为 401，但可看字段） ==");
  console.log(`  status=${r.status} body=${JSON.stringify(j).slice(0, 200)}`);
}

/* ⑤ #1/#2：无来源的写请求在**生产**应被 CSRF 拦下（403 CROSS_SITE_BLOCKED）。
     旧代码没有这层校验，会返回 401（未登录）而不是 403。 */
{
  const r = await fetch(`${BASE}/api/notifications`, { method: "POST" });
  const j = await r.json().catch(() => ({}));
  console.log("\n== CSRF 校验是否已上线 ==");
  console.log(`  POST /api/notifications（不带 Origin）→ status=${r.status} code=${j.code ?? "-"}`);
  console.log(`  新代码应为 403 CROSS_SITE_BLOCKED；旧代码会是 401 UNAUTHENTICATED`);
}

/* ⑥ #2 关键：会话 Cookie 的 SameSite —— 生产应为 None。
     用一个"能种 Cookie"的路径触发。生产下 /api/auth/demo 被禁用（403），
     但 403 不会种 Cookie。所以这里改为观察登录跳转链路是否正常。 */
{
  const r = await get("/api/auth/zhihu");
  console.log("\n== /api/auth/zhihu 跳转 ==");
  console.log(`  status=${r.status}`);
  console.log(`  location=${(r.headers.get("location") ?? "-").slice(0, 120)}`);
}
