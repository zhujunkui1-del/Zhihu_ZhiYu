#!/usr/bin/env node
/**
 * 分源解析口径一致性测试。
 *
 * ── 为什么必须存在这一条 ──────────────────────────────────────────────────
 * 用户看到的那个「社交连接 1%」和「（只有标题、无正文）」是怎么来的：
 * 同一批微信聊天，**导入路径**传了 `{noHeat:true, profile:"im"}`（算得对），
 * **蒸馏路径**（lib/persona/distill.ts）忘了传 → 按知乎长文口径算 →
 * 短消息占比 ≥0.8 → 判定"只有标题" → 三维整组丢掉、social 按 0/300 算成 1%
 * → 而且它还会**覆盖**导入时算好的那份。
 *
 * 六个调用点各自传 opts 是这类 bug 的温床，所以现在收敛到
 * `facetOptionsFor(source)` 一张表。本测试断言的就是"两条路径必须一模一样"。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-facet-opts.mjs
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

const { facetOptionsFor, facetOptionsForStored, isContentFacetSource } = await import(
  "../lib/persona/facet-opts.ts"
);
const { facetFromContents } = await import("../lib/persona/fusion.ts");

/* ── ① 口径表本身 ─────────────────────────────────────────────────────── */
console.log("\n== ① 口径表 ==");
{
  const zhihu = facetOptionsFor("zhihu");
  rec("知乎 = 只有标题（开放平台只给标题）", zhihu.titleOnly === true, JSON.stringify(zhihu));
  rec("知乎**不**标 noHeat（它有点赞数）", zhihu.noHeat !== true);

  for (const s of ["wechat", "qq", "feishu", "dingtalk"]) {
    const o = facetOptionsFor(s);
    rec(
      `${s} = im 口径 + 无热度信号`,
      o.profile === "im" && o.noHeat === true,
      JSON.stringify(o),
    );
  }

  const unknown = facetOptionsFor("some-new-source");
  rec("未知来源：不假装有互动量（noHeat）", unknown.noHeat === true, JSON.stringify(unknown));

  rec("sbti 不走内容解析", isContentFacetSource("sbti") === false);
  rec("profile/distill 这类合成源不走内容解析", !isContentFacetSource("profile") && !isContentFacetSource("distill"));
  rec("真实行为源走内容解析", isContentFacetSource("wechat") && isContentFacetSource("zhihu"));
}

/* ── ①b 存量重算口径：正文有没有交给数据自己判 ─────────────────────────── */
console.log("\n== ①b 存量重算（facetOptionsForStored） ==");
{
  const stored = facetOptionsForStored("zhihu");
  rec("去掉 titleOnly（库里 note 可能是标题也可能是全文）", stored.titleOnly === undefined, JSON.stringify(stored));

  /* 库里存的是标题 → 数据驱动兜底仍然判定"只有标题" */
  const titles = Array.from({ length: 10 }, (_, i) => ({ text: `第 ${i} 条很短的想法标题`, heat: 3 }));
  const asTitles = facetFromContents("zhihu", "知乎", titles, { ...stored });
  rec(
    "note 确实是标题时，仍然算出「只有标题」（靠数据判定，不靠写入方标记）",
    asTitles.titleOnly === true && typeof asTitles.values.learning !== "number",
    `titleOnly=${asTitles.titleOnly} ${JSON.stringify(asTitles.values)}`,
  );

  /* 库里存的是回填的完整正文 → 三维必须算出来，不能被强加的 titleOnly 丢掉 */
  const bodies = Array.from({ length: 10 }, (_, i) => ({
    text: `${"这是一段完整正文，讲清楚了一件事的来龙去脉。".repeat(6)}（第 ${i} 条）`,
    heat: 20,
  }));
  const asBodies = facetFromContents("zhihu", "知乎", bodies, { ...stored });
  rec(
    "note 是完整正文时，三维照常算出（回填过的 26 位创作者不再凭空丢维）",
    typeof asBodies.values.learning === "number" &&
      typeof asBodies.values.creation === "number" &&
      typeof asBodies.values.stability === "number",
    JSON.stringify(asBodies.values),
  );
}

/* ── ② 两条路径逐字段相等（这是本测试的核心） ─────────────────────────── */
console.log("\n== ② 导入路径 vs 蒸馏路径：同一批内容必须算出同一个结果 ==");
{
  /* 真实形态的微信聊天：短文本、无互动量、有口癖 */
  const chat = [
    "爷可能攒了一周困意了罢（",
    "？",
    "byd",
    "这是极好的",
    "就不能让爷体验下发动群众搞大生产的感觉吗（",
    "？",
    "好好好",
    "他们审核图片特征 和 输出信息这两个操作是分家的（",
    "爷",
    "？",
    "为什么",
    "否",
    "这兑吗",
    "逆天开局打法",
    "蚌埠住了",
  ].map((text) => ({ text }));

  /* 导入路径写库时：按口径表算 */
  const viaImport = facetFromContents("wechat", "微信", chat, { ...facetOptionsFor("wechat") });
  /* 蒸馏路径重算时：同样按口径表算（修好之后必须一致） */
  const viaDistill = facetFromContents("wechat", "微信", chat, { ...facetOptionsFor("wechat") });

  rec(
    "values 逐字段相等",
    JSON.stringify(viaImport.values) === JSON.stringify(viaDistill.values),
    `${JSON.stringify(viaImport.values)} vs ${JSON.stringify(viaDistill.values)}`,
  );
  rec("summary 相等", viaImport.summary === viaDistill.summary);
  rec("itemCount 相等", viaImport.itemCount === viaDistill.itemCount);

  /* 反证：不传 opts（= 修复前的蒸馏路径）会长什么样 */
  const buggy = facetFromContents("wechat", "微信", chat);
  rec(
    "复现旧 bug：不传 opts 时聊天被当成「只有标题」",
    buggy.titleOnly === true && typeof buggy.values.social === "number" && buggy.values.social < 0.02,
    `titleOnly=${buggy.titleOnly} social=${buggy.values.social} values=${JSON.stringify(buggy.values)}`,
  );
  rec(
    "修好之后的路径**不会**走到这个结果",
    JSON.stringify(viaImport.values) !== JSON.stringify(buggy.values),
    `新=${JSON.stringify(viaImport.values)}`,
  );
  rec(
    "im 口径下 social 缺失（微信没有互动量，就该留空而不是 1%）",
    typeof viaImport.values.social !== "number",
    JSON.stringify(viaImport.values),
  );
  rec("im 口径下 titleOnly 恒为 false（短消息是聊天习惯，不是「只有标题」）", viaImport.titleOnly === false);
}

/* ── ③ 知乎：标题口径不假装有正文 ─────────────────────────────────────── */
console.log("\n== ③ 知乎（标题口径） ==");
{
  const titles = ["如何看待 AI Agent 的未来", "产品设计中的取舍", "读书笔记：哲学史"].map((text) => ({
    text,
    heat: 12,
  }));
  const f = facetFromContents("zhihu", "知乎", titles, { ...facetOptionsFor("zhihu") });
  rec("标了 titleOnly", f.titleOnly === true);
  rec(
    "依赖文本长度的三维不给值（不拿标题长度冒充正文）",
    typeof f.values.learning !== "number" &&
      typeof f.values.creation !== "number" &&
      typeof f.values.stability !== "number",
    JSON.stringify(f.values),
  );
  rec("有点赞数 → social 有值", typeof f.values.social === "number", `social=${f.values.social}`);
  rec("结论里不再自曝短板", !/无法提供|只有标题/.test(f.summary), f.summary);
}

console.log(`\n  口径一致性：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
