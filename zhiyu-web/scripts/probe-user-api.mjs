/**
 * 用真实 Access Secret 调四个用户数据接口，验证凭证有效性与响应结构。
 *
 * 只读、只取少量数据（Limit=3），不写库、不打印任何凭证。
 * 收藏夹内容依赖第一条收藏夹的 UrlToken，按官方说明连锁调用。
 *
 * 用法：node --env-file=.env scripts/probe-user-api.mjs
 */
import {
  callUserEndpoint,
  fetchContents,
  itemsOf,
} from "../lib/zhihu/user-api.ts";

const accessSecret = (process.env.ZHIHU_ACCESS_SECRET ?? "").trim();
if (!accessSecret) {
  console.error("未配置 ZHIHU_ACCESS_SECRET");
  process.exit(1);
}
console.log(`Access Secret 已配置（长度 ${accessSecret.length}），开始探测四个接口\n`);

const opts = { accessSecret };

/* ① 用户内容 */
let firstFavToken = "";
try {
  const items = await fetchContents(opts, 3);
  console.log(`① 用户创作：拿到 ${items.length} 条`);
  for (const it of items) {
    console.log(`   [${it.contentType}] ${it.title.slice(0, 40)} | 赞 ${it.likeCount} 评 ${it.commentCount}`);
    if (it.summary) console.log(`     摘要：${it.summary.slice(0, 60)}`);
  }
  if (!items.length) console.log("   （空数据 —— 该账号在这类内容下没有公开创作）");
} catch (e) {
  console.log(`① 用户创作：失败 —— ${e.message}`);
}

/* ② 用户关注 */
{
  const r = await callUserEndpoint("followees", { Offset: 0, Limit: 3 }, opts);
  const items = itemsOf(r.data);
  console.log(`\n② 用户关注：${r.ok ? `拿到 ${items.length} 条` : `失败 ${r.error}`}`);
  for (const x of items.slice(0, 3)) {
    const name = x.Name ?? x.Fullname ?? x.Title ?? "(无名)";
    console.log(`   ${String(name).slice(0, 30)} | ${String(x.Headline ?? "").slice(0, 40)}`);
  }
  if (r.ok && !items.length) console.log("   （空数据）");
  if (!r.ok) console.log(`   原始响应前 200 字：${JSON.stringify(r.data).slice(0, 200)}`);
}

/* ③ 收藏夹列表 */
{
  const r = await callUserEndpoint("favlists", { Offset: 0, Limit: 3 }, opts);
  const items = itemsOf(r.data);
  console.log(`\n③ 收藏夹：${r.ok ? `拿到 ${items.length} 个` : `失败 ${r.error}`}`);
  for (const x of items) {
    console.log(`   ${String(x.Title ?? "").slice(0, 30)} | 条目 ${x.ItemCount ?? "?"} | Token ${String(x.UrlToken ?? "").slice(0, 12)}…`);
  }
  if (items[0]?.UrlToken) firstFavToken = String(items[0].UrlToken);
  if (r.ok && !items.length) console.log("   （无收藏夹 —— 官方说明这算空数据，不算失败）");
  if (!r.ok) console.log(`   原始响应前 200 字：${JSON.stringify(r.data).slice(0, 200)}`);
}

/* ④ 收藏夹内容（依赖 ③ 的 UrlToken） */
if (firstFavToken) {
  const r = await callUserEndpoint(
    "favlist_contents",
    { FavlistUrlToken: firstFavToken, Offset: 0, Limit: 3 },
    opts,
  );
  const items = itemsOf(r.data);
  console.log(`\n④ 收藏内容：${r.ok ? `拿到 ${items.length} 条` : `失败 ${r.error}`}`);
  for (const x of items.slice(0, 3)) {
    console.log(`   ${String(x.Title ?? x.Content ?? "").slice(0, 50)}`);
  }
} else {
  console.log("\n④ 收藏内容：跳过（没有收藏夹，拿不到 UrlToken）");
}

/* ⑤ 近期收藏 */
{
  const r = await callUserEndpoint("collections", { Offset: 0, Limit: 3 }, opts);
  const items = itemsOf(r.data);
  console.log(`\n⑤ 近期收藏：${r.ok ? `拿到 ${items.length} 条` : `失败 ${r.error}`}`);
  if (!r.ok) console.log(`   原始响应前 200 字：${JSON.stringify(r.data).slice(0, 200)}`);
}

console.log("\n探测结束。以上均为只读调用，未写入任何数据。");
