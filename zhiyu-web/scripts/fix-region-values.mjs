/**
 * 修复库里非法/不规范的地区值。
 *
 * 背景：抓取真实用户时，知乎的 IP 属地可能是「美国」「澳大利亚」这类国家名，
 * 也可能是「未知」。直接写进 province 会落在地区表外 —— 地区筛选会出现
 * 选了却搜不到的情况，也可能出现假数据。
 *
 * 本脚本用 normalizeIpLocation 把已有数据规整一遍：
 *   · 国家名 → province=「海外」, city=国家名
 *   · 「未知」→ province=null（**不编造**）
 *
 * 用法：node --env-file=.env scripts/fix-region-values.mjs [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { normalizeIpLocation, PROVINCES, citiesOf } from "../lib/regions.ts";

const APPLY = process.argv.includes("--apply");

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

try {
  const rows = await prisma.persona.findMany({
    where: { province: { not: null } },
    select: { id: true, displayName: true, province: true, city: true },
  });

  const fixes = [];
  for (const r of rows) {
    const p = (r.province ?? "").trim();
    const c = (r.city ?? "").trim();

    /* 合法且 city 归属正确 → 跳过 */
    const provOk = PROVINCES.includes(p);
    const cityOk = !c || (provOk && citiesOf(p).includes(c));
    if (provOk && cityOk) continue;

    const norm = normalizeIpLocation(p && p !== "未知" ? p : null);
    /* 已经是合法省份但 city 不合法时，只清掉 city */
    const next =
      provOk && !cityOk
        ? { province: p, city: null }
        : { province: norm.province, city: norm.city };

    fixes.push({ id: r.id, name: r.displayName, from: `${p} / ${c || "(无)"}`, to: `${next.province ?? "(清空)"} / ${next.city ?? "(无)"}`, next });
  }

  console.log(`检查 ${rows.length} 条，需要修 ${fixes.length} 条\n`);
  for (const f of fixes) {
    console.log(`  ${f.name.padEnd(16)} ${f.from.padEnd(20)} → ${f.to}`);
  }

  if (!fixes.length) {
    console.log("没有需要修的数据 ✓");
  } else if (!APPLY) {
    console.log(`\n（未加 --apply，仅预览）`);
  } else {
    for (const f of fixes) {
      await prisma.persona.update({
        where: { id: f.id },
        data: { province: f.next.province, city: f.next.city },
      });
    }
    console.log(`\n已修复 ${fixes.length} 条`);
  }
} finally {
  await prisma.$disconnect();
}
