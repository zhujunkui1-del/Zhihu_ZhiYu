#!/usr/bin/env node
/**
 * 把真实知乎用户的公开内容**真正写进库**（补齐 PersonaSource + PersonaEvidence）。
 *
 * ── 为什么需要这一步 ───────────────────────────────────────────────────
 * 库里 26 个真实用户（张佳玮 / 毕导 / 丁香医生…）此前只有"结果字段"
 * （interests / topics / bio），但：
 *   · **没有任何 `PersonaSource` 行** → 人格卡上六个源全部显示"未注入"
 *   · **没有任何 `PersonaEvidence` 行** → 没有证据、无法蒸馏（蒸馏要求证据非空）
 * 所以点开对方的人格卡就是一片空，用户看到的就是"对方怎么什么数据都没有"。
 *
 * 本脚本按 `lib/zhihu/sync.ts` 的**同一套写法**补数据：
 *   1) 用 publicRef（知乎 urlToken）抓公开资料 + 想法（pins）
 *   2) 每条想法写一条 PersonaEvidence（带原文链接，可点回核对）
 *   3) upsert PersonaSource: type=zhihu, status=injected
 *   4) 用**真实统计**补 values 六维与 interests（不是编的，全部由 pins 算出）
 *
 * ⚠️ 只覆盖 zhihu 相关的字段，不动 sbti；也不删已有数据。
 *
 * 用法：
 *   node --env-file=.env scripts/backfill-real-zhihu.mjs            # 预览（不写库）
 *   node --env-file=.env scripts/backfill-real-zhihu.mjs --apply    # 真的写
 *   node --env-file=.env scripts/backfill-real-zhihu.mjs --apply --only=张佳玮,毕导
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { fetchPublicPerson } from "../lib/zhihu/public-profile.ts";
import { facetFromContents } from "../lib/persona/fusion.ts";

const APPLY = process.argv.includes("--apply");
const ONLY = (() => {
  const a = process.argv.find((x) => x.startsWith("--only="));
  return a ? new Set(a.slice("--only=".length).split(",").map((s) => s.trim())) : null;
})();

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }),
});

const isBuiltin = (n) => /^演示人格\s*\d+$/.test(n);

/** 领域词典：命中即认为与该领域相关（与 distill-real-people.mjs 保持一致） */
const DOMAIN_LEXICON = {
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

/** 由真实 pins 统计出的 values 六维（每一维都有可观测来源，不是凭空打分） */
function valuesFromPins(pins) {
  const totalLikes = pins.reduce((s, p) => s + p.likeCount, 0);
  const avgChars = pins.length
    ? pins.reduce((s, p) => s + p.text.length, 0) / pins.length
    : 0;
  const shortRatio = pins.length
    ? pins.filter((p) => p.text.length < 120).length / pins.length
    : 0;
  const domains = new Set();
  for (const p of pins) {
    const text = `${p.title}\n${p.text}`;
    for (const [d, words] of Object.entries(DOMAIN_LEXICON)) {
      if (words.some((w) => text.includes(w))) domains.add(d);
    }
  }
  return {
    learning: clamp01(avgChars / 600),
    creation: clamp01(1 - shortRatio),
    social: clamp01((pins.length ? totalLikes / pins.length : 0) / 300),
    stability: clamp01(pins.length / 20),
    autonomy: clamp01(pins.length ? (domains.size ? 1 - (domains.size - 1) / 8 : 0.5) : 0.5),
    career: 0.5,
  };
}

/** 命中词典的兴趣方向（按命中次数排序） */
function interestsFromPins(pins) {
  const hits = new Map();
  for (const p of pins) {
    const text = `${p.title}\n${p.text}`;
    for (const [d, words] of Object.entries(DOMAIN_LEXICON)) {
      if (words.some((w) => text.includes(w))) hits.set(d, (hits.get(d) ?? 0) + 1);
    }
  }
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
}

/**
 * 从**资料本身**（headline + description）推断兴趣。
 *
 * 为什么必须有这条：实测有 3 位用户（梅启铭 / 禁与千寻 / 金时）**公开想法为 0**，
 * 只有资料。若只看 pins，他们就会"零证据"——而蒸馏在零证据时是直接拒绝的，
 * 于是这几个人格卡永远是空的，用户看到的就是"对方怎么什么数据都没有"。
 * 资料里的自我描述也是真实公开数据，可以且应该作为证据。
 */
function interestsFromProfile(profile) {
  const text = `${profile.headline}\n${profile.description}`;
  const hits = [];
  for (const [d, words] of Object.entries(DOMAIN_LEXICON)) {
    if (words.some((w) => text.includes(w))) hits.push(d);
  }
  return hits;
}

/* ── 主流程 ──────────────────────────────────────────────────────────── */
const all = await prisma.persona.findMany({
  select: {
    id: true,
    displayName: true,
    publicRef: true,
    interests: true,
    values: true,
    _count: { select: { evidence: true } },
  },
  orderBy: { displayName: "asc" },
});

const targets = all
  .filter((p) => !isBuiltin(p.displayName))
  .filter((p) => p.publicRef)
  .filter((p) => (ONLY ? ONLY.has(p.displayName) : true));

console.log(`知乎公开数据回填${APPLY ? "（写库）" : "（预览，不写库）"}`);
console.log("=".repeat(86));
console.log(`目标 ${targets.length} 位真实用户\n`);

const t0 = Date.now();
const rows = [];

for (const [i, p] of targets.entries()) {
  const idx = `[${String(i + 1).padStart(2)}/${targets.length}]`;
  let fetched;
  try {
    fetched = await fetchPublicPerson(p.publicRef, 30);
  } catch (e) {
    console.log(`${idx} ${p.displayName.padEnd(14)} ✗ 抓取异常：${String(e.message).slice(0, 70)}`);
    continue;
  }

  const profile = fetched.profile.data;
  const pins = fetched.pins.data ?? [];
  if (!profile) {
    console.log(
      `${idx} ${p.displayName.padEnd(14)} ✗ 资料失败：${String(fetched.profile.error).slice(0, 60)}`,
    );
    continue;
  }

  const interests = [
    ...new Set([...interestsFromPins(pins), ...interestsFromProfile(profile)]),
  ];
  const values = valuesFromPins(pins);
  const totalLikes = pins.reduce((s, x) => s + x.likeCount, 0);

  rows.push({ persona: p, profile, pins, interests, values, totalLikes });

  console.log(
    `${idx} ${p.displayName.padEnd(14)} 资料✓ 想法 ${String(pins.length).padStart(3)} 条 · 总赞 ${String(totalLikes).padStart(7)} · 兴趣命中 ${interests.length || 0} 个${interests.length ? `（${interests.slice(0, 3).join("/")}）` : ""}`,
  );

  /* 温柔一点，别把公开端点打爆 */
  await new Promise((r) => setTimeout(r, 700));
}

const elapsed = Date.now() - t0;
console.log(`\n抓取完成：${rows.length} 位，耗时 ${(elapsed / 1000).toFixed(1)}s，人均 ${Math.round(elapsed / Math.max(1, rows.length))}ms`);

const withPins = rows.filter((r) => r.pins.length > 0).length;
console.log(`有公开想法的：${withPins}/${rows.length}`);

if (!APPLY) {
  console.log("\n（预览模式，未写库。加 --apply 才会写入）");
  await prisma.$disconnect();
  process.exit(0);
}

/* ── 写库 ────────────────────────────────────────────────────────────── */
console.log("\n开始写库…");
let written = 0;
let evidenceTotal = 0;
let facetCount = 0;

for (const r of rows) {
  const { persona, profile, pins, interests, values } = r;

  await prisma.$transaction(async (tx) => {
    /* ① 证据：每条想法一条，带原文链接（"凭什么这么判断"可点回核对）。
          先清掉本源的旧证据，避免重复跑时无限堆积。 */
    await tx.personaEvidence.deleteMany({
      where: { personaId: persona.id, source: "zhihu" },
    });
    for (const pin of pins) {
      /* ⚠️ note 必须存**正文**，不能存标题。
         原先写的是 `pin.title || pin.text`，而实测这条 pin 的 title 就是正文前
         20 字（知乎把正文截断当标题返回），于是库里 604 条证据平均只有 20 字、
         0 条 ≥120 字。后果是"分源解析"拿标题长度当表达密度用，
         所有人的 learning/creation 变成常数、判型全部挤在一型。
         现在正文优先，标题只在没有正文时兜底。 */
      const body = (pin.text || "").trim();
      const title = (pin.title || "").trim();
      const note = body.length >= title.length ? body : title;
      await tx.personaEvidence.create({
        data: {
          personaId: persona.id,
          source: "zhihu",
          trait: "想法",
          value: pin.likeCount,
          note: note.slice(0, 2000),
          url: pin.url || null,
        },
      });
    }
    evidenceTotal += pins.length;

    /* ①c 分源解析结果**在这里算并存下来**。
           此刻手上有完整正文与真实热度（note 会被截断，之后再也算不准），
           所以 facet 必须在写入时算 —— 见 lib/persona/source-facets.ts 的说明。 */
    const facet = facetFromContents("zhihu", "知乎 · 公共表达", pins.map((p) => ({
      text: `${p.title || ""}\n${p.text || ""}`.trim(),
      heat: p.likeCount,
    })));
    if (facet) {
      await tx.personaFeature.upsert({
        where: { personaId_key: { personaId: persona.id, key: "facets:zhihu" } },
        update: { value: facet },
        create: { personaId: persona.id, key: "facets:zhihu", value: facet },
      });
      facetCount += 1;
    }

    /* ①b 资料本身也是一条证据（自我描述 / 一句话介绍）。
           没有它的话，"零想法"的几位用户会一条证据都没有，
           而蒸馏要求证据非空 —— 他们的人格卡就会永远是空的。 */
    const profileUrl = `https://www.zhihu.com/people/${profile.urlToken}`;
    if (profile.headline) {
      await tx.personaEvidence.create({
        data: {
          personaId: persona.id,
          source: "profile",
          trait: "一句话介绍",
          value: null,
          note: profile.headline.slice(0, 200),
          url: profileUrl,
        },
      });
      evidenceTotal += 1;
    }
    if (profile.description) {
      await tx.personaEvidence.create({
        data: {
          personaId: persona.id,
          source: "profile",
          trait: "自我描述",
          value: null,
          note: profile.description.slice(0, 200),
          url: profileUrl,
        },
      });
      evidenceTotal += 1;
    }

    /* ② 六源状态：zhihu 标为已注入 */
    await tx.personaSource.upsert({
      where: { personaId_type: { personaId: persona.id, type: "zhihu" } },
      update: { status: "injected", importedAt: new Date() },
      create: {
        personaId: persona.id,
        type: "zhihu",
        status: "injected",
        importedAt: new Date(),
        meta: {
          urlToken: profile.urlToken,
          pins: pins.length,
          totalLikes: r.totalLikes,
          fetchedAt: new Date().toISOString(),
        },
      },
    });

    /* ③ 结果字段：只补"由真实数据算出"的部分。
          interests 用并集（保留原有标签，不覆盖）；values 直接写真实统计。
          资料里能拿到的头像/签名也一并补上，卡片才不至于空。 */
    const prevInterests = Array.isArray(persona.interests) ? persona.interests : [];
    const merged = [...new Set([...prevInterests, ...interests])];
    const prevIdentity =
      (await tx.persona.findUnique({
        where: { id: persona.id },
        select: { identity: true },
      }))?.identity ?? {};
    const identity = { ...prevIdentity };
    if (profile.avatarUrl) identity.avatarUrl = profile.avatarUrl;
    if (profile.headline) identity.headline = profile.headline;

    await tx.persona.update({
      where: { id: persona.id },
      data: {
        interests: merged.length ? merged : prevInterests,
        values,
        identity,
        publicRef: profile.urlToken,
      },
    });
  });

  written += 1;
}

console.log(`\n完成：写入 ${written} 位，共 ${evidenceTotal} 条证据，${facetCount} 份分源解析`);
console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

await prisma.$disconnect();
