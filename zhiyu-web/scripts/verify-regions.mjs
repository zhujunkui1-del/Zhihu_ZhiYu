#!/usr/bin/env node
/**
 * 地区数据完整性校验 —— 「中国一块地都不能少」。
 *
 * 分两层：
 *   ① 结构自检（不依赖网络）：34 个省级单位齐全、无重复、直辖市/港澳台口径正确
 *   ② 与权威区划数据比对（需网络）：拉 npm 包 china-division（民政部口径），
 *      归一化命名差异后，确认**没有真正漏掉的地级行政区**
 *
 * 为什么要第②层：只靠人工列一遍，无法证明"没漏"。权威源是唯一能给出
 * "应该有哪些"的客观依据。
 *
 * 用法：node scripts/verify-regions.mjs
 */
import { REGIONS, PROVINCES, citiesOf, locText } from "../lib/regions.ts";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("地区数据完整性校验");
console.log("=".repeat(80));

/* ── ① 结构自检 ───────────────────────────────────────────────────────── */
console.log("\n【结构自检】");

/**
 * 34 个省级行政区（23 省 + 5 自治区 + 4 直辖市 + 2 特别行政区）
 * 外加一个「海外」分组 —— 知乎的 IP 属地会返回「美国」「澳大利亚」这类国家名，
 * 我们抓到的真实用户里确实有海外账号，必须有地方放。
 */
const EXPECTED_PROVINCES = [
  "北京", "天津", "河北", "山西", "内蒙古",
  "辽宁", "吉林", "黑龙江",
  "上海", "江苏", "浙江", "安徽", "福建", "江西", "山东",
  "河南", "湖北", "湖南", "广东", "广西", "海南",
  "重庆", "四川", "贵州", "云南", "西藏",
  "陕西", "甘肃", "青海", "宁夏", "新疆",
  "台湾", "香港", "澳门",
  "海外",
];

rec("省级单位 34 个齐全（23省+5自治区+4直辖市+2特别行政区）",
  EXPECTED_PROVINCES.length === 35 && EXPECTED_PROVINCES.every((p) => PROVINCES.includes(p)),
  `期望 35 组（含「海外」），实有 ${PROVINCES.length} 组`);

{
  const missing = EXPECTED_PROVINCES.filter((p) => !PROVINCES.includes(p));
  const extra = PROVINCES.filter((p) => !EXPECTED_PROVINCES.includes(p));
  rec("没有缺失的省级单位", missing.length === 0, missing.join("、") || "无");
  rec("没有多余的省级单位", extra.length === 0, extra.join("、") || "无");
}

{
  const dup = PROVINCES.filter((p, i) => PROVINCES.indexOf(p) !== i);
  rec("省级名称无重复", dup.length === 0, dup.join("、") || "无");
}

{
  /* 每个省至少有一个城市，且城市名不重复、不含「市」后缀 */
  const empty = REGIONS.filter((r) => r.c.length === 0).map((r) => r.p);
  rec("每个省级单位至少有一个地级行政区", empty.length === 0, empty.join("、") || "无");

  const dupCity = [];
  const spaceCity = [];
  const withSuffix = [];
  for (const r of REGIONS) {
    const seen = new Set();
    for (const c of r.c) {
      if (seen.has(c)) dupCity.push(`${r.p}/${c}`);
      seen.add(c);
      if (/\s/.test(c)) spaceCity.push(`${r.p}/${c}`);
      /* 城市名不该带「市」后缀（口径统一），但 自治州/地区/盟/林区 是正式名称的一部分 */
      if (/市$/.test(c)) withSuffix.push(`${r.p}/${c}`);
    }
  }
  rec("同一省内城市名不重复", dupCity.length === 0, dupCity.slice(0, 5).join("、") || "无");
  rec("城市名不含空白字符", spaceCity.length === 0, spaceCity.slice(0, 5).join("、") || "无");
  rec("城市名不带「市」后缀（口径统一）", withSuffix.length === 0,
    withSuffix.slice(0, 5).join("、") || "无");
}

{
  /* 直辖市与港澳台：province === city，且只有一个 */
  const MUNI = ["北京", "天津", "上海", "重庆", "香港", "澳门"];
  const bad = MUNI.filter((p) => {
    const cs = citiesOf(p);
    return cs.length !== 1 || cs[0] !== p;
  });
  rec("直辖市与港澳台的 province 与 city 同名且唯一（不会出现「北京 · 北京」）",
    bad.length === 0, bad.length ? bad.join("、") : MUNI.join("、"));
  rec("locText 对同名省市只显示一次",
    locText("北京", "北京") === "北京" && locText("浙江", "杭州") === "浙江 · 杭州",
    `${locText("北京", "北京")} / ${locText("浙江", "杭州")}`);
}

{
  const total = REGIONS.reduce((s, r) => s + r.c.length, 0);
  rec("地级行政区总数达到合理规模（≥330）", total >= 330, `合计 ${total} 个`);
}

/* ── ② 与权威数据比对 ─────────────────────────────────────────────────── */
console.log("\n【与权威区划数据比对】");

const SRC = "https://unpkg.com/china-division@2/dist/pcas-code.json";
let official = null;
try {
  const r = await fetch(SRC, { signal: AbortSignal.timeout(20000) });
  if (r.ok) official = await r.json();
} catch (e) {
  console.log(`  （拉取失败，跳过网络比对：${e.message.slice(0, 60)}）`);
}

if (!official) {
  rec("权威数据可比对", false, "未能拉取 china-division，网络比对未执行");
} else {
  const shortProvince = (n) =>
    n
      .replace(/特别行政区$/, "")
      .replace(/维吾尔自治区$/, "")
      .replace(/回族自治区$/, "")
      .replace(/壮族自治区$/, "")
      .replace(/自治区$/, "")
      .replace(/[省市]$/, "");
  /** 权威用的是"短名"（兴安 / 延边朝鲜族），我们用的是全称 —— 归一化后比 */
  const shortCity = (n) =>
    n.replace(/自治州$/, "").replace(/地区$/, "").replace(/盟$/, "").replace(/市$/, "");
  /** 反向：把我们的全称也归一化成短名，才能与权威对齐 */
  const mineShort = (n) =>
    n.replace(/自治州$/, "").replace(/地区$/, "").replace(/盟$/, "").replace(/市$/, "");

  const norm = official.map((p) => ({
    p: shortProvince(p.name),
    cities: (p.children ?? []).map((c) => shortCity(c.name)),
  }));

  /* 权威源只含大陆 31 省；港澳台单独确认 */
  const mainland = norm.filter((x) => !["台湾", "香港", "澳门"].includes(x.p));
  rec("权威源含 31 个大陆省级单位", mainland.length === 31, `实有 ${mainland.length}`);

  /**
   * 权威数据里的**虚拟项**，不是真实行政区名，比对时排除：
   *   · 省直辖县级行政区划  —— 河南/湖北/海南/新疆把若干县级市打包成的一个统计项
   *   · 市辖区              —— 直辖市对"下辖区"的打包统计项
   *   · 县                  —— 重庆对"下辖县"的打包统计项
   * 这些项在 UI 上没有意义（不会有人选"市辖区"），我们已经按真实名称补充了
   * 济源 / 仙桃 / 潜江 / 天门 / 神农架林区 / 海南各县级市 / 新疆兵团市。
   */
  const VIRTUAL = new Set([
    "省直辖县级行政区划",
    "自治区直辖县级行政区划",
    "市辖区",
    "县",
  ]);

  let totalMissing = 0;
  const missingDetail = [];
  for (const o of mainland) {
    const cur = citiesOf(o.p);
    const curShort = cur.map(mineShort);
    const miss = o.cities.filter((c) => !VIRTUAL.has(c) && !curShort.includes(c));
    if (miss.length) {
      totalMissing += miss.length;
      missingDetail.push(`${o.p}: ${miss.join("、")}`);
    }
  }
  rec("大陆 31 省的地级行政区**没有真正缺失**（命名口径差异已归一化）",
    totalMissing === 0,
    totalMissing ? `合计缺 ${totalMissing} 个\n      ${missingDetail.slice(0, 6).join("\n      ")}` : "全部覆盖");

  /* 反向：我们有没有权威源里没有的（可能是我们写错或更细） */
  const extraDetail = [];
  for (const o of mainland) {
    const cur = citiesOf(o.p).map(mineShort);
    const extra = cur.filter((c) => !o.cities.includes(c));
    if (extra.length) extraDetail.push(`${o.p}: ${extra.join("、")}`);
  }
  console.log(`\n  额外项（权威源没有、我们有的，多为省直辖县级市，属合理补充）：`);
  for (const x of extraDetail) console.log(`    ${x}`);

  /* 港澳台单独确认 */
  rec("台湾有地级划分（不是只有省名）", citiesOf("台湾").length >= 20,
    `${citiesOf("台湾").length} 个`);
  rec("香港 / 澳门各为一个地区项", citiesOf("香港").length === 1 && citiesOf("澳门").length === 1);
}

/* ── ③ 数据库里的值是否都在表内 ───────────────────────────────────────── */
console.log("\n【数据库地区值是否合法】");
try {
  const { PrismaClient } = await import("@prisma/client");
  const { PrismaNeon } = await import("@prisma/adapter-neon");
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
  });
  const rows = await prisma.persona.findMany({
    where: { province: { not: null } },
    select: { displayName: true, province: true, city: true },
  });
  await prisma.$disconnect();

  const badProv = [];
  const badCity = [];
  for (const r of rows) {
    const p = (r.province ?? "").trim();
    const c = (r.city ?? "").trim();
    if (p && !PROVINCES.includes(p)) badProv.push(`${r.displayName}:${p}`);
    if (p && c && !citiesOf(p).includes(c)) badCity.push(`${r.displayName}:${p}/${c}`);
  }
  rec("库中所有 province 都在地区表内", badProv.length === 0,
    badProv.slice(0, 5).join("、") || `检查了 ${rows.length} 条`);
  rec("库中所有 city 都属于其 province", badCity.length === 0,
    badCity.slice(0, 5).join("、") || "全部合法");
} catch (e) {
  console.log(`  （数据库检查跳过：${e.message.slice(0, 60)}）`);
}

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
