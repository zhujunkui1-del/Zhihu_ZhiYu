#!/usr/bin/env node
/**
 * 重建「真实知乎公开创作者」人格。
 *
 * ── 为什么要这个脚本 ──────────────────────────────────────────────────
 * 这 27 位创作者原先是用一次性脚本临时写进库的，**脚本没留在仓库里**。
 * 于是 `scripts/seed-demo.mjs` 早先那句
 * `deleteMany({ where: { kind: "synthetic" } })` 一旦执行，他们就被删光
 * 而且无法恢复 —— 实际发生过，只能靠本脚本重建。
 *
 * 现在把它固化成可重复执行的脚本，并用**公开端点真实抓到的数据**建：
 *   · displayName / 头像 / 一句话介绍  ← 知乎资料
 *   · province                       ← 资料里的 ipLocation
 *   · 其余人格字段                    ← 由 backfill + distill 两步产出
 *
 * 也就是说本脚本只负责"把人建出来"，不编造任何人格结论。
 *
 * 用法：
 *   node --env-file=.env scripts/seed-real-creators.mjs --dry    # 只看会建谁
 *   node --env-file=.env scripts/seed-real-creators.mjs          # 建（幂等）
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { fetchPublicPerson } from "../lib/zhihu/public-profile.ts";
import { normalizeIpLocation } from "../lib/regions.ts";

const DRY = process.argv.includes("--dry");

/** urlToken → 库里显示名。名字以知乎资料为准，这里只作为抓取失败时的兜底。 */
const CREATORS = [
  ["ding-xiang-yi-sheng", "丁香医生"],
  ["a-san-shu", "三叔侃侃"],
  ["shen-me-zhi-de-mai-76-83", "什么值得买"],
  ["zhouqian2015", "倩Sur"],
  ["jian-kang-zhong-guo", "健康中国"],
  ["liu-hao-ran-18-45", "刘昊然"],
  ["zhouzhao", "周召"],
  ["bi-li-bi-li-71-5", "哔哩哔哩"],
  ["zhang-jia-wei", "张佳玮"],
  ["ontheroad270", "张昕宇梁红"],
  ["guojierui123", "我是郭杰瑞"],
  ["kan-ou-li", "捌比特咖啡阚欧礼"],
  ["amandatastes", "曼食慢语"],
  ["lisongwei", "李松蔚"],
  ["liangbianyao", "梁边妖"],
  ["excited-vczh", "梅启铭"],
  ["bi-xiao-tian-99", "毕导"],
  ["hui-zi-51", "灰子"],
  ["wang-rui-en", "王瑞恩"],
  ["soundgirls", "皮实妞"],
  ["zhi-hu-ri-bao-51-41", "知乎日报"],
  ["yu-gan-2-60", "禁与千寻"],
  ["mei-shi-zuo-jia-wang-gang", "美食作家王刚"],
  ["asura-3-28", "虎山行不行"],
  ["lyric-alien", "金时"],
  ["tie-mu-jun-58", "铁木君"],
];

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

console.log(`重建真实创作者${DRY ? "（预览）" : ""}`);
console.log("=".repeat(84));

const t0 = Date.now();
let created = 0;
let updated = 0;
let failed = 0;

for (const [i, [token, fallbackName]] of CREATORS.entries()) {
  const idx = `[${String(i + 1).padStart(2)}/${CREATORS.length}]`;
  const id = `zhihu-${token}`;

  /* 抓公开资料：名字/头像/签名/属地都以它为准，抓不到才用兜底名 */
  let profile = null;
  try {
    const r = await fetchPublicPerson(token, 1);
    profile = r.profile.data;
  } catch {
    /* 网络问题当作抓不到，下面用兜底名 */
  }

  const displayName = profile?.name?.trim() || fallbackName;
  /* 属地规整：省级名 → province；国家名 → 海外 + 该国（见 lib/regions.ts） */
  const { province, city } = normalizeIpLocation(profile?.ipLocation ?? null);

  const data = {
    kind: "synthetic",
    displayName,
    bio: profile?.headline?.trim() || null,
    publicRef: token,
    province,
    city,
    identity: {
      ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
      ...(profile?.headline ? { headline: profile.headline } : {}),
      ...(profile?.description ? { description: profile.description } : {}),
    },
  };

  if (DRY) {
    console.log(
      `${idx} ${displayName.padEnd(16)} id=${id.padEnd(30)} 属地=${province ?? "?"}${city ? "/" + city : ""} 头像=${profile?.avatarUrl ? "有" : "无"}`,
    );
    continue;
  }

  try {
    const existing = await prisma.persona.findUnique({ where: { id }, select: { id: true } });
    if (existing) {
      /* 已存在则只补"来自公开资料"的字段，不覆盖已有的人格结论 */
      await prisma.persona.update({
        where: { id },
        data: {
          displayName,
          bio: data.bio ?? undefined,
          publicRef: token,
          province,
          city,
        },
      });
      updated += 1;
      console.log(`${idx} ${displayName.padEnd(16)} 已存在 → 更新资料`);
    } else {
      await prisma.persona.create({ data: { id, ...data } });
      created += 1;
      console.log(`${idx} ${displayName.padEnd(16)} 新建 ✓ 属地=${province ?? "?"}`);
    }
  } catch (e) {
    failed += 1;
    console.log(`${idx} ${displayName.padEnd(16)} ✗ ${String(e.message).slice(0, 70)}`);
  }

  await new Promise((r) => setTimeout(r, 500));
}

const total = Date.now() - t0;
console.log(`\n${"=".repeat(84)}`);
if (DRY) {
  console.log(`预览完成：${CREATORS.length} 位，耗时 ${(total / 1000).toFixed(1)}s`);
} else {
  console.log(
    `完成：新建 ${created}，更新 ${updated}，失败 ${failed}，耗时 ${(total / 1000).toFixed(1)}s`,
  );
  console.log("\n下一步（补齐人格数据）：");
  console.log("  node --env-file=.env scripts/backfill-real-zhihu.mjs --apply");
  console.log("  node --env-file=.env scripts/distill-real-batch.mjs");
}

await prisma.$disconnect();
