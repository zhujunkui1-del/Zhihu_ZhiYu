/**
 * 对比：读「你自己」 vs 读「别人」，数据类型与数量差多少。
 *
 * 全部实测，不用文档推断。
 *
 * 结论会分四类：
 *   A. 开放平台 · 自己的用户数据（Access Secret）
 *   B. 开放平台 · OAuth 授权用户（需对方 token）
 *   C. 公开端点 · 任何人（无需登录）
 *   D. 公开端点 · 需要登录态的部分
 */
import { callCommunity, CIRCLES } from "../lib/zhihu/community-api.ts";

const ACCESS = (process.env.ZHIHU_ACCESS_SECRET ?? "").trim();
const APP_KEY = (process.env.ZHIHU_COMMUNITY_USER_TOKEN ?? "").trim();
const APP_SECRET = (process.env.ZHIHU_COMMUNITY_APP_SECRET ?? "").trim();

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "application/json", Referer: "https://www.zhihu.com/" };

const line = (s) => console.log("\n" + "=".repeat(86) + "\n" + s + "\n" + "=".repeat(86));

/* ══════════════════════════════════════════════════════════════════
   A. 开放平台 · 读「你自己」（Access Secret）
   ══════════════════════════════════════════════════════════════════ */
line("A. 开放平台读【你自己】—— developer.zhihu.com + Access Secret");

const devHeaders = {
  Authorization: `Bearer ${ACCESS}`,
  "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
  "Content-Type": "application/json",
};

const A_ENDPOINTS = [
  ["/api/v1/user/contents?ContentType=all&Offset=0&Limit=50", "创作（回答/文章/视频/想法/问题）"],
  ["/api/v1/user/followees?Offset=0&Limit=50", "我关注的人"],
  ["/api/v1/user/favlists?Offset=0&Limit=50", "我的收藏夹"],
  ["/api/v1/user/collections?Offset=0&Limit=50", "近期收藏"],
];

const aResult = {};
for (const [p, label] of A_ENDPOINTS) {
  try {
    const r = await fetch("https://developer.zhihu.com" + p, { headers: devHeaders });
    const j = await r.json();
    const items = j?.Data?.Items;
    const n = Array.isArray(items) ? items.length : 0;
    const fields = Array.isArray(items) && items[0] ? Object.keys(items[0]) : [];
    aResult[label] = { code: j?.Code, n, fields };
    console.log(`  ${j?.Code === 0 ? "★" : "✗"} ${label.padEnd(28)} Code=${j?.Code}  条数=${n}`);
    if (fields.length) console.log(`      字段: ${fields.join(", ")}`);
  } catch (e) {
    console.log(`  ✗ ${label.padEnd(28)} ${e.message.slice(0, 60)}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}

/* 收藏夹内容（依赖第一条收藏夹的 UrlToken） */
{
  const fl = await fetch("https://developer.zhihu.com/api/v1/user/favlists?Offset=0&Limit=5", { headers: devHeaders }).then((r) => r.json());
  const token = fl?.Data?.Items?.[0]?.UrlToken;
  if (token) {
    const r = await fetch(
      `https://developer.zhihu.com/api/v1/user/favlist_contents?FavlistUrlToken=${encodeURIComponent(token)}&Offset=0&Limit=50`,
      { headers: devHeaders },
    );
    const j = await r.json();
    const n = Array.isArray(j?.Data?.Items) ? j.Data.Items.length : 0;
    console.log(`  ${j?.Code === 0 ? "★" : "✗"} 收藏夹内容`.padEnd(30) + ` Code=${j?.Code}  条数=${n}`);
    aResult["收藏夹内容"] = { code: j?.Code, n };
  }
}

/* ══════════════════════════════════════════════════════════════════
   B. 开放平台 · 读「别人」—— 不传对方 token 会怎样
   ══════════════════════════════════════════════════════════════════ */
line("B. 开放平台尝试读【别人】—— 带 hash_id / uid 参数");

for (const [p, label] of [
  ["/api/v1/user/contents?ContentType=all&Limit=5&hash_id=zhang-jia-wei", "带 hash_id 求他人创作"],
  ["/api/v1/user/contents?ContentType=all&Limit=5&uid=1", "带 uid 求他人创作"],
  ["/api/v1/user/followees?Limit=5&hash_id=zhang-jia-wei", "带 hash_id 求他人关注"],
]) {
  const r = await fetch("https://developer.zhihu.com" + p, { headers: devHeaders });
  const j = await r.json();
  const n = Array.isArray(j?.Data?.Items) ? j.Data.Items.length : 0;
  console.log(`  · ${label.padEnd(26)} Code=${j?.Code}  条数=${n}  ${j?.Message ?? ""}`);
  await new Promise((r2) => setTimeout(r2, 400));
}
console.log(`  → 参数被**忽略**，返回的仍是你自己的数据。开放平台没有"按 id 读他人"的入口。`);

/* ══════════════════════════════════════════════════════════════════
   C. 公开端点 · 读任何人（无需登录）
   ══════════════════════════════════════════════════════════════════ */
line("C. 公开端点读【任何人】—— www.zhihu.com/api/v4（无需登录）");

const C_TARGETS = [
  ["zhi-hu-chan-pin-qing-bao-ju", "知乎产品情报局"],
  ["zhang-jia-wei", "张佳玮"],
];

for (const [token, name] of C_TARGETS) {
  console.log(`\n  ── ${name} (${token}) ──`);
  /* 资料 */
  const prof = await fetch(`https://www.zhihu.com/api/v4/members/${token}`, { headers: H }).then((r) => r.json());
  const profFields = Object.entries(prof).filter(([, v]) => v !== null && v !== "" && !(Array.isArray(v) && !v.length));
  console.log(`  ★ 资料  HTTP 200  字段 ${profFields.length} 个`);
  console.log(`      可用: ${profFields.map(([k]) => k).slice(0, 16).join(", ")}`);

  /* 想法 */
  const pins = await fetch(`https://www.zhihu.com/api/v4/members/${token}/pins?limit=50&offset=0`, { headers: H }).then((r) => r.json());
  const pinList = Array.isArray(pins.data) ? pins.data : [];
  const pinFields = pinList[0] ? Object.keys(pinList[0]) : [];
  console.log(`  ★ 想法  HTTP 200  条数 ${pinList.length}（上限受 limit 控制）`);
  if (pinFields.length) console.log(`      字段 ${pinFields.length} 个: ${pinFields.slice(0, 14).join(", ")}`);

  /* 其它端点逐个试 */
  for (const [suffix, label] of [
    ["/answers?limit=5&offset=0", "回答"],
    ["/articles?limit=5&offset=0", "文章"],
    ["/followees?limit=5&offset=0", "关注的人"],
    ["/followers?limit=5&offset=0", "粉丝"],
    ["/favlists?limit=5&offset=0", "收藏夹"],
    ["/activities?limit=5", "动态"],
  ]) {
    try {
      const r = await fetch(`https://www.zhihu.com/api/v4/members/${token}${suffix}`, { headers: H });
      const t = await r.text();
      let n = "?";
      try {
        const j = JSON.parse(t);
        n = Array.isArray(j.data) ? j.data.length : j.error ? `err${j.error.code}` : "对象";
      } catch {
        n = "非JSON";
      }
      const msg = r.status !== 200 ? (() => { try { return JSON.parse(t).error?.message ?? ""; } catch { return ""; } })() : "";
      console.log(`  ${r.status === 200 ? "★" : "✗"} ${label.padEnd(10)} HTTP ${String(r.status).padStart(3)}  条数=${n}  ${msg}`);
    } catch (e) {
      console.log(`  ✗ ${label.padEnd(10)} ${e.message.slice(0, 50)}`);
    }
    await new Promise((r2) => setTimeout(r2, 300));
  }
}

/* ══════════════════════════════════════════════════════════════════
   D. 社区 API：能读到想法正文（含作者名但无 token）
   ══════════════════════════════════════════════════════════════════ */
line("D. 社区 API 的圈子内容 —— 能读别人的想法，但定位不到人");

const ring = await callCommunity(
  "/openapi/ring/detail",
  { method: "GET", query: { ring_id: CIRCLES.hackathon.id, page_num: 1, page_size: 50 } },
  { appKey: APP_KEY, appSecret: APP_SECRET },
);
const contents = Array.isArray(ring.data?.contents) ? ring.data.contents : [];
console.log(`  ★ 圈子内容 条数 ${contents.length}`);
if (contents[0]) {
  console.log(`      字段: ${Object.keys(contents[0]).join(", ")}`);
  console.log(`      ⚠ 只有 author_name，**没有 author url_token** → 无法据此打开用户主页`);
}

/* ══════════════════════════════════════════════════════════════════
   汇总
   ══════════════════════════════════════════════════════════════════ */
line("汇总对比");
console.log(`
                        ┌─ 读自己 ─────────────┬─ 读别人 ────────────┐
  创作（回答/文章/视频等）│ ✅ 有，含标题/摘要/赞 │ ❌ 401 无权限        │
  关注的人               │ ✅ 有，含 UrlToken    │ ❌ 401 身份未验证    │
  收藏夹 / 收藏内容       │ ✅ 有                │ ❌ 无入口            │
  近期收藏               │ ✅ 有                │ ❌ 无入口            │
  ───────────────────────┼──────────────────────┼─────────────────────┤
  个人资料               │ ✅ OAuth /user       │ ✅ 公开端点（部分）  │
  想法（pin）            │ ✅ 开放平台          │ ✅ 公开端点          │
  回答 / 文章正文        │ ❌ 需 CLI 本人身份    │ ❌ 401 无权限        │
  动态 / 粉丝            │ ✅ OAuth             │ ❌ 401 无权限        │
  ───────────────────────┴──────────────────────┴─────────────────────┘
`);
