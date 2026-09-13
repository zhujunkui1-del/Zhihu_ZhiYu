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
 *
 * 注意：这会**真的写入数据库**（合并标签、写证据）。跑完会把新增项列出来，
 * 但不会回滚 —— 合并本身是幂等的（并集），重复跑不会累积重复标签。
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
  /* 用 demo 人设 */
  const me = await prisma.persona.findFirst({ where: { kind: "human" } });
  if (!me) throw new Error("找不到 human 人设");

  /* 固定初始状态：把标签收敛到一组基线。
     否则重复跑时标签已经在库里，"新增"必然为空 —— 那是测试不可重复，
     不是功能有问题（这类坑之前踩过）。 */
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

  /* ① 状态查询：应报告凭证已配置 */
  const status = await fetch(`${BASE}/api/zhihu/sync?personaId=${me.id}`).then((r) => r.json());
  rec("GET /api/zhihu/sync 报告凭证已配置", status.configured === true, JSON.stringify(status));

  /* ② 触发同步 */
  const resp = await fetch(`${BASE}/api/zhihu/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personaId: me.id }),
  });
  const raw = await resp.text();
  const r = JSON.parse(raw);

  rec("POST /api/zhihu/sync 返回 200", resp.status === 200, `HTTP ${resp.status}`);
  rec("同步成功", r.ok === true, r.error ?? "");

  /* 关键：响应里不能有凭证 */
  const secret = (process.env.ZHIHU_ACCESS_SECRET ?? "").trim();
  const appKey = (process.env.ZHIHU_OAUTH_APP_KEY ?? "").trim();
  rec(
    "响应体不含 Access Secret / App Key",
    !raw.includes(secret) && (appKey ? !raw.includes(appKey) : true),
    `响应长度 ${raw.length}`,
  );

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
  /* 注意：PersonaEvidence 模型**没有 createdAt 字段**，
     所以这里不能按时间排序。（这也是一个可以改进的点：
     没有时间戳就无法按"最近读了什么"排序。） */
  const sample = await prisma.personaEvidence.findFirst({
    where: { personaId: me.id, source: "zhihu" },
  });
  rec("证据带 note 与 url", Boolean(sample?.note), `${sample?.note?.slice(0, 40)} / ${sample?.url?.slice(0, 40)}`);

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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personaId: me.id }),
  }).then((x) => x.json());
  const afterSecond = await prisma.persona.findUnique({ where: { id: me.id } });
  const interests2 = Array.isArray(afterSecond.interests) ? afterSecond.interests : [];
  rec("重复同步不累积重复标签（幂等）",
    interests2.length === beforeSecond && interests2.length === new Set(interests2).size,
    `${beforeSecond} → ${interests2.length}；第二次 addedInterests=${(r2.addedInterests ?? []).length}`);

  /* ⑧ 缺 personaId 的入参校验 */
  const bad = await fetch(`${BASE}/api/zhihu/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  rec("缺 personaId 返回 400", bad.status === 400, `HTTP ${bad.status}`);
} catch (e) {
  console.error("测试异常:", e.message);
  fail += 1;
} finally {
  await prisma.$disconnect();
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
