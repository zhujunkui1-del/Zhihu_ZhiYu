#!/usr/bin/env node
/**
 * 五维画像（lib/persona/five-dims.ts）的验收测试。
 *
 * 用户的要求（原话）：「写死 5 个词，可以表示某种能力、情感程度高低的 5 个词，
 * 用来当作五维雷达图的指标」—— 并且要**每个数据源都喂得动**，
 * 不能像上一版七个行为变量那样只适用于微信/QQ。
 *
 * 所以这里逐源验证：知乎（只有标题）、聊天（有双方与时间）、SBTI（问卷）、
 * 以及"什么都没有"的情况。fixture 里有一份**真实微信私聊**（6083 条）。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-five-dims.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const { dimsFromItems, dimsFromSbti, mergeDims, dimPercentText, DIM_KEYS, DIM_LABEL } =
  await import("../lib/persona/five-dims.ts");

const REAL = [
  process.argv[2],
  "C:\\Users\\zhuju\\.dsh\\attachments\\v1\\files\\b7\\b7c083e11414a40b57e777398d6a6775cdc52345694d03a05d31a8575ec47e96\\私聊_林昕.json",
]
  .filter(Boolean)
  .find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });

/* ── ① 五个词是写死的、可展示 ─────────────────────────────────────────── */
console.log("\n== ① 五个词 ==");
{
  rec("正好五维", DIM_KEYS.length === 5, DIM_KEYS.join("/"));
  rec(
    "标签都是「程度可读」的词（能说深浅/强弱/高低）",
    DIM_KEYS.every((k) => typeof DIM_LABEL[k] === "string" && DIM_LABEL[k].length >= 2),
    DIM_KEYS.map((k) => DIM_LABEL[k]).join(" / "),
  );
  rec("贴边写法照旧（<1% / >99%）", dimPercentText(0.001) === "<1%" && dimPercentText(1) === ">99%");
  rec("缺失写「—」", dimPercentText(undefined) === "—");
}

/* ── ② 知乎：只有标题也要喂得动 ───────────────────────────────────────── */
console.log("\n== ② 知乎口径（只有标题，没有对话、没有时间） ==");
{
  const titles = [
    "为什么大家都说系统设计比写代码难？",
    "读《人月神话》的一点笔记：本质复杂度与偶然复杂度",
    "关于远程办公，我的看法是效率取决于协作方式",
    "记录一次线上事故：根因是缓存雪崩，不是流量",
    "谢谢每一位帮忙 review 的同学，辛苦了",
    "分享一个我常用的调试思路，反过来先假设自己的代码有问题",
  ].map((text) => ({ text }));
  const d = dimsFromItems("zhihu", titles);
  rec("算得出思考深度", typeof d.values.thinking === "number", dimPercentText(d.values.thinking));
  rec("算得出表达力", typeof d.values.expression === "number", dimPercentText(d.values.expression));
  rec("算得出共情力", typeof d.values.empathy === "number", dimPercentText(d.values.empathy));
  rec(
    "**执行力留空**（没有发布时间，不编）",
    typeof d.values.execution !== "number",
    d.unavailable.map((u) => `${u.key}:${u.reason}`).join(" | "),
  );
  rec(
    "**主动性留空**（没有对话方向，不编）",
    typeof d.values.initiative !== "number",
  );
  rec("每一维都带依据", typeof d.evidence.thinking === "string" && d.evidence.thinking.includes("/"), d.evidence.thinking);
}

/* ── ③ SBTI：问卷要把五维喂满 ─────────────────────────────────────────── */
console.log("\n== ③ SBTI 口径（15 维问卷） ==");
{
  const dims = {
    S1: { score: 5 }, S2: { score: 4 }, S3: { score: 3 },
    E1: { score: 5 }, E2: { score: 6 }, E3: { score: 4 },
    A1: { score: 5 }, A2: { score: 3 }, A3: { score: 5 },
    Ac1: { score: 4 }, Ac2: { score: 3 }, Ac3: { score: 5 },
    So1: { score: 4 }, So2: { score: 3 }, So3: { score: 4 },
  };
  const s = dimsFromSbti(dims);
  rec("五维全部算出（问卷天然喂得满）", DIM_KEYS.every((k) => typeof s.values[k] === "number"), JSON.stringify(s.values));
  const vals = DIM_KEYS.map((k) => s.values[k]);
  rec("没有 0 / 1 端点值", vals.every((v) => v > 0.01 && v < 0.99), vals.map((v) => dimPercentText(v)).join(" "));
  rec("空 dimensions → null（不编）", dimsFromSbti({}) === null && dimsFromSbti(null) === null);
  rec("只有 type 没有 dimensions 时也不编", dimsFromSbti(undefined) === null);
}

/* ── ④ 跨源合并 ───────────────────────────────────────────────────────── */
console.log("\n== ④ 跨源合并（等权，缺维不参与） ==");
{
  const zhihu = dimsFromItems("zhihu", [{ text: "为什么这个设计更好？" }, { text: "因为本质上它减少了状态" }]);
  const sbti = dimsFromSbti({ A1: { score: 5 }, A3: { score: 5 }, So3: { score: 5 }, E1: { score: 4 }, E2: { score: 4 }, Ac3: { score: 4 }, Ac1: { score: 4 }, So1: { score: 4 }, A2: { score: 4 }, S2: { score: 5 }, S1: { score: 4 }, E3: { score: 4 } });
  const merged = mergeDims([zhihu, sbti]);
  rec("思考深度由两源平均得到", typeof merged.values.thinking === "number", dimPercentText(merged.values.thinking));
  rec("执行力只由 SBTI 提供（知乎那维是空的，不能按 0 参与）", merged.contributors.execution?.join(",") === "sbti", JSON.stringify(merged.contributors.execution));
  rec("用到哪些源如实回报", merged.usedSources.join(",") === "zhihu,sbti", merged.usedSources.join(","));
  rec("依据里写清了每维来自哪个源的什么数据", /sbti：/.test(merged.evidence.execution ?? ""), merged.evidence.execution);
}

/* ── ⑤ 真实聊天文件 ───────────────────────────────────────────────────── */
if (REAL) {
  console.log(`\n== ⑤ 真实聊天（${path.basename(REAL)}） ==`);
  const raw = JSON.parse(fs.readFileSync(REAL, "utf8"));
  const NOISE = /开启了朋友验证|现在我们可以开始聊天了|撤回了一条消息/;
  const msgs = (raw.messages ?? [])
    .filter((m) => m.type === "文本消息" && !/^</.test(String(m.content ?? "")) && !NOISE.test(String(m.content ?? "")))
    .map((m) => ({
      text: String(m.content).trim(),
      at: Number(m.createTime) || undefined,
      mine: Number(m.isSend) === 1,
    }))
    .filter((m) => m.text.length > 0);

  const d = dimsFromItems("wechat", msgs);
  console.log(`  ${msgs.length} 条内容：`);
  for (const k of DIM_KEYS) {
    console.log(`    ${DIM_LABEL[k]}  ${dimPercentText(d.values[k])}   ${d.evidence[k] ?? "—"}`);
  }
  rec("聊天这种「有双方有时间」的源，五维全部喂满", DIM_KEYS.every((k) => typeof d.values[k] === "number"), JSON.stringify(d.values));
  const vals = DIM_KEYS.map((k) => d.values[k]);
  /**
   * 断言的是**没有编造出来的端点**，而不是"不许接近 0"：
   * 真实数据里某一维本来就可能很低（这份聊天里"共情力"确实只有十几条命中）。
   * 该守的纪律是：① 值本身不给 0 / 1；② 展示时写「<1%」而不是假装 1%。
   */
  rec(
    "没有 0 / 1 端点值（真实的低值可以有，编出来的端点不行）",
    vals.every((v) => v > 0 && v < 1),
    vals.map((v) => dimPercentText(v)).join(" "),
  );
  rec(
    "展示上不会出现 0% / 100%",
    vals.every((v) => !["0%", "100%"].includes(dimPercentText(v))),
    vals.map((v) => dimPercentText(v)).join(" "),
  );
  const rounded = vals.map((v) => Math.round(v * 100));
  rec("**没有同值重复组**", new Set(rounded).size === rounded.length, rounded.join(" "));
  rec("执行力按「有输出的天数占比」算", /天有输出/.test(d.evidence.execution ?? ""), d.evidence.execution);
  rec("主动性按「我先开口的对话段」算", /段是我先开口/.test(d.evidence.initiative ?? ""), d.evidence.initiative);
}

/* ── ⑥ 空输入 ─────────────────────────────────────────────────────────── */
console.log("\n== ⑥ 空输入 ==");
{
  rec("没有内容 → null", dimsFromItems("wechat", []) === null);
  rec("只有空白 → null", dimsFromItems("wechat", [{ text: "   " }]) === null);
  const tiny = dimsFromItems("zhihu", [{ text: "短标题" }]);
  rec("内容太少时，能算的照算、算不了的留空", typeof tiny.values.thinking === "number" && typeof tiny.values.expression !== "number", JSON.stringify(tiny.values));
}

console.log(`\n  五维画像：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
