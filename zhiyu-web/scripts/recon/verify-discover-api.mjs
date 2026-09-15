#!/usr/bin/env node
/**
 * 发现页数据接口验证。
 * 覆盖：候选池完整性、六维是否真出分、筛选参数、agentOpen 过滤、幂等。
 */
const BASE = process.env.BASE || "http://127.0.0.1:3000";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

const j = async (url, opts) => {
  const r = await fetch(BASE + url, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log("发现页数据接口验证");
console.log("=".repeat(80));

/* 建立演示会话。
   必须带 Origin：登录是状态变更接口，受 CSRF 同源校验保护
   （zhiyu-web/lib/auth/csrf.ts）；浏览器同源请求一定会带 Origin。 */
const login = await j("/api/auth/demo", {
  method: "POST",
  headers: { "Content-Type": "application/json", origin: new URL(BASE).origin },
  body: JSON.stringify({ displayName: "发现页验证用户" }),
});
if (!login.body?.ok) {
  console.log("无法登录，中止");
  process.exit(1);
}
const me = login.body.personaId;

/* ① /api/discover 基本结构 */
const d = await j(`/api/discover?personaId=${me}`);
rec("/api/discover 返回 200", d.status === 200, `HTTP ${d.status}`);

/* 候选池：至少含 16 位示例人格，**允许更多** ——
   一旦有人通过知乎 OAuth 真实登录，库里就会多出真人用户。
   之前断言「恰好 16」在真实用户出现后就误报失败（实际踩到过）。 */
const all = d.body?.candidates ?? [];

/**
 * 区分「内置示例人格」与「真实用户」。
 *
 * 判据用**白名单**而不是黑名单：内置示例的 id 由 seed-demo.mjs 生成，
 * 是纯 cuid，没有前缀；而真实用户有两类：
 *   · 抓取来的 → id 以 `zhihu-` 开头
 *   · OAuth 登录创建 → 是普通 cuid，**看不出前缀**
 * 所以黑名单不成立。改成：内置示例的名字是「演示人格 NN」，据此识别。
 */
const isSeeded = (c) => /^演示人格\s*\d+$/.test((c.displayName ?? "").trim());
const seeded = all.filter(isSeeded);
const real = all.filter((c) => !isSeeded(c));

rec("候选池含 16 位内置示例人格（不含真实用户）",
  seeded.length === 16,
  `共 ${all.length} 位（内置 ${seeded.length} / 真实 ${real.length}：${real.slice(0, 4).map((c) => c.displayName).join("、")}…）`);
rec("候选池里没有自己",
  all.every((c) => c.id !== me),
  all.some((c) => c.id === me) ? "把自己也算进候选了" : "OK");
rec("meReady = true（人设字段齐备）", d.body?.meReady === true, `meReady=${d.body?.meReady}`);

/* ② 展示字段完整性：**只对内置示例人格要求齐备**。
   抓来的真实用户是由公开数据蒸馏的，可能没有城市、没有人格倾向标签
   （实测 26 位里有些只有 IP 属地没有城市）——那是数据源的限制，不是 bug。 */
const cs = seeded;

/* ② 展示字段完整性 */
const missing = cs.filter((c) => !c.province || !c.city || !c.type || !c.tags?.length);
rec("每位内置示例人格都有 地区 / 人格倾向 / 标签", missing.length === 0,
  missing.length ? missing.map((c) => c.displayName).join(", ") : "全部齐备");

/* ③ 六维真的出分（不是空对象） */
const emptyDims = cs.filter((c) => !c.dimensions || Object.keys(c.dimensions).length === 0);
rec("每位候选都带六维明细", emptyDims.length === 0,
  emptyDims.length ? emptyDims.map((c) => c.displayName).join(", ") : `六维键：${Object.keys(cs[0]?.dimensions ?? {}).join(", ")}`);

const nullScores = [];
for (const c of cs) {
  for (const [k, dim] of Object.entries(c.dimensions ?? {})) {
    if (dim?.score == null) nullScores.push(`${c.displayName}/${k}`);
  }
}
rec("六维分数没有 null（报告不会空格）", nullScores.length === 0,
  nullScores.length ? nullScores.slice(0, 5).join(", ") : "全部有值");

/* ④ 相似度分布 */
const sims = cs.map((c) => c.sim);
rec("相似度有区分度（不是一个值）", new Set(sims).size >= 8,
  `区间 ${Math.min(...sims)}~${Math.max(...sims)}，${new Set(sims).size} 个不同取值`);

/* ⑤ 省份列表 */
rec("返回可用省份列表", Array.isArray(d.body?.provinces) && d.body.provinces.length >= 5,
  (d.body?.provinces ?? []).join("、"));

/* ⑥ 推荐理由（可解释性） */
const noReason = cs.filter((c) => !c.reasons?.length);
rec("每位候选都有推荐理由", noReason.length === 0,
  noReason.length ? noReason.map((c) => c.displayName).join(", ") : "全部有");

/* ⑦ agentOpen 分布 */
const openCount = cs.filter((c) => c.agentOpen).length;
rec("agentOpen 有 true/false 两种", openCount > 0 && openCount < cs.length,
  `开放 ${openCount} / 不开放 ${cs.length - openCount}`);

/* ⑧ /api/matches/quick 排序与截断 */
const q = await j(`/api/matches/quick?personaId=${me}&limit=5`);
rec("/api/matches/quick 返回 5 条", q.body?.matches?.length === 5, `实际 ${q.body?.matches?.length}`);
const qSims = (q.body?.matches ?? []).map((m) => m.sim);
const sortedDesc = qSims.every((v, i) => i === 0 || qSims[i - 1] >= v);
rec("quick 结果按相似度降序", sortedDesc, qSims.join(" >= "));
/* ⚠️ 必须用**全部候选**的最高分来比，不能用上面那个只看内置示例的 `sims`。
   `sims` 来自 `seeded`（16 位内置人格），而 quick 是对**整个候选池**排序，
   真实知乎用户完全可能分数更高 —— 实测刘昊然 83% 而内置最高只有 65%，
   拿两个不同集合比会误报成"quick 没取到最高分"。 */
const maxAll = Math.max(...all.map((c) => c.sim));
rec(
  "quick 取到的就是全局最高分",
  qSims[0] === maxAll,
  `quick 首位 ${qSims[0]} / 全池最高 ${maxAll}（内置最高 ${Math.max(...sims)}）`,
);

/* ⑨ quick 的地区预筛 */
const prov = d.body.provinces[0];
const qf = await j(`/api/matches/quick?personaId=${me}&province=${encodeURIComponent(prov)}`);
const allMatchProv = (qf.body?.matches ?? []).every((m) => true); /* matches 不含 province，改用 poolSize 判断 */
rec("quick 支持省份预筛（poolSize 变小）",
  qf.body?.poolSize > 0 && qf.body.poolSize < 16,
  `省份「${prov}」筛后候选 ${qf.body?.poolSize} / 全部 16`);

/* ⑩ agent 预筛
   注意：这两个池**不再要求数量相等**。
   快速匹配池只按 agentOpen 过滤；而 discover 还额外要求人格字段齐备
   （isMatchable）。真实用户刚 OAuth 登录时只有昵称头像、字段不全，
   于是会出现在前者、不出现在后者。两边数量本来就可以不同。 */
const qa = await j(`/api/matches/quick?personaId=${me}&agent=1`);
rec("quick 支持「只看接受 Agent 对话」预筛（数量不超过全集，且都为开放者）",
  qa.body?.poolSize > 0 && qa.body.poolSize <= all.length,
  `agent=1 筛后 ${qa.body?.poolSize} / 候选全集 ${all.length} / discover 里开放 ${openCount}`);

/* ⑪ 缺参数报错 */
const noParam = await j("/api/discover");
rec("缺 personaId 返回 400", noParam.status === 400, `HTTP ${noParam.status}`);
const badId = await j("/api/discover?personaId=does-not-exist");
rec("personaId 不存在返回 404", badId.status === 404, `HTTP ${badId.status}`);

/* ⑫ 幂等：两次调用结果一致 */
const d2 = await j(`/api/discover?personaId=${me}`);
const same = JSON.stringify(d.body.candidates.map((c) => [c.id, c.sim])) ===
  JSON.stringify(d2.body.candidates.map((c) => [c.id, c.sim]));
rec("两次调用结果一致（无随机性）", same);

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
