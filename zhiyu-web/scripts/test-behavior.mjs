#!/usr/bin/env node
/**
 * 可数行为变量（lib/persona/behavior.ts）的验收测试。
 *
 * fixture 用的是**真实数据**：一份 6083 条的微信私聊导出
 * （`私聊_林昕.json`，WeFlow 格式，自带 createTime 与 isSend）。
 * 用真实文件而不是编造的数组，是因为这批指标的全部风险就在"真实数据长什么样"：
 *   · 消息极短（中位 4 字）
 *   · 大量重复口癖（「？」×103、「byd」×110）
 *   · 时间跨度两年但只有 212 天有交流
 *   · 深夜占比 30%
 * 换成整齐的测试数组，这些特性一个都测不出来。
 *
 * 用法：
 *   node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-behavior.mjs [path/to/chat.json]
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

const {
  behaviorFromItems,
  lexicalDiversity,
  replySpeedScore,
  topicFocusScore,
  behaviorPercent,
  BEHAVIOR_KEYS,
  PERSONAL_KEYS,
  RELATIONAL_KEYS,
} = await import("../lib/persona/behavior.ts");
const { interestCountsFromTexts } = await import("../lib/persona/fusion.ts");

/* ── fixture：真实聊天文件（找不到就跳过，但明确说明跳过了） ─────────── */
const CANDIDATES = [
  process.argv[2],
  path.resolve("../RECON/.fixtures/私聊_林昕.json"),
  "C:\\Users\\zhuju\\.dsh\\attachments\\v1\\files\\b7\\b7c083e11414a40b57e777398d6a6775cdc52345694d03a05d31a8575ec47e96\\私聊_林昕.json",
].filter(Boolean);

const file = CANDIDATES.find((p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
});

if (!file) {
  console.log("  [SKIP] 找不到真实聊天 fixture（私聊_林昕.json），只跑合成用例");
}

/* ── ① 纯函数边界 ─────────────────────────────────────────────────────── */
console.log("\n== ① 三个纯函数的边界 ==");
{
  rec("空内容 → null", behaviorFromItems("wechat", []) === null);
  rec("全空白 → null", behaviorFromItems("wechat", [{ text: "   " }]) === null);

  rec("TTR：词量太少 → null", lexicalDiversity(["短"]) === null);
  rec(
    "TTR：完全重复的文本 → 很低",
    (() => {
      const v = lexicalDiversity(Array.from({ length: 300 }, () => "同意同意"));
      return v !== null && v < 0.2;
    })(),
  );
  rec(
    "TTR：用词丰富 → 明显更高",
    (() => {
      const a = lexicalDiversity(Array.from({ length: 300 }, () => "同意同意"));
      /* ⚠️ 期望值只能定"方向 + 量级"，不能定一个好看的绝对数：
         中文 TTR 随文本长度快速下降，短消息组成的合成语料天然到不了
         真实聊天那种 0.43（那是 3988 条真实消息的结果）。
         这里用 8 个词的组合 + 递增序号，实测 ≈0.051，而复读文本 ≈0.002。 */
      const WORDS = [
        "人工智能", "产品设计", "编程开发", "创业商业",
        "职场成长", "知识科普", "人文历史", "生活日常",
      ];
      const b = lexicalDiversity(
        Array.from({ length: 300 }, (_, i) => WORDS[i % 8] + WORDS[(i * 3) % 8] + WORDS[(i * 5) % 8] + i),
      );
      return a !== null && b !== null && a < 0.01 && b > 0.03 && b > a * 5;
    })(),
  );

  rec("回应速度：24 小时以上 → null（不构成对话）", replySpeedScore(90000) === null);
  rec("回应速度：0 或负数 → null", replySpeedScore(0) === null && replySpeedScore(-5) === null);
  const s48 = replySpeedScore(48);
  const s5m = replySpeedScore(300);
  const s30m = replySpeedScore(1800);
  rec(
    "回应速度：单调递减且都落在中间区间",
    s48 !== null && s5m !== null && s30m !== null && s48 > s5m && s5m > s30m && s48 < 0.9 && s30m > 0.1,
    `48秒=${s48?.toFixed(3)} 5分=${s5m?.toFixed(3)} 30分=${s30m?.toFixed(3)}`,
  );

  rec("话题集中度：<2 个方向 → null", topicFocusScore(new Map([["a", 9]])) === null);
  rec("话题集中度：均分 → 0", topicFocusScore(new Map([["a", 1], ["b", 1]])) === 0);

  rec("behaviorPercent：收进 [1,99]", behaviorPercent(0) === 1 && behaviorPercent(1) === 99);
  rec("behaviorPercent：缺失 → null", behaviorPercent(undefined) === null);
  rec("个人属性 + 关系属性 = 全部变量", PERSONAL_KEYS.length + RELATIONAL_KEYS.length === BEHAVIOR_KEYS.length);
}

/* ── ② 真实数据 ───────────────────────────────────────────────────────── */
if (file) {
  console.log(`\n== ② 真实聊天文件：${path.basename(file)} ==`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const NOISE = /开启了朋友验证|现在我们可以开始聊天了|撤回了一条消息/;
  const msgs = (raw.messages ?? [])
    .filter((m) => m.type === "文本消息" && !/^</.test(String(m.content ?? "")) && !NOISE.test(String(m.content ?? "")))
    .map((m) => ({
      text: String(m.content).trim(),
      at: Number(m.createTime) || undefined,
      mine: Number(m.isSend) === 1,
    }))
    .filter((m) => m.text.length > 0);

  rec("解析出足够多的文本消息", msgs.length > 3000, `${msgs.length} 条`);

  const domainCounts = interestCountsFromTexts(msgs.map((m) => m.text));
  const f = behaviorFromItems("wechat", msgs, { domainCounts });
  rec("算出行为变量", f !== null);

  console.log(`  覆盖：${f.coverage.items} 条 / ${f.coverage.days} 天有交流 / 跨 ${f.coverage.spanDays} 天（${f.coverage.range}）`);
  for (const k of BEHAVIOR_KEYS) {
    const v = f.variables[k];
    console.log(
      `  ${k.padEnd(11)} ${typeof v === "number" ? (v * 100).toFixed(1) + "%" : "—（留空）"}` +
        `${f.evidence[k] ? `   依据：${f.evidence[k]}` : ""}`,
    );
  }
  for (const x of f.facts) console.log(`  [事实] ${x.label}：${x.display}`);

  rec(
    "至少算出 5 个变量（真实数据里大部分都能量到）",
    Object.keys(f.variables).length >= 5,
    Object.keys(f.variables).join(","),
  );
  rec("主动发起率有值且在 (0.3, 0.7)", f.variables.initiative > 0.3 && f.variables.initiative < 0.7, String(f.variables.initiative));
  rec(
    "回应速度有值（双方都是秒回级，应高于 50%）",
    typeof f.variables.replySpeed === "number" && f.variables.replySpeed > 0.5,
    String(f.variables.replySpeed),
  );
  rec(
    "活跃天占比明显低于 100%（两年里只有部分天在聊）",
    typeof f.variables.activeDays === "number" && f.variables.activeDays > 0.1 && f.variables.activeDays < 0.6,
    String(f.variables.activeDays),
  );
  rec(
    "深夜活跃在 (0.2, 0.5)（实测约 30%）",
    f.variables.lateNight > 0.2 && f.variables.lateNight < 0.5,
    String(f.variables.lateNight),
  );
  rec(
    "表达丰富度在 (0.3, 0.6)（实测约 43%，不再是恒定的 99%）",
    f.variables.lexical > 0.3 && f.variables.lexical < 0.6,
    String(f.variables.lexical),
  );
  rec("提问求知率有值且不高（(0.03, 0.2)）", f.variables.inquiry > 0.03 && f.variables.inquiry < 0.2, String(f.variables.inquiry));
  rec("话题集中度有值（多方向均分，应偏低）", typeof f.variables.topicFocus === "number" && f.variables.topicFocus < 0.5, String(f.variables.topicFocus));

  /* 核心承诺：没有极端值、没有重复值组 */
  const vals = Object.values(f.variables).filter((v) => typeof v === "number");
  const extremes = vals.filter((v) => v >= 0.95 || v <= 0.05);
  rec("**没有极端值**（全部落在 5%~95%）", extremes.length === 0, vals.map((v) => (v * 100).toFixed(1) + "%").join(" "));
  const rounded = vals.map((v) => (v * 100).toFixed(0));
  rec("**没有同值重复组**（换算成整数百分比后互不相同）", new Set(rounded).size === rounded.length, rounded.join(" "));

  /* 关系属性 vs 个人属性的分类要正确 */
  rec(
    "关系属性（主动发起率/回应速度）确实有值、个人属性也有值 —— 分类没搞反",
    PERSONAL_KEYS.every((k) => typeof f.variables[k] === "number") &&
      RELATIONAL_KEYS.every((k) => typeof f.variables[k] === "number"),
  );

  /* 缺时间戳时不能硬算 */
  const noTime = behaviorFromItems("wechat", msgs.map((m) => ({ text: m.text, mine: m.mine })));
  rec(
    "去掉时间戳后：时间类指标留空，而不是给 0",
    typeof noTime.variables.activeDays !== "number" &&
      typeof noTime.variables.lateNight !== "number" &&
      typeof noTime.variables.replySpeed !== "number",
    Object.keys(noTime.variables).join(","),
  );
  rec(
    "去掉时间戳这件事会如实记在 unavailable 里",
    noTime.unavailable.some((u) => u.reason === "没有时间戳"),
    noTime.unavailable.map((u) => u.key).join(","),
  );
  rec("没有时间戳时，非时间类指标（表达丰富度/提问）照常算出", typeof noTime.variables.lexical === "number" && typeof noTime.variables.inquiry === "number");
}

/* ── ③ 合成用例：观察期太短/段数太少时留空 ───────────────────────────── */
console.log("\n== ③ 样本不足时留空（不硬算） ==");
{
  const short = behaviorFromItems(
    "wechat",
    [
      { text: "第一条消息内容够长了", at: 1_700_000_000, mine: true },
      { text: "第二条消息", at: 1_700_000_060, mine: false },
    ],
    {},
  );
  rec("观察期不足 7 天 → 活跃天占比留空", typeof short.variables.activeDays !== "number");
  rec("对话段太少 → 主动发起率留空", typeof short.variables.initiative !== "number");
  rec("内容太少 → 表达丰富度留空", typeof short.variables.lexical !== "number");
  rec("提问率这种不依赖样本量的指标照常算出", typeof short.variables.inquiry === "number");
}

console.log(`\n  行为变量：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
