/**
 * 探查 hackathon_story 系列接口的完整数据。
 * 只读 GET。
 */
import { callCommunity } from "../lib/zhihu/community-api.ts";

const appKey = (process.env.ZHIHU_COMMUNITY_USER_TOKEN ?? "").trim();
const appSecret = (process.env.ZHIHU_COMMUNITY_APP_SECRET ?? "").trim();
const opts = { appKey, appSecret };

const list = await callCommunity("/openapi/hackathon_story/list", { method: "GET" }, opts);
if (!list.ok) {
  console.error("故事列表失败:", list.error);
  process.exit(1);
}

const arr = Array.isArray(list.data) ? list.data : [];
console.log(`共 ${arr.length} 个故事\n` + "=".repeat(88));

for (const s of arr) {
  console.log(`\n《${s.title}》`);
  console.log(`  work_id: ${s.work_id}`);
  console.log(`  标签: ${Array.isArray(s.labels) ? s.labels.join(" / ") : "—"}`);
  console.log(`  简介: ${String(s.description ?? "").slice(0, 90)}`);
  console.log(`  横版封面: ${String(s.artwork ?? "").slice(0, 70)}`);
  console.log(`  竖版封面: ${String(s.tab_artwork ?? "").slice(0, 70)}`);
}

/* 逐篇取详情，看结构与字数 */
console.log("\n" + "=".repeat(88));
console.log("各篇详情");
console.log("=".repeat(88));
for (const s of arr) {
  const d = await callCommunity(
    "/openapi/hackathon_story/detail",
    { method: "GET", query: { work_id: String(s.work_id) } },
    opts,
  );
  if (!d.ok) {
    console.log(`\n《${s.title}》  ✗ ${d.error}`);
    continue;
  }
  const x = d.data ?? {};
  console.log(`\n《${s.title}》 → ${x.chapter_name}`);
  console.log(`  作者: ${x.author_name}   标签: ${Array.isArray(x.labels) ? x.labels.join("/") : "—"}`);
  console.log(`  正文长度: ${String(x.content ?? "").length} 字`);
  console.log(`  导语: ${String(x.introduction ?? "").slice(0, 80)}`);
  console.log(`  正文开头: ${String(x.content ?? "").slice(0, 100).replace(/\n/g, " ")}`);
}
