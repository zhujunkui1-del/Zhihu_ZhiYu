import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 演示用户自己的人设数据。
 *
 * 必须有：`lib/matching/quick.ts` 的六个维度全部依赖这些字段。
 * 早期版本创建 persona 时只写了 displayName，导致
 * **Demo 用户的六维全为 null、匹配报告一片空白**。
 *
 * 注意 SBTI `codes` 必须是 **15 位**（`XYX-…` 五组三位，取值 L/M/H），
 * 否则 `codeSim()` 直接返回 null —— 「人格画像相似」与「互补程度」双双失效。
 * 旧数据里的 `DEAD` 就是这个问题。
 */
const DEMO_PERSONA = {
  interests: ["技术伦理", "长文阅读", "写作", "效率工具", "播客"],
  topics: ["技术 × 人文", "慢热但真诚", "自我成长", "系统思维"],
  communicationStyle: ["先想清楚再说", "偏好书面", "就事论事", "结论后置"],
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
    },
  },
  completeness: 60,
};

export async function POST(req: NextRequest) {
  let displayName = "演示用户";
  try {
    const body = (await req.json()) as { displayName?: string };
    if (body.displayName && typeof body.displayName === "string") {
      displayName = body.displayName.trim().slice(0, 40) || displayName;
    }
  } catch {
    // 无 body 时使用默认演示名
  }

  const demo = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { username: "demo" },
      update: { displayName },
      create: { username: "demo", displayName },
    });

    /* 已有 persona 也要补全人设数据 —— 老库里可能是只有名字的空壳。
       没有这步，已存在的 demo 用户永远拿不到六维分数。 */
    const persona = await tx.persona.upsert({
      where: { userId: user.id },
      update: { ...DEMO_PERSONA, displayName },
      create: {
        userId: user.id,
        kind: "human",
        displayName,
        ...DEMO_PERSONA,
      },
    });

    await tx.communicationPrefs.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    return { user, persona };
  });

  return NextResponse.json({
    ok: true,
    userId: demo.user.id,
    personaId: demo.persona.id,
    displayName: demo.user.displayName,
  });
}
