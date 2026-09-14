/**
 * 批量采集关注列表里真实用户的公开数据，蒸馏后写入 Persona。
 *
 * 从**你自己的关注列表**取 UrlToken —— 公开端点读别人时不返回 url_token
 * （实测见 probe-author-token.mjs），关注列表接口是唯一确凿的 token 来源。
 *
 * 用法：
 *   node --env-file=.env scripts/fetch-followees.mjs [--limit 20] [--apply]
 *   --apply 才真正写库
 *
 * 踩过的坑（已修）：
 *   · Persona **没有 avatarUrl 字段** —— 头像放 `identity.avatarUrl`，
 *     知乎主页标识放 `publicRef`。曾因写错字段导致 27 条 upsert 全部静默失败。
 *   · 失败时一定要把错误打出来，不要用 Select-String 把它过滤掉。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { fetchPublicPerson } from "../lib/zhihu/public-profile.ts";
import { distill } from "./distill-real-people.mjs";
import { normalizeIpLocation } from "../lib/regions.ts";

const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || 20;
const APPLY = args.includes("--apply");
const ACCESS_SECRET = (process.env.ZHIHU_ACCESS_SECRET ?? "").trim();

/* ① 取关注列表 */
const r = await fetch("https://developer.zhihu.com/api/v1/user/followees?Offset=0&Limit=50", {
  headers: {
    Authorization: `Bearer ${ACCESS_SECRET}`,
    "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
    "Content-Type": "application/json",
  },
});
const j = await r.json();
const all = (j?.Data?.Items ?? [])
  .map((x) => ({
    name: String(x.Fullname ?? "").trim(),
    token: String(x.UrlToken ?? "").trim(),
    headline: String(x.Headline ?? "").trim(),
  }))
  .filter((x) => x.token);

const targets = all.slice(0, LIMIT);
console.log(`关注列表共 ${all.length} 人，本次采集前 ${targets.length} 位`);
console.log("=".repeat(88));
console.log("间隔策略：每人之间 sleep 600ms（礼貌采集）\n");

/* ② 逐个采集 + 蒸馏 + 计时 */
const rows = [];
const t0 = Date.now();

for (let i = 0; i < targets.length; i += 1) {
  const c = targets[i];
  const tStart = Date.now();
  const res = await fetchPublicPerson(c.token, 20);
  const ms = Date.now() - tStart;

  const p = res.profile.data;
  const pins = res.pins.data ?? [];
  const d = res.profile.ok && p ? distill(p, pins) : null;

  rows.push({
    token: c.token,
    okProfile: res.profile.ok,
    okPins: res.pins.ok,
    pinCount: pins.length,
    name: d?.name ?? c.name,
    distilled: d,
    ms,
  });

  const mark = res.profile.ok && pins.length > 0 ? "★" : res.profile.ok ? "·" : "✗";
  console.log(
    `${mark} [${String(i + 1).padStart(2)}/${targets.length}] ${(d?.name ?? c.name).padEnd(18)} ` +
      `想法${String(pins.length).padStart(2)} 总赞${String(d?.stats.totalLikes ?? 0).padStart(5)} ` +
      `均${String(d?.stats.avgChars ?? 0).padStart(3)}字 ${String(ms).padStart(5)}ms  ${(d?.interests ?? []).slice(0, 2).join("/")}`,
  );

  if (i < targets.length - 1) await new Promise((rr) => setTimeout(rr, 600));
}

const total = Date.now() - t0;
const sleepTotal = Math.max(0, targets.length - 1) * 600;

console.log(`\n${"=".repeat(88)}`);
console.log("计时结果");
console.log("=".repeat(88));
console.log(`  采集人数        ${targets.length}`);
console.log(`  总耗时          ${(total / 1000).toFixed(1)} s`);
console.log(`  其中 sleep      ${(sleepTotal / 1000).toFixed(1)} s`);
console.log(`  净采集耗时      ${((total - sleepTotal) / 1000).toFixed(1)} s`);
console.log(`  平均每人        ${Math.round(total / targets.length)} ms（含 sleep）`);
console.log(`  净平均每人      ${Math.round((total - sleepTotal) / targets.length)} ms`);
console.log(`  推算 20 人      ${Math.round(((total / targets.length) * 20) / 1000)} s`);
console.log(`  推算 100 人     ${Math.round(((total / targets.length) * 100) / 1000)} s`);
console.log(`  资料成功率      ${rows.filter((x) => x.okProfile).length}/${targets.length}`);
console.log(`  有内容的        ${rows.filter((x) => x.pinCount > 0).length}/${targets.length}`);

/* ③ 落库 */
if (!APPLY) {
  console.log(`\n（未加 --apply，仅采集不入库）`);
  process.exit(0);
}

console.log(`\n写入数据库…`);
const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});
let written = 0;
const failures = [];

try {
  for (const row of rows) {
    const d = row.distilled;
    if (!d) continue;
    /* 字段以 schema.prisma 为准：**没有 avatarUrl**，
       头像放 identity.avatarUrl，知乎主页 token 放 publicRef。 */
    const data = {
      kind: "synthetic",
      displayName: d.name,
      bio: d.headline || null,
      publicRef: d.urlToken,
      /* 知乎返回的 IP 属地可能是省级名（北京）、国家名（美国）或「未知」。
         统一走 normalizeIpLocation：国家名归到「海外」，
         「未知」返回 null（**不编造**，否则地区筛选会出现假数据）。 */
      ...(() => {
        const loc = normalizeIpLocation(d.ipLocation);
        return { province: loc.province, city: loc.city };
      })(),
      interests: d.interests.length ? d.interests : ["知乎内容"],
      topics: d.topics,
      communicationStyle: ["公开表达"],
      values: d.values,
      identity: {
        avatarUrl: d.avatarUrl || null,
        source: "zhihu-public",
        isOrg: d.isOrg,
        capturedStats: d.stats,
      },
      confidence: {
        method: "rule-distill",
        evidenceCount: d.evidence.length,
        note: "由知乎公开内容按规则蒸馏；每条标签可溯源到具体内容",
      },
      completeness: 45,
      agentOpen: true,
    };
    try {
      await prisma.persona.upsert({
        where: { id: `zhihu-${d.urlToken}` },
        update: data,
        create: { id: `zhihu-${d.urlToken}`, ...data },
      });
      written += 1;
      console.log(`  ✓ ${d.name}`);
    } catch (e) {
      failures.push(`${d.name}: ${e.message.split("\n")[0]}`);
      console.log(`  ✗ ${d.name}: ${e.message.split("\n")[0].slice(0, 100)}`);
    }
  }
} finally {
  await prisma.$disconnect();
}

console.log(`\n写入结果：成功 ${written}，失败 ${failures.length}`);
if (failures.length) {
  console.log("失败明细：");
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`入库后可在发现页检索（id 前缀 zhihu-，publicRef 指向知乎主页）`);
