#!/usr/bin/env node
/**
 * 知乎数据同步验证（打真实开放平台接口）。
 *
 * 用真实 Access Secret 走服务端路由，验证：
 *   · 五源接口能取到数据
 *   · 标签被并入 Persona（并集，不覆盖已有）
 *   · PersonaEvidence 写了出处（可解释性）
 *   · PersonaSource 被标记为已注入
 *   · **响应体里不含任何凭证**
 *   · 只允许同步自己的 Persona
 *
 * 注意：这会**真的写入数据库**（合并标签、写证据）。
 * 合并本身是幂等的（并集），重复跑不会累积重复标签。
 *
 * 用法：node --env-file=.env scripts/verify-zhihu-sync.mjs [BASE]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("知乎数据同步验证（真实接口）");
console.log("=".repeat(80));

try {
  /* 用 demo 人设。
     同步接口会校验「只能同步自己的 Persona」，所以必须**先建立会话**，
     否则 resolveIdentity() 认不出身份 → 403。
     用 findUnique 取 demo 的人设，保证与接口解析出的身份一致。 */
  const demoUser = await prisma.user.findUnique({
    where: { username: "demo" },
    include: { persona: true },
  });
  const me = demoUser?.persona;
  if (!me) throw new Error("找不到 demo 用户的人设");

  const loginResp = await fetch(`${BASE}/api/auth/demo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: new URL(BASE).origin },
    body: "{}",
  });
  const setCookie = loginResp.headers.get("set-cookie") ?? "";
  const sessionToken = (setCookie.match(/zhiyu_session=([^;]+)/) || [])[1] ?? "";
  if (!sessionToken) throw new Error(`演示登录未返回会话：HTTP ${loginResp.status}`);
  /* 带上 Origin：状态变更接口有 CSRF 同源校验（lib/auth/csrf.ts），
     不带来源的裸请求会被 403；浏览器同源请求一定会带 Origin。 */
  const authHeaders = {
    Cookie: `zhiyu_session=${sessionToken}`,
    origin: new URL(BASE).origin,
  };
  console.log(`会话已建立（personaId=${me.id.slice(0, 12)}…）\n`);

  /* ① 状态查询 */
  const status = await fetch(`${BASE}/api/zhihu/sync?personaId=${me.id}`, {
    headers: authHeaders,
  }).then((r) => r.json());
  rec("GET /api/zhihu/sync 报告凭证已配置", status.configured === true, JSON.stringify(status));

  /* 固定初始状态：把标签收敛到一组基线。
     否则重复跑时标签已在库里，"新增"必然为空 —— 那是测试不可重复，不是功能问题。 */
  const BASE_INTERESTS = ["技术伦理", "长文阅读", "写作", "效率工具", "播客"];
  const BASE_TOPICS = ["自我成长", "长期主义", "系统思维"];
  await prisma.persona.update({
    where: { id: me.id },
    data: { interests: BASE_INTERESTS, topics: BASE_TOPICS },
  });

  const before = { interests: BASE_INTERESTS, topics: BASE_TOPICS };
  const evidenceBefore = await prisma.personaEvidence.count({
    where: { personaId: me.id, source: "zhihu" },
  });

  /* ② 触发同步 */
  const resp = await fetch(`${BASE}/api/zhihu/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ personaId: me.id }),
  });
  const raw = await resp.text();
  const r = JSON.parse(raw);

  rec("POST /api/zhihu/sync 返回 200", resp.status === 200, `HTTP ${resp.status}`);
  rec("同步成功", r.ok === true, r.error ?? "");
  rec("响应标明用的是哪套身份", typeof r.identity === "string",
    `identity=${r.identity}（access-secret-owner=读自己账号；oauth-user=读授权用户）`);

  /* 关键：响应里不能有凭证 */
  const secret = (process.env.ZHIHU_ACCESS_SECRET ?? "").trim();
  const appKey = (process.env.ZHIHU_OAUTH_APP_KEY ?? "").trim();
  rec("响应体不含 Access Secret / App Key",
    (secret ? !raw.includes(secret) : true) && (appKey ? !raw.includes(appKey) : true),
    `响应长度 ${raw.length}`);

  /* ③ 取数结果 */
  const c = r.counts ?? {};
  const total = (c.contents ?? 0) + (c.followees ?? 0) + (c.favlists ?? 0) + (c.favlistContents ?? 0);
  rec("至少取到一条数据（凭证确实有效）", total > 0,
    `创作 ${c.contents ?? 0} / 关注 ${c.followees ?? 0} / 收藏夹 ${c.favlists ?? 0} / 收藏内容 ${c.favlistContents ?? 0}`);
  rec("取到了创作内容", (c.contents ?? 0) > 0, `${c.contents} 条`);
  rec("取到了关注列表", (c.followees ?? 0) > 0, `${c.followees} 人`);
  rec("创作样本带标题与点赞数",
    (r.samples ?? []).length > 0 && r.samples.every((s) => s.title.length > 0),
    r.samples?.[0]?.title?.slice(0, 50) ?? "");
  rec("部分接口失败被如实记录（不吞掉）", Array.isArray(r.errors), `errors=${JSON.stringify(r.errors)}`);

  /* ④ 落库：标签并入 */
  const after = await prisma.persona.findUnique({ where: { id: me.id } });
  const afterInterests = Array.isArray(after.interests) ? after.interests : [];
  const afterTopics = Array.isArray(after.topics) ? after.topics : [];

  rec("interests 未被覆盖（原有标签都还在）",
    before.interests.every((x) => afterInterests.includes(x)),
    `原 ${before.interests.length} → 现 ${afterInterests.length}`);
  rec("topics 未被覆盖（原有标签都还在）",
    before.topics.every((x) => afterTopics.includes(x)),
    `原 ${before.topics.length} → 现 ${afterTopics.length}`);
  rec("interests 确实新增了知乎来的标签",
    afterInterests.length > before.interests.length,
    `新增：${(r.addedInterests ?? []).slice(0, 6).join(" / ")}`);
  rec("topics 确实新增了内容类型标签",
    afterTopics.length > before.topics.length,
    `新增：${(r.addedTopics ?? []).slice(0, 6).join(" / ")}`);
  rec("标签无重复（并集去重生效）",
    afterInterests.length === new Set(afterInterests).size &&
      afterTopics.length === new Set(afterTopics).size);

  /* ⑤ 可解释性：证据落库 */
  const evidenceAfter = await prisma.personaEvidence.count({
    where: { personaId: me.id, source: "zhihu" },
  });
  rec("写入 PersonaEvidence 作为出处", evidenceAfter > evidenceBefore,
    `${evidenceBefore} → ${evidenceAfter} 条`);
  /* 注意：PersonaEvidence **没有 createdAt 字段**，所以不能按时间排序 */
  const sample = await prisma.personaEvidence.findFirst({
    where: { personaId: me.id, source: "zhihu" },
  });
  rec("证据带 note 与 url", Boolean(sample?.note),
    `${sample?.note?.slice(0, 40)} / ${sample?.url?.slice(0, 40)}`);

  /* ⑥ 源被标记已注入 */
  const src = await prisma.personaSource.findUnique({
    where: { personaId_type: { personaId: me.id, type: "zhihu" } },
  });
  rec("PersonaSource 标记为 injected", src?.status === "injected", `status=${src?.status}`);
  rec("源 meta 记录了各接口条数", Boolean(src?.meta), JSON.stringify(src?.meta));

  /* ⑦ 幂等：再同步一次不应产生重复标签 */
  const beforeSecond = afterInterests.length;
  const r2 = await fetch(`${BASE}/api/zhihu/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({ personaId: me.id }),
  }).then((x) => x.json());
  const afterSecond = await prisma.persona.findUnique({ where: { id: me.id } });
  const interests2 = Array.isArray(afterSecond.interests) ? afterSecond.interests : [];
  rec("重复同步不累积重复标签（幂等）",
    interests2.length === beforeSecond && interests2.length === new Set(interests2).size,
    `${beforeSecond} → ${interests2.length}；第二次 addedInterests=${(r2.addedInterests ?? []).length}`);

  /* ⑧ 入参校验 */
  const bad = await fetch(`${BASE}/api/zhihu/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({}),
  });
  rec("缺 personaId 返回 400", bad.status === 400, `HTTP ${bad.status}`);

  /* ⑨ 越权保护：不能同步别人的 Persona */
  const otherPersona = await prisma.persona.findFirst({
    where: { id: { startsWith: "zhihu-" } },
    select: { id: true },
  });
  if (otherPersona) {
    const forbidden = await fetch(`${BASE}/api/zhihu/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ personaId: otherPersona.id }),
    });
    rec("不能同步别人的 Persona（返回 403）", forbidden.status === 403,
      `HTTP ${forbidden.status}`);
  }
} catch (e) {
  console.error("测试异常:", e.message);
  fail += 1;
} finally {
  await prisma.$disconnect();
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
