/**
 * 从知乎公开数据蒸馏真实人物画像。
 *
 * 数据源：知乎公开端点（/members/{token} 与 /members/{token}/pins）。
 * 输出：可直接写进 Persona 的字段 + 逐条可溯源的证据。
 *
 * 刻意用**确定性规则蒸馏**而不是调 LLM：
 *   · 可复现、零成本、可解释
 *   · 每条特征都能溯源到具体哪条内容（产品承诺的"可解释性"）
 *   · 将来接 LLM 时，这是它的输入与兜底
 *
 * 用法（作为 CLI）：
 *   node --env-file=.env scripts/distill-real-people.mjs [--apply]
 *
 * 也可以被其它脚本 import `distill` —— 所以下面的自测代码有
 * 「直接执行才运行」的守卫，避免被 import 时误跑。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { fetchPublicPerson } from "../lib/zhihu/public-profile.ts";

/** 领域词典：命中即认为与该领域相关（从文本反推兴趣） */
export const DOMAIN_LEXICON = {
  人工智能: ["AI", "人工智能", "大模型", "模型", "算法", "智能体", "agent", "Agent", "机器学习"],
  产品设计: ["产品", "体验", "交互", "设计", "用户反馈", "功能", "界面"],
  编程开发: ["代码", "编程", "开发", "程序员", "开源", "写代码", "架构", "调试"],
  创业商业: ["创业", "商业", "增长", "运营", "市场", "融资", "变现"],
  职场成长: ["职场", "工作", "效率", "成长", "管理", "协作"],
  知识科普: ["科普", "原理", "为什么", "解释", "研究", "论文", "科学"],
  人文历史: ["历史", "文化", "文学", "哲学", "思想", "社会"],
  生活日常: ["生活", "日常", "周末", "吃饭", "旅行", "开心", "心情"],
};

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * 从公开资料 + 想法列表蒸馏出人格特征。
 *
 * values 的每一维都由**可观测信号**推断，不是凭空打分：
 *   learning   ← 平均字数（表达密度）
 *   creation   ← 1 − 短评比例（原创长文 vs 定时短推）
 *   social     ← 每篇平均互动（与人连接强度）
 *   stability  ← 发布条数（持续输出）
 *   autonomy   ← 领域集中度（聚焦 vs 泛化）
 */
export function distill(profile, pins) {
  const hitsByDomain = new Map();
  const evidence = [];

  for (const pin of pins) {
    const text = `${pin.title}\n${pin.text}`;
    const hits = [];
    for (const [domain, words] of Object.entries(DOMAIN_LEXICON)) {
      if (words.some((w) => text.includes(w))) {
        hits.push(domain);
        hitsByDomain.set(domain, (hitsByDomain.get(domain) ?? 0) + 1);
      }
    }
    evidence.push({
      pinId: pin.id,
      title: pin.title || pin.text.slice(0, 30),
      hits,
      likes: pin.likeCount,
    });
  }

  const interests = [...hitsByDomain.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);

  const totalLikes = pins.reduce((s, p) => s + p.likeCount, 0);
  const totalComments = pins.reduce((s, p) => s + p.commentCount, 0);
  const topLikes = pins.reduce((m, p) => Math.max(m, p.likeCount), 0);
  const avgChars = pins.length
    ? Math.round(pins.reduce((s, p) => s + p.text.length, 0) / pins.length)
    : 0;
  const shortPinRatio = pins.length
    ? pins.filter((p) => p.text.length < 120).length / pins.length
    : 0;

  const engagementPerPin = pins.length ? totalLikes / pins.length : 0;
  const values = {
    learning: clamp01(avgChars / 600),
    creation: clamp01(1 - shortPinRatio),
    social: clamp01(engagementPerPin / 300),
    stability: clamp01(pins.length / 20),
    autonomy: clamp01(interests.length > 0 ? 1 - (interests.length - 1) / 8 : 0.5),
    career: 0.5,
  };

  const summary = pins.length
    ? `公开内容 ${pins.length} 条，总赞 ${totalLikes}，平均 ${avgChars} 字/条；` +
      `主要涉及 ${interests.slice(0, 3).join("、") || "暂无明确领域"}。`
    : "没有可用的公开内容。";

  return {
    urlToken: profile.urlToken,
    name: profile.name,
    headline: profile.headline,
    ipLocation: profile.ipLocation,
    isOrg: profile.isOrg,
    avatarUrl: profile.avatarUrl,
    interests,
    topics: shortPinRatio > 0.6 ? ["短评/动态"] : ["长文表达", "动态"],
    values,
    summary,
    evidence,
    stats: { pinCount: pins.length, totalLikes, totalComments, topLikes, avgChars, shortPinRatio },
  };
}

/* ── 以下仅在「直接执行」时运行；被 import 时跳过 ── */
const isMain =
  process.argv[1] &&
  import.meta.url.replace(/^file:\/\/\//, "").replace(/\//g, "\\").toLowerCase() ===
    process.argv[1].toLowerCase();

if (isMain) {
  const APPLY = process.argv.includes("--apply");
  const TOKENS = ["zhi-hu-chan-pin-qing-bao-ju", "zhi-hu-ri-bao-51-41"];

  console.log("从知乎公开数据蒸馏真实人物画像");
  console.log("=".repeat(84));

  const t0 = Date.now();
  const results = [];
  for (const token of TOKENS) {
    const r = await fetchPublicPerson(token, 20);
    if (!r.profile.ok || !r.profile.data) {
      console.log(`✗ ${token}: 资料失败 ${r.profile.error}`);
      continue;
    }
    const pins = r.pins.data ?? [];
    const d = distill(r.profile.data, pins);
    results.push(d);

    console.log(`\n★ ${d.name}  ${d.isOrg ? "(机构)" : "(个人)"}  IP 属地 ${d.ipLocation ?? "?"}`);
    console.log(`  headline: ${d.headline || "(空)"}`);
    console.log(
      `  统计: ${d.stats.pinCount} 条 / 总赞 ${d.stats.totalLikes} / 总评 ${d.stats.totalComments} / 最高 ${d.stats.topLikes} / 均 ${d.stats.avgChars} 字`,
    );
    console.log(`  短评比例: ${(d.stats.shortPinRatio * 100).toFixed(0)}%`);
    console.log(`  兴趣: ${d.interests.join(" / ") || "(未命中词典)"}`);
    console.log(`  values: ${Object.entries(d.values).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ")}`);
    console.log(`  摘要: ${d.summary}`);
    console.log(`  证据示例:`);
    for (const e of d.evidence.slice(0, 3)) {
      console.log(`    · [${e.likes}赞] ${e.title.slice(0, 40)}  → 命中 ${e.hits.join(",") || "无"}`);
    }
    await new Promise((r2) => setTimeout(r2, 600));
  }
  const total = Date.now() - t0;

  console.log(`\n${"=".repeat(84)}`);
  console.log(`采集+蒸馏 ${results.length} 位，总耗时 ${(total / 1000).toFixed(1)}s`);
  console.log(`  平均 ${Math.round(total / Math.max(1, results.length))} ms/人`);

  if (APPLY) {
    const prisma = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
    });
    try {
      for (const d of results) {
        await prisma.persona.upsert({
          where: { id: `zhihu-${d.urlToken}` },
          update: {},
          create: {
            id: `zhihu-${d.urlToken}`,
            kind: "synthetic",
            displayName: d.name,
            avatarUrl: d.avatarUrl,
            bio: d.headline,
            province: d.ipLocation,
            city: null,
            interests: d.interests.length ? d.interests : ["知乎内容"],
            topics: d.topics,
            communicationStyle: ["公开表达"],
            values: d.values,
          },
        });
        console.log(`  ✓ 已入库 ${d.name}`);
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
