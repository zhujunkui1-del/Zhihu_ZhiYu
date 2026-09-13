import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";

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
    /* 只在**首次创建**时写入 displayName。
       已存在时不覆盖 —— 否则任何人（包括自动化测试）一登录就会把 demo 用户的
       昵称改掉，演示时看到的是上一次调用者传进来的名字。这个坑实际踩过：
       报告里显示成了「发现页验证用户」。 */
    const user = await tx.user.upsert({
      where: { username: "demo" },
      update: {},
      create: { username: "demo", displayName },
    });

    /* 已有 persona 也要补全人设数据 —— 老库里可能是只有名字的空壳。
       没有这步，已存在的 demo 用户永远拿不到六维分数。

       但**不覆盖已存在的 SBTI**：用户可能真的做过 30 题测试（那份结果比这里的
       演示数据更真实）。只在从未测过时写入演示用的 SBTI。 */
    const existing = await tx.persona.findUnique({ where: { userId: user.id } });
    const existingSbti = (existing?.personality as { sbti?: { type?: string; dimensions?: unknown } } | null)
      ?.sbti;
    const hasRealSbti = Boolean(existingSbti?.type && existingSbti?.dimensions);

    const personaData = hasRealSbti
      ? {
          interests: DEMO_PERSONA.interests,
          topics: DEMO_PERSONA.topics,
          communicationStyle: DEMO_PERSONA.communicationStyle,
          values: DEMO_PERSONA.values as never,
          completeness: DEMO_PERSONA.completeness,
        }
      : DEMO_PERSONA;

    const persona = existing
      ? await tx.persona.update({
          where: { userId: user.id },
          /* 同理不覆盖 displayName：人设名应与用户昵称一致，
             而不是被每次登录的入参刷掉 */
          data: personaData,
        })
      : await tx.persona.create({
          data: { userId: user.id, kind: "human", displayName, ...DEMO_PERSONA },
        });

    await tx.communicationPrefs.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    return { user, persona };
  });

  /* 建立**真实的服务端会话**（HttpOnly Cookie），而不是只把 userId 交给浏览器。
     为什么：页面身份解析 `resolveIdentity()` 生产环境只认会话 Cookie；
     如果演示登录不种 Cookie，生产环境就没有任何可用的登录路径了。
     顺带也比 localStorage 更安全——脚本读不到。 */
  const token = await createSession({ userId: demo.user.id });

  const res = NextResponse.json({
    ok: true,
    userId: demo.user.id,
    personaId: demo.persona.id,
    displayName: demo.user.displayName,
  });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
