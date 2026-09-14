/**
 * 探测知乎公开网页端 API（www.zhihu.com/api/v4/*）能读到什么。
 *
 * 背景：官方开放平台只能读「自己」的数据，读别人必须对方授权。
 * 用户要求拿真实的高曝光用户数据，所以只能走**公开可见**的数据。
 *
 * 候选端点（知乎网页自己用的）：
 *   GET /api/v4/members/{url_token}                 用户资料
 *   GET /api/v4/members/{url_token}/answers         回答列表
 *   GET /api/v4/members/{url_token}/articles        文章列表
 *   GET /api/v4/members/{url_token}/pins            想法列表
 *   GET /api/v4/members/{url_token}/followees       关注的人
 *   GET /api/v4/members/{url_token}/followers       粉丝
 *
 * 先试「你自己的关注对象」（UrlToken 已知），因为那是确凿的真实账号。
 * 全部 GET，不写任何数据。若返回 403/需要登录，就如实记录、不硬闯。
 */

const candidates = [
  { token: "zhi-hu-chan-pin-qing-bao-ju", note: "知乎产品情报局（你关注的人）" },
  { token: "zhi-hu-ri-bao", note: "知乎日报（你关注的人）" },
];

const ENDPOINTS = [
  ["", "用户资料"],
  ["/answers?limit=5&offset=0&sort_by=created", "回答"],
  ["/articles?limit=5&offset=0", "文章"],
  ["/pins?limit=5&offset=0", "想法"],
  ["/followees?limit=5&offset=0", "关注的人"],
];

const HEADERS = {
  /* 知乎网页端的 UA，表明是普通浏览器访问公开页面 */
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Referer: "https://www.zhihu.com/",
};

console.log("探测知乎公开端点（www.zhihu.com/api/v4）");
console.log("=".repeat(84));

for (const c of candidates) {
  console.log(`\n### ${c.note}  (${c.token})`);
  for (const [suffix, label] of ENDPOINTS) {
    const url = `https://www.zhihu.com/api/v4/members/${c.token}${suffix}`;
    try {
      const r = await fetch(url, { headers: HEADERS, redirect: "manual" });
      const text = await r.text();
      let summary = text.slice(0, 120).replace(/\s+/g, " ");
      let count = "?";
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j.data)) count = j.data.length;
        else if (j.data) count = "对象";
        else if (j.error) summary = `error: ${JSON.stringify(j.error).slice(0, 90)}`;
      } catch {
        summary = text.slice(0, 90).replace(/\s+/g, " ");
      }
      const mark = r.status === 200 ? "★" : "✗";
      console.log(`  ${mark} ${label.padEnd(10)} HTTP ${String(r.status).padStart(3)}  条数=${count}  ${summary.slice(0, 100)}`);
    } catch (e) {
      console.log(`  ✗ ${label.padEnd(10)} 请求失败 ${e.message.slice(0, 60)}`);
    }
  }
}

console.log(`\n${"=".repeat(84)}`);
console.log("判读：");
console.log("  ★ 200 且有数据 → 可读，能用来做人格蒸馏");
console.log("  ✗ 403/401      → 需要登录态，不硬闯");
