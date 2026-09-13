/**
 * 数据层验证：seed 出来的 16 位示例人格能否让「六维匹配」真正出分。
 *
 * 为什么需要这个脚本：seed 成功 ≠ 匹配可用。
 * 五维分数是引擎实时算的，只要人设数据缺一维，那一维就静默变 null，
 * 报告上表现为"空一格"，但不会有任何报错。
 *
 * 用法：node --env-file=.env scripts/check-matching.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { quickMatch } from "../lib/matching/quick.ts";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

try {
  const me = await prisma.persona.findFirst({ where: { kind: "human" } });
  const candidates = await prisma.persona.findMany({
    where: { kind: "synthetic" },
    orderBy: { displayName: "asc" },
  });

  console.log("数据层验证：16 位示例人格的匹配可用性");
  console.log("=".repeat(80));

  rec("存在演示用户人设（human）", !!me, me ? `${me.displayName} / ${me.id.slice(0, 12)}…` : "缺失");
  rec("示例人格数量为 16", candidates.length === 16, `实际 ${candidates.length}`);

  /* 地区字段 */
  const noRegion = candidates.filter((c) => !c.province || !c.city);
  rec("16 人都有 province / city", noRegion.length === 0,
    noRegion.length ? noRegion.map((c) => c.displayName).join(", ") : "全部齐备");
  const provinces = [...new Set(candidates.map((c) => c.province))];
  rec("覆盖多个省份（地区筛选才有意义）", provinces.length >= 5,
    `${provinces.length} 个：${provinces.join("、")}`);

  /* 引擎必需字段 */
  const missComm = candidates.filter((c) => !Array.isArray(c.communicationStyle) || c.communicationStyle.length < 2);
  const missVals = candidates.filter((c) => {
    const v = c.values;
    return !v || typeof v !== "object" || Object.keys(v).length < 4;
  });
  const badCodes = candidates.filter((c) => {
    const s = c.personality?.sbti?.codes;
    return typeof s !== "string" || s.replaceAll("-", "").length !== 15;
  });
  rec("16 人都有 communicationStyle（否则「沟通适配」恒 null）", missComm.length === 0,
    missComm.length ? missComm.map((c) => c.displayName).join(", ") : "全部齐备");
  rec("16 人都有 values（否则「价值观适配」恒 null）", missVals.length === 0,
    missVals.length ? missVals.map((c) => c.displayName).join(", ") : "全部齐备");
  rec("16 人的 SBTI codes 都是合法 15 位（否则人格/互补恒 null）", badCodes.length === 0,
    badCodes.length ? badCodes.map((c) => `${c.displayName}:${c.personality?.sbti?.codes}`).join(", ") : "全部合法");

  /* values key 一致性：不一致会让比较静默失效 */
  const keySets = candidates.map((c) => Object.keys(c.values).sort().join(","));
  rec("values 的 key 在所有人之间一致", new Set(keySets).size === 1,
    `不同的 key 组合数：${new Set(keySets).size}`);

  /* 真正跑一遍引擎 */
  if (!me) throw new Error("缺少 human 人设，无法跑匹配");

  const results = quickMatch(
    {
      id: me.id,
      displayName: me.displayName,
      kind: me.kind,
      interests: me.interests,
      topics: me.topics,
      communicationStyle: me.communicationStyle,
      values: me.values,
      personality: me.personality,
    },
    candidates.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      kind: c.kind,
      interests: c.interests,
      topics: c.topics,
      communicationStyle: c.communicationStyle,
      values: c.values,
      personality: c.personality,
    })),
    16,
  );

  console.log(`\n  匹配结果（共 ${results.length} 条）：`);
  console.log("  人格            总分  兴趣  人格  话题  价值  沟通  互补");
  console.log("  " + "-".repeat(66));
  for (const r of results) {
    const g = (k) => {
      const s = r.dimensions[k]?.score;
      return s == null ? "  -" : String(Math.round(s)).padStart(3);
    };
    console.log(
      `  ${r.displayName.padEnd(14)} ${String(r.overall).padStart(4)}  ${g("interest")}  ${g("personality")}  ${g("topics")}  ${g("values")}  ${g("communication")}  ${g("complementarity")}`,
    );
  }

  /* 断言：不能有维度全 null，总分要有区分度 */
  const nullDims = [];
  for (const r of results) {
    for (const [k, d] of Object.entries(r.dimensions)) {
      if (d.score == null) nullDims.push(`${r.displayName}/${k}`);
    }
  }
  rec("没有任何维度是 null（报告不会空格）", nullDims.length === 0,
    nullDims.length ? nullDims.slice(0, 6).join(", ") : "六维全部有值");

  const overalls = results.map((r) => r.overall);
  const uniq = new Set(overalls).size;
  rec("总分有区分度（不是所有人一个分）", uniq >= 8,
    `16 人产出 ${uniq} 个不同总分，区间 ${Math.min(...overalls)}~${Math.max(...overalls)}`);

  /* 单维度的区分度用**极差**判断，而不是「不同取值的个数」。
     为什么：topics / communication 这类维度是「小词集 × 6 个类型分组」，
     16 人只落在 6 个类型里，不同取值个数天然最多约 6 个；
     要求「≥4 个不同取值」是对这类维度不成立的过严断言（实际踩过）。
     真正该问的是"分数有没有拉开"。 */
  for (const key of ["interest", "personality", "topics", "values", "communication", "complementarity"]) {
    const vals = results.map((r) => r.dimensions[key]?.score).filter((v) => v != null);
    const distinct = new Set(vals.map((v) => Math.round(v))).size;
    const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
    rec(`维度 ${key} 分数拉开（极差 >= 8）`, spread >= 8,
      `${vals.length} 个值，极差 ${Math.round(spread)}，${distinct} 个不同取值（区间 ${Math.round(Math.min(...vals))}~${Math.round(Math.max(...vals))}）`);
  }

  console.log("\n" + "=".repeat(80));
  console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error("失败:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
