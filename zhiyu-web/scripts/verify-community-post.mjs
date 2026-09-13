#!/usr/bin/env node
/**
 * 社区 API 发布链路验证。
 *
 * ⚠️ 默认是**演练模式**：完整走一遍链路（配置、额度、参数校验、内容组装），
 *    但**不会真的发帖**。因为发帖会出现在用户本人的知乎账号下，
 *    属于可见的外部副作用，必须由用户显式授权。
 *
 * 要真实发布，加 `--live`：
 *   node --env-file=.env scripts/verify-community-post.mjs --live
 *
 * 用法：node --env-file=.env scripts/verify-community-post.mjs [BASE] [--live]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const BASE = args.find((a) => a.startsWith("http")) || "http://127.0.0.1:3000";

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

console.log(`知乎社区 API 发布链路验证（${LIVE ? "★ 真实发布模式" : "演练模式，不真发"}）`);
console.log("=".repeat(88));

try {
  /* ① 额度与配置 */
  const info = await fetch(`${BASE}/api/zhihu/community/post`).then((r) => r.json());
  rec("GET 返回配置状态与三个圈子", info.configured === true && info.circles?.length === 3,
    info.circles?.map((c) => c.name).join(" / "));
  rec("返回发布额度（文档：每小时 5 条）",
    info.quota?.limit === 5 && typeof info.quota?.remaining === "number",
    `已用 ${info.quota?.used} / 上限 ${info.quota?.limit}`);

  /* 找一个有报告的匹配 */
  const match = await prisma.match.findFirst({
    where: { report: { isNot: null } },
    include: { personaA: { select: { displayName: true } }, personaB: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!match) throw new Error("库里没有带报告的匹配，先跑 seed-agent-match.mjs");
  rec("找到一个带报告的匹配", true, `${match.personaA.displayName} × ${match.personaB.displayName}`);

  /* ② 未显式确认时拒发 —— 防止被误触发 */
  {
    const r = await fetch(`${BASE}/api/zhihu/community/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: match.id, circle: "hackathon" }),
    });
    const j = await r.json();
    rec("未带 confirm 时拒绝发布（400）", r.status === 400 && j.code === "NEED_CONFIRM",
      `HTTP ${r.status} ${j.code ?? ""}`);
  }

  /* ③ 缺 matchId */
  {
    const r = await fetch(`${BASE}/api/zhihu/community/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    rec("缺 matchId 返回 400", r.status === 400, `HTTP ${r.status}`);
  }

  /* ④ 不存在的 matchId */
  {
    const r = await fetch(`${BASE}/api/zhihu/community/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, matchId: "does-not-exist" }),
    });
    rec("不存在的 matchId 不 500", r.status === 404, `HTTP ${r.status}`);
  }

  /* ⑤ 内容组装预览（不发帖也能看到会发什么） */
  {
    const full = await prisma.match.findUnique({
      where: { id: match.id },
      include: {
        personaA: { select: { displayName: true } },
        personaB: { select: { displayName: true } },
        report: true,
      },
    });
    const result = (full.report.result ?? {});
    const dims = result.dimensions ?? {};
    const pct = (v) => (typeof v === "number" ? `${Math.round(v <= 1 ? v * 100 : v)}%` : "—");
    console.log("\n  ── 将在知乎圈子发布的内容预览 ──");
    console.log(`  【知遇】两组 Agent 聊完的结论：${pct(full.report.overallScore)}`);
    console.log(`  本轮匹配：${full.personaA.displayName} × ${full.personaB.displayName}`);
    console.log(
      `  五维：兴趣 ${pct(dims.interest)} / 思维 ${pct(dims.thinking)} / 价值观 ${pct(dims.values)} / 沟通 ${pct(dims.communication)} / 互补 ${pct(dims.complementarity)}`,
    );
    const appSecret = (process.env.ZHIHU_COMMUNITY_APP_SECRET ?? "").trim();
    rec("内容中不含任何凭证", !JSON.stringify(full.report).includes(appSecret));
    rec("内容有真实信息量（含五维与双方名称）",
      Boolean(full.personaA.displayName && dims.interest !== undefined));
  }

  if (!LIVE) {
    console.log("\n  · 演练模式：跳过真实发布。");
    console.log("    要真的发到知乎圈子，重跑并加 --live：");
    console.log("    node --env-file=.env scripts/verify-community-post.mjs --live\n");
  } else {
    const before = await prisma.communityPost.count();
    const pub = await fetch(`${BASE}/api/zhihu/community/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, matchId: match.id, circle: "hackathon" }),
    });
    const pj = await pub.json();
    rec("真实发布成功", pub.status === 200 && pj.ok === true,
      pj.ok ? `圈子=${pj.circle} content_token=${pj.contentToken}` : `HTTP ${pub.status} ${pj.error}`);
    rec("返回了 content_token", typeof pj.contentToken === "string" && pj.contentToken.length > 10,
      String(pj.contentToken));

    const after = await prisma.communityPost.count();
    rec("发布记录已落库", after === before + 1, `${before} → ${after}`);

    const info2 = await fetch(`${BASE}/api/zhihu/community/post`).then((r) => r.json());
    rec("额度已扣减", info2.quota.used >= 1, `used=${info2.quota.used} remaining=${info2.quota.remaining}`);

    /* 端到端：从圈子侧读回 */
    if (pj.contentToken) {
      const { CIRCLES, readCommunityConfig, fetchRingDetail } = await import("../lib/zhihu/community-api.ts");
      const cfg = readCommunityConfig();
      if (cfg) {
        const rd = await fetchRingDetail(cfg, CIRCLES.hackathon.id, 20);
        const found = rd.data?.contents?.some((c) => String(c.pin_id) === String(pj.contentToken));
        rec("在圈子最新内容里读回刚发布的这条", Boolean(found),
          found ? `pin_id=${pj.contentToken}` : "未在前 20 条中找到（可能被挤出）");
      }
    }
  }
} catch (e) {
  console.error("测试异常:", e.message);
  fail += 1;
} finally {
  await prisma.$disconnect();
}

console.log("=".repeat(88));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);

