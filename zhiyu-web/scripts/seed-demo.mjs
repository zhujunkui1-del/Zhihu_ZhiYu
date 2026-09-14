/**
 * 冷启动种子：重建一批明确标注的 AI 演示人格（虚构），用于发现页 / 快速匹配演示。
 *
 * 用法：node --env-file=.env scripts/seed-demo.mjs
 *
 * 设计要点（这些是让「五维匹配」真正出分的必要条件）：
 *
 *  1. **五维分数不落库。** 兴趣同频 / 人格画像 / 话题重合 / 价值观 / 沟通适配 / 互补程度
 *     由 `lib/matching/quick.ts` 在运行时实时计算。存进 Persona 会（a）与用户自身属性混淆
 *     （b）它其实是"与某人"的配对结果，随对方变化而失效。
 *     所以这里要做的不是"写分数"，而是**把人设原始数据填足**，让引擎算得出来。
 *
 *  2. **communicationStyle 必须给。** 缺失时「沟通适配」恒为 null，报告上会空一格。
 *     旧的 seed 就没给这个字段。
 *
 *  3. **values 的 key 必须所有人一致。** 引擎只比较两边都存在的数值 key 并取平均差；
 *     key 不一致会导致该维度静默失效。旧 seed 里所有人 values 完全相同，
 *     于是「价值观适配」恒等于 100 —— 那是个假象，不是真的契合。
 *
 *  4. **interests 要有适度重叠但不雷同**，否则 Jaccard 要么恒 0 要么恒 100。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/* 价值观维度：所有人共用同一组 key，取值 0~1 */
const VALUE_KEYS = ["learning", "creation", "career", "social", "stability", "autonomy"];

/**
 * 演示用户**自己**的人设数据。
 *
 * 必须与 `app/api/auth/demo/route.ts` 里的 DEMO_PERSONA 保持一致 ——
 * 快速匹配是「我 vs 候选」，我这侧缺字段会让对应维度恒为 null。
 *
 * 这里额外做一次回填的原因：早期版本的 demo API 创建 persona 时只写了 displayName，
 * 老库里留着没有 interests / topics / communicationStyle / values 的空壳，
 * 且 SBTI codes 是 `DEAD`（不是合法 15 位码）。
 * 光改 API 不会修好已存在的那一行，所以 seed 里显式 upsert 一次。
 */
const DEMO_SELF = {
  interests: ["技术伦理", "长文阅读", "写作", "效率工具", "播客", "哲学", "心理学", "旅行", "经济学", "设计"],
  topics: ["技术 × 人文", "慢热但真诚", "自我成长", "系统思维", "长期主义", "具体的生活"],
  communicationStyle: ["先想清楚再说", "就事论事", "举例子", "偏好书面", "接受反驳", "简短直接"],
  values: {
    learning: 0.88,
    creation: 0.72,
    career: 0.6,
    social: 0.45,
    stability: 0.5,
    autonomy: 0.8,
  },
  personality: {
    sbti: {
      codes: "MHM-MHM-MMM-HMM-MHM",
      type: "深度思考型",
      typeTitle: "深度思考型",
      similarity: 100,
      fallback: false,
      /* 15 个维度的原始分（每维 2 题 × 1~3 分 → 2~6）。
         没有这一段，人格卡页的「综合画像」雷达只会显示"等待蒸馏"。
         取值倾向：自我认知与观念偏高、社交主动性偏低 —— 与「深度思考型」自洽。 */
      dimensions: {
        S1: { score: 5, level: "H" },
        S2: { score: 6, level: "H" },
        S3: { score: 5, level: "H" },
        E1: { score: 4, level: "M" },
        E2: { score: 4, level: "M" },
        E3: { score: 5, level: "H" },
        A1: { score: 5, level: "H" },
        A2: { score: 4, level: "M" },
        A3: { score: 6, level: "H" },
        Ac1: { score: 5, level: "H" },
        Ac2: { score: 5, level: "H" },
        Ac3: { score: 4, level: "M" },
        So1: { score: 3, level: "L" },
        So2: { score: 5, level: "H" },
        So3: { score: 4, level: "M" },
      },
    },
  },
  completeness: 60,
};

/**
 * 沟通风格共享词汇池。
 *
 * 关键：不能给每个倾向一套**正交**的词，否则 Jaccard 交集恒为 0，
 * 「沟通适配」会出现一大批 0 分（实测 16 人里 6 个是 0）。
 * 真实的人本来就会共用一部分表达习惯，所以先取公共词，再叠加倾向专属词。
 */
const COMMON_COMM = ["就事论事", "举例子"];

/* 人格倾向 → 专属沟通风格 */
const COMM_BY_TYPE = {
  深度思考型: ["先想清楚再说", "偏好书面", "结论后置"],
  好奇探索型: ["发散联想", "追问细节", "边说边想"],
  温和共情型: ["先接情绪", "节奏偏慢", "少用断言"],
  理性辩手型: ["先立论", "明确概念", "接受反驳"],
  体验派: ["先做再说", "讲感受", "不爱抽象"],
  务实执行型: ["结论先行", "看落地", "简短直接"],
};

/**
 * 主题共享词汇池。
 * 同理：全用专属词会让「话题重合」只有 2 个取值（实际踩过），
 * 先给每个人 1~2 个公共主题，再叠加专属主题。
 */
const COMMON_TOPICS = ["自我成长", "长期主义"];

/**
 * 兴趣共享词汇池：按人轮换 2~3 个，制造**部分重叠**。
 *
 * 为什么需要：Jaccard = |交| / |并|。两边各 5~6 个词时，
 * 只有 1~2 个公共词会让分数落在 0~15，整体匹配度被压到 30~57，
 * 演示上看不出「有人明显更同频」。加一层共享池后分布升到 45~75。
 */
const COMMON_INTERESTS = [
  "播客", "长文阅读", "效率工具", "生活观察",
  "哲学", "纪录片", "写作", "旅行",
];

/**
 * SBTI 码：15 位，每 3 位一组共 5 组，字符取值 L/M/H（值 1/2/3）。
 * 引擎按位求差后归一化：sim = (1 - dist/30) × 100。
 *
 * 这里从一个基准码出发，按「人格倾向」的亲和度做定向翻转，
 * 使同类型的人彼此更接近、不同类型的人拉开距离 —— 分布是构造出来的，
 * 不是随机数（随机会让每次 seed 出不同结果，无法复现）。
 */
const BASE_CODE = "MMM-MMM-MMM-MMM-MMM";
const CODE_ORDER = { L: 1, M: 2, H: 3 };
const ORDER_CODE = ["L", "M", "H"];

/** 依据 personIndex 确定性地扰动基准码：翻转为 [位置, 目标档位] */
function codesFor(index) {
  const chars = BASE_CODE.replaceAll("-", "").split("");
  /* 每个后续人格翻转的位置逐步增多，制造"距离递增"的分层 */
  const flipCount = Math.min(10, Math.floor(index * 0.8));
  for (let k = 0; k < flipCount; k += 1) {
    const pos = (index * 7 + k * 3) % 15;
    const cur = CODE_ORDER[chars[pos]] ?? 2;
    const next = cur === 3 ? 1 : cur + 1;
    chars[pos] = ORDER_CODE[next - 1];
  }
  const s = chars.join("");
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6, 9)}-${s.slice(9, 12)}-${s.slice(12, 15)}`;
}

/* 人格倾向 → 价值观侧重（共用 key，取值不同） */
const VALUES_BY_TYPE = {
  深度思考型: { learning: 0.92, creation: 0.7, career: 0.5, social: 0.32, stability: 0.55, autonomy: 0.82 },
  好奇探索型: { learning: 0.9, creation: 0.78, career: 0.52, social: 0.62, stability: 0.34, autonomy: 0.74 },
  温和共情型: { learning: 0.6, creation: 0.52, career: 0.44, social: 0.9, stability: 0.7, autonomy: 0.42 },
  理性辩手型: { learning: 0.8, creation: 0.58, career: 0.66, social: 0.5, stability: 0.46, autonomy: 0.78 },
  体验派: { learning: 0.66, creation: 0.72, career: 0.48, social: 0.74, stability: 0.3, autonomy: 0.8 },
  务实执行型: { learning: 0.56, creation: 0.6, career: 0.86, social: 0.46, stability: 0.8, autonomy: 0.6 },
};

/** 16 位示例人格（虚构，明确标注）。id/code/省份城市/倾向/标签/一句话简介与原型一致。 */
const RAW = [
  { code: "01", prov: "浙江", city: "杭州", type: "深度思考型", tags: ["技术 × 人文", "慢热但真诚"], agent: true, sim: 87, desc: "习惯先把事情想清楚再开口；对技术背后的价值判断更感兴趣，喜欢深入但不咄咄逼人的讨论。" },
  { code: "02", prov: "北京", city: "北京", type: "好奇探索型", tags: ["好奇心驱动", "跨学科聊天"], agent: true, sim: 82, desc: "随时在收集新问题；喜欢把两个不相干的领域放在一起聊，愿意先听你的观点再补充。" },
  { code: "03", prov: "上海", city: "上海", type: "温和共情型", tags: ["倾听型", "喜欢具体生活"], agent: false, sim: 76, desc: "对情绪和细节敏感，喜欢从真实生活出发的交流，慢节奏但很有耐心。" },
  { code: "04", prov: "广东", city: "深圳", type: "理性辩手型", tags: ["观点碰撞", "先讲逻辑"], agent: true, sim: 79, desc: "享受观点被认真挑战的感觉；讨论时先立论再反驳，不喜欢含糊其辞。" },
  { code: "05", prov: "北京", city: "北京", type: "深度思考型", tags: ["写作与阅读", "低社交需求"], agent: true, sim: 84, desc: "表达偏向书面与准确；在熟悉话题上话很多，陌生场合则保持观察。" },
  { code: "06", prov: "四川", city: "成都", type: "体验派", tags: ["行动派", "先试再说"], agent: false, sim: 71, desc: "更相信体验而不是标签；喜欢被邀请参与具体的事，而不是抽象的自我介绍。" },
  { code: "07", prov: "北京", city: "北京", type: "深度思考型", tags: ["哲学", "长文阅读"], agent: true, sim: 85, desc: "喜欢把一个问题拆到最底层再回答；不急着给结论，更在意推理过程是否站得住。" },
  { code: "08", prov: "浙江", city: "杭州", type: "好奇探索型", tags: ["硬件", "动手做"], agent: true, sim: 79, desc: "喜欢把想法做成能跑起来的东西；聊到实现细节时话会变多。" },
  { code: "09", prov: "广东", city: "广州", type: "温和共情型", tags: ["倾听", "人际关系"], agent: false, sim: 74, desc: "对关系的细微变化很敏感；更愿意先接住对方的情绪，再谈事情本身。" },
  { code: "10", prov: "陕西", city: "西安", type: "体验派", tags: ["旅行", "纪录片"], agent: true, sim: 88, desc: "习惯用亲历代替想象；喜欢把路上看到的片段记下来，慢慢攒成自己的判断。" },
  { code: "11", prov: "湖北", city: "武汉", type: "理性辩手型", tags: ["经济学", "辩论"], agent: true, sim: 81, desc: "享受被认真反驳；讨论时先明确概念边界，不接受含糊的表述。" },
  { code: "12", prov: "广东", city: "深圳", type: "务实执行型", tags: ["工程", "效率工具"], agent: true, sim: 83, desc: "先看能不能落地，再谈好不好看；讨厌把简单的事情流程化。" },
  { code: "13", prov: "江苏", city: "南京", type: "深度思考型", tags: ["历史", "写作"], agent: false, sim: 69, desc: "习惯把当下的问题放回更长的时间尺度里看；表达偏书面，追求准确。" },
  { code: "14", prov: "四川", city: "成都", type: "好奇探索型", tags: ["音乐", "播客"], agent: true, sim: 77, desc: "通过声音认识世界；喜欢把不同领域的表达方式放在一起比较。" },
  { code: "15", prov: "上海", city: "上海", type: "温和共情型", tags: ["教育", "亲子"], agent: true, sim: 80, desc: "更在意沟通里对方是否被听见；节奏偏慢，但一旦建立信任会很坦诚。" },
  { code: "16", prov: "福建", city: "厦门", type: "务实执行型", tags: ["设计", "手作"], agent: false, sim: 73, desc: "喜欢把想法落到具体的手感上；比起讨论概念，更愿意先做出一个样品。" },
];

/* 兴趣：由标签与倾向展开成可比较的词组。
   适度重叠（同倾向的人共享一部分词）但不雷同，Jaccard 才有区分度。 */
const INTERESTS_BY_TYPE = {
  深度思考型: ["哲学", "长文阅读", "写作", "技术伦理"],
  好奇探索型: ["跨学科", "播客", "科普", "新工具"],
  温和共情型: ["心理学", "人际关系", "生活观察", "倾听"],
  理性辩手型: ["经济学", "辩论", "逻辑学", "政策"],
  体验派: ["旅行", "纪录片", "美食", "户外"],
  务实执行型: ["工程", "效率工具", "设计", "手作"],
};

function makeRows() {
  return RAW.map((r, i) => {
    const codes = codesFor(i);
    /* 沟通风格与主题都先取公共词，再叠加倾向专属词 ——
       全用专属词会让 Jaccard 交集恒为 0，维度失去区分度。 */
    const comm = [...new Set([...(COMM_BY_TYPE[r.type] ?? []), ...COMMON_COMM])];
    const vals = VALUES_BY_TYPE[r.type] ?? {};
    /* 兴趣 = 倾向专属 + 本人标签 + 轮换的共享词（制造部分重叠） */
    const shared = [
      COMMON_INTERESTS[i % COMMON_INTERESTS.length],
      COMMON_INTERESTS[(i * 3 + 2) % COMMON_INTERESTS.length],
      COMMON_INTERESTS[(i * 5 + 5) % COMMON_INTERESTS.length],
    ];
    const interests = [...new Set([...(INTERESTS_BY_TYPE[r.type] ?? []), ...r.tags, ...shared])];
    const topics = [...new Set([...COMMON_TOPICS, ...r.tags, r.type])];
    return {
      kind: "synthetic",
      displayName: `演示人格 ${r.code}`,
      bio: `AI 演示人格（虚构，明确标注，不代表真人）· ${r.type}`,
      province: r.prov,
      city: r.city,
      /* 原型里 16 人中有 5 位标记为不开放 Agent 对话；
         发现页据此隐藏「让 Agent 先聊聊」按钮。 */
      agentOpen: r.agent,
      interests,
      topics,
      communicationStyle: comm,
      values: vals,
      socialStyle: { agentOpen: r.agent, pace: r.type === "温和共情型" ? "slow" : "medium" },
      personality: {
        sbti: {
          codes,
          type: r.type,
          typeTitle: r.type,
          similarity: r.sim,
          fallback: false,
        },
      },
      /* 演示数据完整度高于真人冷启动（因为字段是刻意补齐的） */
      completeness: 46,
    };
  });
}

/** 自检：保证每个人设都带齐引擎需要的字段，否则五维会静默变 null */
function assertShape(rows) {
  const problems = [];
  rows.forEach((r, i) => {
    if (!Array.isArray(r.interests) || r.interests.length < 2) problems.push(`#${i} interests 不足`);
    if (!Array.isArray(r.topics) || r.topics.length < 2) problems.push(`#${i} topics 不足`);
    if (!Array.isArray(r.communicationStyle) || r.communicationStyle.length < 2)
      problems.push(`#${i} communicationStyle 缺失（沟通适配会变 null）`);
    const keys = Object.keys(r.values ?? {});
    if (keys.length !== VALUE_KEYS.length) problems.push(`#${i} values key 数不符`);
    for (const k of VALUE_KEYS) if (typeof r.values[k] !== "number") problems.push(`#${i} values.${k} 缺失`);
    if (!r.personality?.sbti?.codes) problems.push(`#${i} 缺 SBTI codes`);
    if (!r.province || !r.city) problems.push(`#${i} 缺地区`);
  });
  return problems;
}

try {
  const rows = makeRows();
  const problems = assertShape(rows);
  if (problems.length) {
    console.error("自检未通过，已中止写入：");
    problems.slice(0, 12).forEach((p) => console.error("  - " + p));
    process.exitCode = 1;
  } else {
    /* ⚠️ 只清理**内置演示人格**，绝不能按 kind 全删。
       真实知乎公开创作者的 kind 同样是 "synthetic"，早先这里写成
       `deleteMany({ where: { kind: "synthetic" } })`，一跑就把 27 位真实
       创作者连同回填的 600+ 条证据全部删掉 —— 实际踩过这个坑。

       判据（已实测互斥，见 scripts/check-persona-discriminator.mjs）：
         · 内置演示人格：名字匹配 `演示人格 NN`，且没有 publicRef
         · 真实创作者：有 publicRef（知乎 urlToken）
       这里要求"名字像演示人格"**且**"没有 publicRef"两个条件同时成立，
       多一道保险：万一以后有真实用户被命名为类似格式，也不会被误删。 */
    const demoWhere = {
      kind: "synthetic",
      displayName: { startsWith: "演示人格" },
      publicRef: null,
    };
    const deleted = await prisma.persona.deleteMany({ where: demoWhere });
    const created = await prisma.persona.createMany({ data: rows });
    console.log(`已清理旧演示人格: ${deleted.count} 个（真实创作者不受影响）`);
    console.log(`已重建 AI 演示人格: ${created.count} 个`);
    const provs = [...new Set(rows.map((r) => r.province))];
    console.log(`覆盖省份 ${provs.length} 个：${provs.join("、")}`);
    console.log(`SBTI 码样例：${rows[0].personality.sbti.codes} / ${rows[15].personality.sbti.codes}`);

    /* 回填演示用户自己的人设（见 DEMO_SELF 注释） */
    const demoUser = await prisma.user.findUnique({ where: { username: "demo" } });
    if (demoUser) {
      const before = await prisma.persona.findUnique({ where: { userId: demoUser.id } });
      const filled = await prisma.persona.upsert({
        where: { userId: demoUser.id },
        update: DEMO_SELF,
        create: {
          userId: demoUser.id,
          kind: "human",
          displayName: "演示用户",
          ...DEMO_SELF,
        },
      });
      /* 顺带把昵称归位：早期 demo 登录会覆盖 displayName，
         自动化测试跑过之后会留下「XX验证用户」这类名字。 */
      if (demoUser.displayName !== "演示用户") {
        await prisma.user.update({
          where: { id: demoUser.id },
          data: { displayName: "演示用户" },
        });
        await prisma.persona.update({
          where: { id: filled.id },
          data: { displayName: "演示用户" },
        });
        console.log(`演示用户昵称已归位：「${demoUser.displayName}」→「演示用户」`);
      }
      const hadData = Boolean(before?.interests && before?.communicationStyle);
      console.log(
        `演示用户人设：${hadData ? "原已有数据，已覆盖为完整版" : "原为空壳，已补全"}（${filled.id.slice(0, 12)}…）`,
      );
    } else {
      console.log("未找到 demo 用户（尚未登录过），跳过回填");
    }
  }
} finally {
  await prisma.$disconnect();
}
