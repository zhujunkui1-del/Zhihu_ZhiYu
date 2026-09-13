/**
 * 用真实凭证验证社区 API 的路径与签名（全部 GET，无写操作）。
 *
 * 依据：`知乎社区API快速开始.txt` 的接口页（用户从知乎站内扒下来的完整文档）。
 * 关键：前缀是 `/openapi/`，Base URL 是 `https://openapi.zhihu.com`。
 */
import { callCommunity, CIRCLES } from "../lib/zhihu/community-api.ts";

const appKey = (process.env.ZHIHU_COMMUNITY_USER_TOKEN ?? "").trim();
const appSecret = (process.env.ZHIHU_COMMUNITY_APP_SECRET ?? "").trim();
if (!appKey || !appSecret) {
  console.error("缺少 ZHIHU_COMMUNITY_USER_TOKEN 或 ZHIHU_COMMUNITY_APP_SECRET");
  process.exit(1);
}
const opts = { appKey, appSecret };

console.log("社区 API 真实路径验证（全部 GET）");
console.log("=".repeat(88));

let firstPinId = "";

/* ① 圈子详情：三个官方圈子都试 */
for (const c of Object.values(CIRCLES)) {
  const r = await callCommunity(
    "/openapi/ring/detail",
    { method: "GET", query: { ring_id: c.id, page_num: 1, page_size: 3 } },
    opts,
  );
  if (r.ok) {
    const d = r.data ?? {};
    const info = d.ring_info ?? {};
    const contents = Array.isArray(d.contents) ? d.contents : [];
    console.log(`\n★ ${c.name}`);
    console.log(
      `   圈子名: ${info.ring_name}  成员 ${info.membership_num}  讨论 ${info.discussion_num}`,
    );
    console.log(`   返回内容 ${contents.length} 条`);
    const first = contents[0];
    if (first) {
      console.log(`   首条: ${String(first.content ?? "").slice(0, 60)}`);
      console.log(
        `         作者 ${first.author_name}  赞 ${first.like_num}  评 ${first.comment_num}  pin_id ${first.pin_id}`,
      );
      if (!firstPinId && first.pin_id) firstPinId = String(first.pin_id);
    }
  } else {
    console.log(`\n✗ ${c.name}  失败: ${r.error}`);
    if (r.raw) console.log(`   raw: ${JSON.stringify(r.raw).slice(0, 180)}`);
  }
}

/* ② 评论列表 */
if (firstPinId) {
  const r = await callCommunity(
    "/openapi/comment/list",
    {
      method: "GET",
      query: { content_token: firstPinId, content_type: "pin", page_num: 1, page_size: 5 },
    },
    opts,
  );
  console.log(`\n${r.ok ? "★" : "✗"} 评论列表（pin ${firstPinId}）`);
  if (r.ok) {
    const d = r.data ?? {};
    const comments = Array.isArray(d.comments) ? d.comments : [];
    console.log(`   拿到 ${comments.length} 条，has_more=${d.has_more}`);
    for (const c of comments.slice(0, 3)) {
      console.log(
        `   · ${String(c.content ?? "").replace(/<[^>]*>/g, "").slice(0, 50)}  —— ${c.author_name}`,
      );
    }
  } else {
    console.log(`   ${r.error}`);
  }
} else {
  console.log("\n· 跳过评论列表：圈子里没有可用的 pin_id");
}

/* ③ 故事列表（黑客松专项开放） */
{
  const r = await callCommunity("/openapi/hackathon_story/list", { method: "GET" }, opts);
  console.log(`\n${r.ok ? "★" : "✗"} 故事概要列表`);
  if (r.ok) {
    const arr = Array.isArray(r.data) ? r.data : [];
    console.log(`   拿到 ${arr.length} 个故事`);
    for (const s of arr.slice(0, 5)) {
      const labels = Array.isArray(s.labels) ? s.labels.join("/") : "";
      console.log(`   · ${s.title}  [${labels}]  work_id=${s.work_id}`);
    }
  } else {
    console.log(`   ${r.error}`);
  }
}

/* ④ 故事详情 */
{
  const r = await callCommunity(
    "/openapi/hackathon_story/detail",
    { method: "GET", query: { work_id: "1644038836790169600" } },
    opts,
  );
  console.log(`\n${r.ok ? "★" : "✗"} 故事详情`);
  if (r.ok) {
    const d = r.data ?? {};
    console.log(
      `   《${d.chapter_name}》 作者 ${d.author_name}  正文 ${String(d.content ?? "").length} 字`,
    );
    console.log(`   导语: ${String(d.introduction ?? "").slice(0, 60)}`);
  } else {
    console.log(`   ${r.error}`);
  }
}

console.log("\n" + "=".repeat(88));
console.log("全部为只读 GET，未做任何写操作。");
