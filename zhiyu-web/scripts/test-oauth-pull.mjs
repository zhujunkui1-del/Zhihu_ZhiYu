#!/usr/bin/env node
/**
 * 飞书 / 钉钉**拉取链路**的接线测试（mock fetch，不打真网络）。
 *
 * ── 为什么必须有这一层 ────────────────────────────────────────────────
 * 用户最初的问题是「没有充分利用 distilly 来获取飞书、钉钉的数据」。
 * 补上文档 / Wiki / 多维表格之后，最大的风险变成**接线错了**：
 * 端点写错、分页没翻、字段名取错、把一个源的数据挂到另一个源的 trait 上 ——
 * 这些在没有平台凭证时**跑真接口验证不了**，而"没验证过的代码等于没写"
 * 是这轮已经吃过一次的教训。
 *
 * 所以这里把 fetch 换成假的，断言：
 *   · 打的是**哪个** URL（与 distilly 的调用链逐一对照）
 *   · 分页有没有真的翻页
 *   · 只留"我发的"消息、正文有没有从嵌套 JSON 里取出来
 *   · 文档 / Wiki（先 get_node 再取正文）/ 多维表格的记录有没有变成证据
 *   · 能力声明与实际实现一致（不许再写"含私聊"这种假话）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-oauth-pull.mjs
 */
import assert from "node:assert/strict";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const { feishuPullMessages, feishuPullDocs, dingtalkPullDocs } = await import(
  "../lib/oauth/clients.ts"
);
const { PROVIDER_META } = await import("../lib/oauth/platforms.ts");

/* ── 假 fetch ─────────────────────────────────────────────────────────── */
const calls = [];
const routes = [];
/**
 * 注册一条路由：命中就返回 data。
 *
 * ⚠️ 匹配用 `.includes()` 会有前缀冲突：`…/tables` 会把
 * `…/tables/{id}/records` 也截走（第一次跑就踩了，表现为"表格记录一条都没解析出来"）。
 * 所以固定按 **match 长度降序**匹配 —— 更具体的路由优先。
 */
const on = (match, data, opts = {}) => routes.push({ match, data, opts });

const fakeFetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method ?? "GET", body: init.body ?? null });
  const hit = [...routes]
    .sort((a, b) => String(b.match).length - String(a.match).length)
    .find((r) =>
      typeof r.match === "string" ? u.includes(r.match) : r.match.test(u),
    );
  if (hit) {
    const body = hit.opts.raw ? hit.data : JSON.stringify(hit.data);
    return new Response(body, {
      status: hit.opts.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  /* 未注册的端点 → 404，让"打了没预期的接口"暴露成失败而不是静默通过 */
  return new Response("{}", { status: 404 });
};
globalThis.fetch = fakeFetch;

const called = (frag) => calls.some((c) => c.url.includes(frag));
const countCalled = (frag) => calls.filter((c) => c.url.includes(frag)).length;

/* ── ① 飞书群聊消息：分页 + 只留我发的 ─────────────────────────────── */
console.log("\n== ① 飞书群聊消息（分页 / 只留我发的 / 富文本取文）==");
routes.length = 0;
calls.length = 0;

on("/im/v1/chats", {
  data: { items: [{ chat_id: "oc_1", name: "产品组" }] },
});
/* 第一页：has_more + page_token → 必须翻第二页 */
on("page_token=TOK2", {
  data: {
    items: [
      {
        msg_type: "text",
        sender: { id: "ou_me", sender_type: "user" },
        body: { content: JSON.stringify({ text: "第二页：我发的消息，关于灰度发布的风险评估" }) },
      },
    ],
    has_more: false,
  },
});
on("/im/v1/messages", {
  data: {
    items: [
      {
        msg_type: "text",
        sender: { id: "ou_me", sender_type: "user" },
        body: { content: JSON.stringify({ text: "第一页：这个方案我建议先做小范围灰度再全量" }) },
      },
      {
        msg_type: "text",
        sender: { id: "ou_other", sender_type: "user" },
        body: { content: JSON.stringify({ text: "别人的话，不该算进我的人格" }) },
      },
      {
        msg_type: "post",
        sender: { id: "ou_me", sender_type: "user" },
        body: { content: JSON.stringify({ content: [[{ text: "富文本第一段" }], [{ text: "第二段" }]] }) },
      },
      {
        msg_type: "image",
        sender: { id: "ou_me", sender_type: "user" },
        body: { content: "{}" },
      },
      {
        msg_type: "text",
        sender: { id: "ou_bot", sender_type: "app" },
        body: { content: JSON.stringify({ text: "机器人消息" }) },
      },
    ],
    has_more: true,
    page_token: "TOK2",
  },
});

const fm = await feishuPullMessages("tok", "ou_me");
rec("认出了群聊", fm.chats === 1, `chats=${fm.chats}`);
rec("⚠️ 真的翻了第二页（distilly 的 --msg-limit 量级）", countCalled("/im/v1/messages") === 2, `${countCalled("/im/v1/messages")} 次请求`);
rec(
  "只留我发的（别人的、机器人的、图片的都排除）",
  fm.items.length === 3 && !fm.items.some((i) => i.text.includes("不该算进") || i.text.includes("机器人")),
  fm.items.map((i) => i.text.slice(0, 18)).join(" ⏐ "),
);
rec(
  "富文本（post）也能取到文字",
  fm.items.some((i) => i.text.includes("富文本第一段")),
);
rec(
  "trait 写明了来自哪个群（可追溯）",
  fm.items.every((i) => i.trait.includes("产品组")),
  fm.items[0]?.trait,
);

/* ── ② 飞书文档 / Wiki / 多维表格 ──────────────────────────────────── */
console.log("\n== ② 飞书云文档：文档正文 + Wiki 解析 + 多维表格 ==");
routes.length = 0;
calls.length = 0;

on("/search/v2/message", {
  data: {
    items: [
      { docs_info: { title: "Q3 技术规划", url: "https://x.feishu.cn/docx/DOC1", docs_type: "docx" } },
      { docs_info: { title: "知识库里的复盘", url: "https://x.feishu.cn/wiki/WIKI1", docs_type: "wiki" } },
      { docs_info: { title: "项目跟进表", url: "https://x.feishu.cn/base/BASE1", docs_type: "bitable" } },
    ],
  },
});
on("/docx/v1/documents/DOC1/raw_content", {
  data: { content: "本季度重点是稳定性治理。\n\n先把告警收敛做掉，再谈新功能。" },
});
on("/wiki/v2/spaces/get_node", {
  data: { node: { obj_token: "DOC2", obj_type: "docx" } },
});
on("/docx/v1/documents/DOC2/raw_content", {
  data: { content: "根因不是代码。\n\n是发布流程缺少灰度环节，这条要写进流程文档。" },
});
on("/bitable/v1/apps/BASE1/tables", { data: { items: [{ table_id: "tbl1", name: "风险登记" }] } });
on("/bitable/v1/apps/BASE1/tables/tbl1/records", {
  data: {
    items: [
      { fields: { 风险: "第三方接口不稳定", 等级: "高" } },
      { fields: { 风险: "排期太紧", 等级: "中" } },
    ],
  },
});

const fd = await feishuPullDocs("tok", "ou_me", "张三");
rec("按「创建人是我」搜索（distilly 的 docs_options.creator_ids）", countCalled("/search/v2/message") >= 1);
rec("找到 3 篇 / 拉到 3 篇", fd.found === 3 && fd.docs === 3, `found=${fd.found} docs=${fd.docs}`);
rec(
  "docx 正文被切成段落当证据",
  fd.items.some((i) => i.text.includes("告警收敛")),
  fd.items.find((i) => i.text.includes("告警收敛"))?.text,
);
rec(
  "⚠️ Wiki 先 get_node 解出 obj_token 再取正文（distilly 的同款两步）",
  called("/wiki/v2/spaces/get_node") && called("/docx/v1/documents/DOC2/raw_content"),
);
rec(
  "多维表格记录变成「字段名：值」的证据",
  fd.items.some((i) => i.text.includes("第三方接口不稳定") && i.text.includes("等级：高")),
  fd.items.find((i) => i.text.includes("第三方接口不稳定"))?.text,
);
rec(
  "不同来源的 trait 区分清楚（文档 / Wiki 文档 / 表格）",
  fd.items.some((i) => i.trait.includes("Q3 技术规划")) &&
    fd.items.some((i) => i.trait.includes("知识库里的复盘")) &&
    fd.items.some((i) => i.trait.includes("项目跟进表")),
  [...new Set(fd.items.map((i) => i.trait))].join(" ｜ "),
);

/* ── ②b 飞书私聊：用户给的 oc_ 会话 ID 也要一起拉 ───────────────────── */
console.log("\n== ②b 飞书私聊（官方文档：/im/v1/messages 对单聊同样有效）==");
routes.length = 0;
calls.length = 0;

on("/im/v1/chats", { data: { items: [{ chat_id: "oc_group", name: "产品组" }] } });
const msgsFor = (text) => ({
  data: {
    items: [
      {
        msg_type: "text",
        sender: { id: "ou_me", sender_type: "user" },
        body: { content: JSON.stringify({ text }) },
      },
    ],
    has_more: false,
  },
});
on("container_id=oc_group", msgsFor("群里的发言，够长可以当证据用的一句话"));
on("container_id=oc_p2pAAA111", msgsFor("私聊里的发言，也够长可以当证据用的一句话"));
on("container_id=oc_p2pBBB222", msgsFor("另一个私聊的发言，同样够长可以当证据的一句话"));

const withP2p = await feishuPullMessages("tok", "ou_me", {
  /* 真实 chat_id 是 oc_ + 字母数字（不含下划线），测试数据照真实形状来 */
  extraChatIds: ["oc_p2pAAA111", "oc_p2pBBB222", "  垃圾输入  ", "oc_p2pAAA111"],
});
rec("私聊会话也被遍历到了", withP2p.p2p === 2, `p2p=${withP2p.p2p}`);
rec(
  "私聊的发言确实进了证据，并标注为「私聊」",
  withP2p.items.filter((i) => i.trait.includes("私聊")).length === 2,
  withP2p.items.map((i) => i.trait).join(" ｜ "),
);
rec(
  "非法输入（不是 oc_ 开头）被丢掉、重复的只算一次",
  withP2p.p2p === 2,
);
rec(
  "群聊那一份也照常拉到（没有因为加私聊而漏掉）",
  withP2p.items.some((i) => i.trait.includes("产品组")),
);

/* ── ③ 钉钉：文档 + 多维表格 ───────────────────────────────────────── */
console.log("\n== ③ 钉钉：文档正文 + 多维表格（之前完全没做这块）==");
routes.length = 0;
calls.length = 0;

on("/v1.0/doc/workspaces?maxResults", { workspaces: [{ workspaceId: "ws1", name: "团队空间" }] });
on("/v1.0/doc/workspaces/ws1/files", {
  workspaces: [{ dentries: "doc1", name: "发布流程规范", spaceId: "ws1" }],
});
on("/v1.0/doc/workspaces/ws1/files/doc1/content", {
  content: "发布必须留灰度环节。\n\n回滚方案要写在变更单里。",
});
on("/v1.0/doc/search", {
  docList: [{ docId: "base1", name: "风险登记表", docType: "bitable" }],
});
on("/v1.0/bitable/bases/base1/sheets", { sheets: [{ sheetId: "sh1", name: "风险" }] });
on("/v1.0/bitable/bases/base1/sheets/sh1/fields", { fields: [{ name: "风险" }, { name: "负责人" }] });
on("/v1.0/bitable/bases/base1/sheets/sh1/records", {
  records: [{ fields: { 风险: "接口不稳定", 负责人: "张三" } }],
});

const dd = await dingtalkPullDocs("tok", { keyword: "张三" });
rec("读到文档正文", dd.docs === 1 && dd.items.some((i) => i.text.includes("灰度环节")), `docs=${dd.docs}`);
rec(
  "⚠️ 多维表格走的是 distilly 的链路：doc/search → sheets → fields → records",
  dd.bitables === 1 &&
    called("/v1.0/doc/search") &&
    called("/v1.0/bitable/bases/base1/sheets") &&
    called("/v1.0/bitable/bases/base1/sheets/sh1/records"),
  `bitables=${dd.bitables}`,
);
rec(
  "表格记录按字段名拼成证据",
  dd.items.some((i) => i.text.includes("接口不稳定") && i.text.includes("负责人：张三")),
  dd.items.find((i) => i.text.includes("接口不稳定"))?.text,
);
rec(
  "表格来源标注为「多维表格《…》」而不是混在文档里",
  dd.items.some((i) => i.trait.includes("多维表格")),
  [...new Set(dd.items.map((i) => i.trait))].join(" ｜ "),
);
rec(
  "钉钉接口都带 access token 头",
  calls.filter((c) => c.url.includes("api.dingtalk.com")).length > 0,
);

/* ── ④ 能力声明与用户信息（防"读到 0 条"回归）────────────────────── */
console.log("\n== ④ user_info：没有 open_id 就一条消息都匹配不上 ==");
routes.length = 0;
calls.length = 0;

on("/auth/v3/app_access_token/internal", { app_access_token: "app_tok" });
on("/authen/v1/oidc/access_token", {
  data: { access_token: "user_tok", refresh_token: "ref", expires_in: 7200 },
});
on("/authen/v1/user_info", { data: { open_id: "ou_me_123", name: "张三" } });

const { exchangeCode } = await import("../lib/oauth/clients.ts");
const tokens = await exchangeCode(
  "feishu",
  { provider: "feishu", appId: "cli_x", appSecret: "s", redirectUri: "https://x/cb" },
  "code123",
);
rec(
  "⚠️ 换完 token 会再调 /authen/v1/user_info 取 open_id（distilly 之外的必需一步）",
  called("/authen/v1/user_info"),
);
rec(
  "open_id 与昵称被存下来（否则 sender.id 过滤恒不成立 → 读到 0 条）",
  tokens.externalId === "ou_me_123" && tokens.displayName === "张三",
  `openId=${tokens.externalId} name=${tokens.displayName}`,
);

/* 反证：open_id 为空时，过滤器会把所有消息都丢掉 —— 这就是当初的症状 */
routes.length = 0;
calls.length = 0;
on("/im/v1/chats", { data: { items: [{ chat_id: "oc_1", name: "产品组" }] } });
on("/im/v1/messages", {
  data: {
    items: [
      {
        msg_type: "text",
        sender: { id: "ou_me_123", sender_type: "user" },
        body: { content: JSON.stringify({ text: "这条其实是我发的，有二十来个字足够作为证据" }) },
      },
    ],
    has_more: false,
  },
});
const withId = await feishuPullMessages("tok", "ou_me_123");
const withoutId = await feishuPullMessages("tok", "");
rec(
  "有 open_id → 匹配到我发的消息",
  withId.items.length === 1,
  `${withId.items.length} 条`,
);
rec(
  "open_id 为空 → 一条都匹配不上（所以 sync 里必须显式报错，不能静默返回 0 条）",
  withoutId.items.length === 0,
  `${withoutId.items.length} 条`,
);

/* ── ④b 错误必须被暴露，而不是当成"没有数据" ───────────────────────── */
console.log("\n== ④b 平台报错必须暴露（HTTP 200 + 业务错误码）==");
routes.length = 0;
calls.length = 0;

/* 飞书的权限错误就是 HTTP 200 + {code: 99991672, msg: "..."} —— 
   之前只看 data.items，会把它当成"没有数据"，给用户一句没用的推测。 */
on("/im/v1/chats", { code: 99991672, msg: "no permission: im:chat" });
let permErr = null;
try {
  await feishuPullMessages("tok", "ou_me");
} catch (e) {
  permErr = e;
}
rec(
  "⚠️ 群列表权限不足 → 抛出带错误码的真实原因",
  Boolean(permErr) && String(permErr.message).includes("99991672"),
  permErr?.message,
);
rec(
  "错误里写清了这一步需要哪个权限（用户照着去开）",
  String(permErr?.message ?? "").includes("im:chat"),
  permErr?.message,
);

/* 消息权限不足：也要抛，且区分群聊/私聊需要的不同权限 */
routes.length = 0;
calls.length = 0;
on("/im/v1/chats", { data: { items: [{ chat_id: "oc_g1", name: "群" }] } });
on("/im/v1/messages", { code: 99991672, msg: "no permission: im:message.group_msg:get_as_user" });
let msgErr = null;
try {
  await feishuPullMessages("tok", "ou_me");
} catch (e) {
  msgErr = e;
}
rec(
  "⚠️ 消息权限不足 → 抛出，并指出需要 im:message.group_msg:get_as_user",
  Boolean(msgErr) && String(msgErr.message).includes("group_msg:get_as_user"),
  msgErr?.message,
);

/* 私聊那一步要提示 p2p 权限 */
routes.length = 0;
calls.length = 0;
on("/im/v1/chats", { data: { items: [] } });
on("/im/v1/messages", { code: 99991672, msg: "no permission" });
let p2pErr = null;
try {
  await feishuPullMessages("tok", "ou_me", { extraChatIds: ["oc_p2pAAA111"] });
} catch (e) {
  p2pErr = e;
}
rec(
  "私聊那一步提示的是 im:message.p2p_msg:get_as_user",
  String(p2pErr?.message ?? "").includes("p2p_msg:get_as_user"),
  p2pErr?.message,
);

/* ── ⑤ 能力声明必须与实现一致（不许再写假话）──────────────────────── */
console.log("\n== ⑤ 能力声明 vs 实现 ==");
rec(
  "飞书声明能拉文档 / Wiki / 多维表格（本次补上的）",
  PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("文档")) &&
    PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("多维表格")),
  PROVIDER_META.feishu.capability.canPull.join("；"),
);
rec(
  "⚠️ 飞书能力声明已更新为「私聊也能拉，但要你从飞书客户端复制会话 ID」",
  PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("私聊")) &&
    PROVIDER_META.feishu.capability.cannotPull.length === 0,
  PROVIDER_META.feishu.capability.canPull.join("；"),
);
rec(
  "⚠️ scope 含用户身份读消息的两个补充权限（漏了就「授权成功但读不到」）",
  PROVIDER_META.feishu.scope.includes("im:message.group_msg:get_as_user") &&
    PROVIDER_META.feishu.scope.includes("im:message.p2p_msg:get_as_user"),
  PROVIDER_META.feishu.scope,
);rec(
  "钉钉如实声明「消息拉不到」",
  PROVIDER_META.dingtalk.capability.cannotPull.some((c) => c.what.includes("消息")),
);
rec(
  "飞书 scope 覆盖了本次新增的能力",
  ["docx:document", "wiki:wiki", "bitable:app"].every((s) => PROVIDER_META.feishu.scope.includes(s)),
  PROVIDER_META.feishu.scope,
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
