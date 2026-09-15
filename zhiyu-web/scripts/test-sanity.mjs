#!/usr/bin/env node
/**
 * 数值体检（lib/persona/sanity.ts）+ 三条"无信号留空"纪律的验收测试。
 *
 * ── 为什么必须有 ─────────────────────────────────────────────────────────
 * 用户原话：「你这蒸馏得到的数据太假」「刚叫你不要用 100% 和 0%，
 * 你就整 99% 和 1%」。实测复现出来的极端值有三个来源：
 *   · social    = heat/300，热度全 0 → 0 → 界面 1%（三源同值 1%，全是假的）
 *   · stability = 1-min(CV,1)，CV≥1 → 0 → 界面 1%（真实私聊 CV≈6.4）
 *   · autonomy  = 1-(领域数-1)/8，命中 1 个领域 → 1.0 → 界面 99%
 * 还有一个"重复值"来源：SBTI 全 M 作答 → 五个维度全是 50%（标准差 0）。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-sanity.mjs
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

const { facetFromContents, fuseSourceFacets, topicConcentration, hasHeatSignal } = await import(
  "../lib/persona/fusion.ts"
);
const { inspectFacets, hasNoSpread, crossSourceIdentical } = await import(
  "../lib/persona/sanity.ts"
);

const imOpts = { noHeat: true, profile: "im" };

/* ── ① social：没有互动量就留空，不是 1% ──────────────────────────────── */
console.log("\n== ① social：热度全 0 → 留空 ==");
{
  const noHeat = facetFromContents(
    "zhihu",
    "知乎",
    Array.from({ length: 6 }, (_, i) => ({ text: `第 ${i} 条只有标题的想法`, heat: 0 })),
    {},
  );
  rec(
    "热度全 0 → social 缺失（不再算成 1%）",
    typeof noHeat.values.social !== "number",
    JSON.stringify(noHeat.values),
  );

  const someHeat = facetFromContents(
    "zhihu",
    "知乎",
    Array.from({ length: 6 }, (_, i) => ({ text: `第 ${i} 条想法`, heat: i === 0 ? 0 : 40 })),
    {},
  );
  rec(
    "有一半条目有点赞 → social 有值",
    typeof someHeat.values.social === "number",
    `social=${someHeat.values.social}`,
  );

  rec("hasHeatSignal：全 0 → false", hasHeatSignal([0, 0, 0, 0]) === false);
  rec("hasHeatSignal：10 条里 1 条非零 → true（刚好 10%）", hasHeatSignal([0, 0, 0, 0, 0, 0, 0, 0, 0, 5]) === true);
  rec("hasHeatSignal：20 条里 1 条非零 → false（不足 10%）", hasHeatSignal([...Array(19).fill(0), 5]) === false);
  rec("hasHeatSignal：空数组 → false", hasHeatSignal([]) === false);
}

/* ── ② stability：CV≥1 就留空，不是 1% ────────────────────────────────── */
console.log("\n== ② stability：篇幅乱到 CV≥1 → 留空 ==");
{
  /* 复现真实私聊的形态：平均 8.9 字、标准差 56.7（几条长文混着大量短句） */
  const mixed = [
    ...Array.from({ length: 30 }, () => "？"),
    ...Array.from({ length: 5 }, () => "这是一条非常长的消息".repeat(12)),
  ].map((text) => ({ text }));

  const f = facetFromContents("wechat", "微信", mixed, { ...imOpts });
  rec(
    "CV 爆表 → stability 留空（不再恒定 1%）",
    typeof f.values.stability !== "number",
    `values=${JSON.stringify(f.values)}`,
  );

  const even = Array.from({ length: 10 }, (_, i) => ({ text: `长度差不多的一条消息${i}啊` }));
  const f2 = facetFromContents("wechat", "微信", even, { ...imOpts });
  rec(
    "篇幅均匀 → stability 有值且在合理区间",
    typeof f2.values.stability === "number" && f2.values.stability > 0.8 && f2.values.stability < 1,
    `stability=${f2.values.stability}`,
  );

  const single = facetFromContents("wechat", "微信", [{ text: "只有一条消息" }], { ...imOpts });
  rec("只有 1 条 → stability 留空（无从谈波动）", typeof single.values.stability !== "number");
}

/* ── ③ autonomy：HHI 归一化，一个领域不给 99% ─────────────────────────── */
console.log("\n== ③ autonomy：集中度改用 HHI ==");
{
  const one = facetFromContents(
    "zhihu",
    "知乎",
    Array.from({ length: 8 }, (_, i) => ({ text: `AI 与算法第 ${i} 条`, heat: 5 })),
    {},
  );
  rec(
    "只命中 1 个领域 → autonomy 留空（不再 99%）",
    typeof one.values.autonomy !== "number",
    JSON.stringify(one.values),
  );

  const spread = facetFromContents(
    "wechat",
    "微信",
    [
      { text: "聊聊 AI 与大模型" },
      { text: "这个产品功能和界面体验" },
      { text: "历史上的文化思想" },
      { text: "周末去哪里旅行吃饭" },
    ],
    { ...imOpts },
  );
  rec(
    "四个领域各一次 → 集中度接近 0（均分）",
    typeof spread.values.autonomy === "number" && spread.values.autonomy < 0.05,
    `autonomy=${spread.values.autonomy}`,
  );

  const skewed = facetFromContents(
    "wechat",
    "微信",
    [
      ...Array.from({ length: 9 }, (_, i) => ({ text: `AI 大模型算法第 ${i} 条` })),
      { text: "顺带聊聊历史" },
    ],
    { ...imOpts },
  );
  rec(
    "一个领域占绝对多数 → 集中度高（但不到 99%）",
    typeof skewed.values.autonomy === "number" &&
      skewed.values.autonomy > 0.5 &&
      skewed.values.autonomy < 0.99,
    `autonomy=${skewed.values.autonomy}`,
  );

  rec("topicConcentration：只有一个领域 → null", topicConcentration(new Map([["a", 5]])) === null);
  rec("topicConcentration：空 → null", topicConcentration(new Map()) === null);
  const even3 = topicConcentration(new Map([["a", 2], ["b", 2], ["c", 2]]));
  rec("topicConcentration：三领域均分 → 0", even3 !== null && Math.abs(even3) < 1e-9, String(even3));
  const solo = topicConcentration(new Map([["a", 9], ["b", 1]]));
  rec("topicConcentration：9:1 → 偏集中且在 (0,1)", solo !== null && solo > 0.6 && solo < 1, String(solo));

  /* 旧公式对照：它会把"只命中 1 个领域"直接算成 1.0 */
  const oldFormula = 1 - (1 - 1) / 8;
  rec("对照：旧公式 1-(D-1)/8 在 D=1 时 = 1.0（界面 99%）", oldFormula === 1, String(oldFormula));
}

/* ── ④ 体检：零区分度自评不进融合 ─────────────────────────────────────── */
console.log("\n== ④ 零区分度自评：不进融合但保留展示 ==");
{
  /* SBTI 全 M：15 维原始分都是 4 → 折算出的五个维度全是 0.5 */
  const sbtiFlat = {
    source: "sbti",
    label: "SBTI · 显性自评",
    values: { learning: 0.5, creation: 0.5, social: 0.5, stability: 0.5, autonomy: 0.5 },
    itemCount: 15,
    summary: "自评问卷 15 个维度折算而来",
  };
  const zhi = facetFromContents(
    "zhihu",
    "知乎",
    Array.from({ length: 10 }, (_, i) => ({ text: `AI 大模型第 ${i} 条`, heat: 20 })),
    {},
  );

  const insp = inspectFacets([sbtiFlat, zhi]);
  rec("识别出零区分度自评", insp.skipFromFusion.includes("sbti"), JSON.stringify(insp.skipFromFusion));
  rec(
    "给出可读原因",
    insp.warnings.some((w) => w.code === "self-report-no-spread" && /区分度/.test(w.text)),
    insp.warnings.map((w) => w.code).join(","),
  );

  const fused = fuseSourceFacets([sbtiFlat, zhi]);
  rec("融合时把该自评排除在平均之外", fused.skippedSources.includes("sbti"), JSON.stringify(fused.skippedSources));
  rec("参与源里没有 sbti", !fused.usedSources.includes("sbti"), fused.usedSources.join(","));
  rec(
    "结果只由观察源决定（social 不再被 0.5 拉向中间）",
    typeof fused.fused.social === "number" && Math.abs(fused.fused.social - zhi.values.social) < 1e-9,
    `fused.social=${fused.fused.social} zhi.social=${zhi.values.social}`,
  );

  rec("hasNoSpread：全 0.5 → true", hasNoSpread([0.5, 0.5, 0.5, 0.5, 0.5]) === true);
  rec("hasNoSpread：有差异 → false", hasNoSpread([0.2, 0.8, 0.5]) === false);
  rec("hasNoSpread：只有一个值 → false（样本太少不判定）", hasNoSpread([0.5]) === false);
}

/* ── ⑤ 体检：跨源同值 → 该维留空 ──────────────────────────────────────── */
console.log("\n== ⑤ 跨源同值：三个源都是 1% → 该维留空 ==");
{
  const mk = (source, social, creation, autonomy = 0.4) => ({
    source,
    label: source,
    /* 只让 social 三源同值；creation/autonomy 各源不同（真实数据不会全都一样） */
    values: { social, creation, autonomy },
    itemCount: 10,
    summary: "",
  });
  const threeSame = [
    mk("zhihu", 0.01, 0.31, 0.22),
    mk("wechat", 0.01, 0.62, 0.55),
    mk("qq", 0.01, 0.87, 0.71),
  ];
  rec("识别跨源同值", crossSourceIdentical(threeSame, "social") === true);
  rec("不同值的维度不算", crossSourceIdentical(threeSame, "creation") === false);

  const insp = inspectFacets(threeSame);
  rec("该维进入 blankDimensions", insp.blankDimensions.includes("social"), insp.blankDimensions.join(","));
  rec("只有该维被置空（不误伤别的维度）", insp.blankDimensions.length === 1, insp.blankDimensions.join(","));
  rec(
    "警告里带上结构化 keys（调用方据此置空，不靠解析文案）",
    insp.warnings.some((w) => w.code === "cross-source-identical" && w.keys?.includes("social")),
    JSON.stringify(insp.warnings.map((w) => w.keys)),
  );

  const fused = fuseSourceFacets(threeSame);
  rec("融合结果里该维**不存在**（留空，不是 1%）", !("social" in fused.fused), JSON.stringify(fused.fused));
  rec(
    "其它维度照常融合（三源平均）",
    Math.abs((fused.fused.creation ?? 0) - (0.31 + 0.62 + 0.87) / 3) < 1e-9,
    String(fused.fused.creation),
  );
  rec(
    "只要有一个源给出不同的值就不算同值",
    crossSourceIdentical([mk("zhihu", 0.01, 0.3), mk("wechat", 0.30, 0.6)], "social") === false,
  );

  /* 回归：被"零区分度"排除掉的源不能污染这条检查。
     实测：微信/QQ 的创造表达都是 0.99，但 SBTI 那份恒定 0.5 一掺进来
     就"不全相等"了，于是漏判 —— 这个 bug 是在真实数据上发现的。 */
  const flatSbti = {
    source: "sbti",
    label: "SBTI",
    values: { creation: 0.5, social: 0.5 },
    itemCount: 15,
    summary: "",
  };
  const withFlat = [mk("wechat", 0.01, 0.99, 0.4), mk("qq", 0.01, 0.99, 0.4), flatSbti];
  const insp2 = inspectFacets(withFlat);
  rec("零区分度自评被排除", insp2.skipFromFusion.includes("sbti"));
  rec(
    "排除掉它之后，仍能识别出微信/QQ 的创造表达是同值",
    insp2.blankDimensions.includes("creation"),
    insp2.blankDimensions.join(","),
  );
}

console.log(`\n  体检与留空：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
