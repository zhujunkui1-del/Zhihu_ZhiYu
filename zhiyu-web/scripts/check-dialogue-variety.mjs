/**
 * 回答区分度检验（用**真实的** runMockAgentDialogue，不是模拟器）。
 *
 * 背景：此前 `answerFor` 的 thinking / values / complementarity 三个分支是固定文案，
 * 导致 16 个示例人格之间 62.5% 的回答重复 —— 报告里的对话看起来像复读。
 * 修复后重跑这个检验，确认区分度真的上去了。
 *
 * 指标：去重率（不同回答数/总回答数）与两两差异度（归一化编辑距离均值）。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { runMockAgentDialogue } from "../lib/agent/dialogue.ts";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const norm = (s) => String(s).replace(/\s+/g, "").replace(/[，。！？、；：""'']/g, "");

function levRatio(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n] / Math.max(m, n);
}

try {
  const people = await prisma.persona.findMany({
    where: { kind: "synthetic" },
    orderBy: { displayName: "asc" },
  });
  console.log(`参与检验的人格：${people.length} 个\n`);

  /* 让每个人格都当一次 A，与固定对手对话，收集其全部回答 */
  const opponent = people[people.length - 1];
  const allA = [];
  const byDimension = new Map();

  for (const p of people) {
    const { rounds } = runMockAgentDialogue(p, opponent);
    for (const r of rounds) {
      allA.push(r.aReply);
      if (!byDimension.has(r.dimension)) byDimension.set(r.dimension, []);
      byDimension.get(r.dimension).push(r.aReply);
    }
  }

  const distinct = new Set(allA.map(norm)).size;
  const ratio = (distinct / allA.length) * 100;

  const uniq = [...new Set(allA.map(norm))];
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < uniq.length; i += 1) {
    for (let j = i + 1; j < uniq.length; j += 1) {
      sum += levRatio(uniq[i], uniq[j]);
      pairs += 1;
    }
  }
  const avgDist = pairs ? (sum / pairs) * 100 : 0;

  console.log("=".repeat(80));
  console.log(`总回答数        ${allA.length}`);
  console.log(`去重后          ${distinct}`);
  console.log(`去重率          ${ratio.toFixed(1)}%   （修复前为 37.5%）`);
  console.log(`两两差异度      ${avgDist.toFixed(1)}%`);
  console.log("=".repeat(80));

  console.log("\n逐维度去重情况：");
  for (const [dim, answers] of byDimension) {
    const d = new Set(answers.map(norm)).size;
    const pct = (d / answers.length) * 100;
    const flag = pct === 100 ? "★" : pct >= 80 ? "·" : "✗";
    console.log(`  ${flag} ${dim.padEnd(18)} ${String(d).padStart(2)}/${answers.length}  ${pct.toFixed(0)}%`);
  }

  console.log("\n回答样例（同一问题，三个人格）：");
  const sample = byDimension.get("values") ?? [];
  for (const s of sample.slice(0, 3)) console.log(`  · ${s}`);

  console.log(
    `\n结论：${ratio >= 90 ? "区分度良好，报告里的对话不再是复读。" : ratio > 37.5 ? `有改善（${ratio.toFixed(0)}%），但仍有重复。` : "没有改善，需要重新排查。"}`,
  );
} finally {
  await prisma.$disconnect();
}
