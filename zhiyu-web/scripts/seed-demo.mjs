// 冷启动种子：重建一批明确标注的 AI 演示人格（虚构），用于快速匹配演示。
// 用法：node --env-file=.env scripts/seed-demo.mjs
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const personas = [
  { name: "AI·拿捏者", code: "HHH-HMH-MHH-HHH-MHM", type: "CTRL", title: "拿捏者", interests: ["AI", "效率工具", "规则设计"], topics: ["效率", "系统思维"] },
  { name: "AI·送钱者", code: "HHH-HHM-HHH-HMH-MHL", type: "ATM-er", title: "送钱者", interests: ["付出", "陪伴", "生活"], topics: ["关系", "责任"] },
  { name: "AI·屌丝", code: "MHM-MMH-MHM-HMH-LHL", type: "Dior-s", title: "屌丝", interests: ["躺平", "哲学", "干饭"], topics: ["消费主义", "反内卷"] },
  { name: "AI·领导者", code: "HHH-HMH-MMH-HHH-LHL", type: "BOSS", title: "领导者", interests: ["AI", "管理", "效率"], topics: ["创业", "科技"] },
  { name: "AI·感恩者", code: "MHM-HMM-HHM-MMH-MHL", type: "THAN-K", title: "感恩者", interests: ["音乐", "自然", "生活"], topics: ["感恩", "正念"] },
  { name: "AI·哦不人", code: "HHL-LMH-LHH-HHM-LHL", type: "OH-NO", title: "哦不人", interests: ["安全", "秩序", "整理"], topics: ["风险", "边界"] },
  { name: "AI·行者", code: "HHM-HMH-MMH-HHH-MHM", type: "GOGO", title: "行者", interests: ["旅行", "行动", "美食"], topics: ["出发", "体验"] },
  { name: "AI·尤物", code: "HMH-HHL-HMM-HMM-HLH", type: "SEXY", title: "尤物", interests: ["审美", "穿搭", "表达"], topics: ["魅力", "艺术"] },
  { name: "AI·多情者", code: "MLH-LHL-HLH-MLM-MLH", type: "LOVE-R", title: "多情者", interests: ["情感", "电影", "音乐"], topics: ["爱", "文学"] },
];

try {
  const deleted = await prisma.persona.deleteMany({ where: { kind: "synthetic" } });
  const rows = personas.map((p) => ({
    kind: "synthetic",
    displayName: p.name,
    bio: `AI 演示人格（虚构，明确标注，不代表真人）· SBTI ${p.type}`,
    interests: p.interests,
    topics: p.topics,
    values: { learning: 0.7, creation: 0.6, career: 0.6, social: 0.5 },
    personality: {
      sbti: {
        codes: p.code,
        type: p.type,
        typeTitle: p.title,
        similarity: 100,
        fallback: false,
      },
    },
    completeness: 25,
  }));
  const created = await prisma.persona.createMany({ data: rows });
  console.log(`已删除 synthetic: ${deleted.count}，重建 AI 演示人格: ${created.count}`);
} finally {
  await prisma.$disconnect();
}
