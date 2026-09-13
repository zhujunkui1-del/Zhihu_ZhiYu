/**
 * 把匹配报告发布到知乎圈子（社区 API）。
 *
 * 这是「让 Agent 先替你认识一个人」走出产品、进入知乎社区的出口：
 * 一次真实的 Agent 匹配，产出一条真实的社区动态。
 *
 * ⚠️ 三条硬约束（来自官方文档，必须遵守）
 *   1. 发布想法**每小时最多 5 条** —— 这里做服务端节流，超限直接拒绝
 *   2. 禁止批量/高频/无意义发布，违规会被**收回 app_key 并封号**
 *      → 因此本接口**要求显式确认**（`confirm: true`），不做自动/批量发布
 *   3. 全局限流 10 QPS
 *
 * 另外：Access Secret / app_secret **只在服务端使用**，绝不下发浏览器。
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  CIRCLES,
  publishPin,
  readCommunityConfig,
  type CircleKey,
} from "@/lib/zhihu/community-api";
import { buildAgentMatch } from "@/lib/agent-match";

export const dynamic = "force-dynamic";

/** 每小时发布上限（文档硬约束） */
const MAX_PER_HOUR = 5;

/**
 * 发布节流。
 *
 * 为什么放在数据库而不是内存：Vercel 是多实例 Serverless，
 * 进程内计数无法跨实例共享，等于没有节流。
 * 用 `Notification` 不合适（语义不符），这里直接查 `MatchReport` 的发布时间不可靠
 * （发布与报告生成不是一回事）。
 * 因此用一张专用表 `CommunityPost`。
 */
async function recentPostCount(hours = 1): Promise<number> {
  const since = new Date(Date.now() - hours * 3600_000);
  return prisma.communityPost.count({ where: { createdAt: { gte: since } } });
}

export async function GET() {
  const cfg = readCommunityConfig();
  let used = 0;
  let remaining = MAX_PER_HOUR;
  try {
    used = await recentPostCount();
    remaining = Math.max(0, MAX_PER_HOUR - used);
  } catch {
    /* 表还没迁移时给个保守值 */
  }
  return NextResponse.json({
    ok: true,
    configured: Boolean(cfg),
    circles: Object.entries(CIRCLES).map(([key, v]) => ({ key, ...v })),
    /** 本小时已用 / 剩余额度，前端据此禁用按钮 */
    quota: { limit: MAX_PER_HOUR, used, remaining },
    /** 近 24 小时的发布记录（不含量内容，只给标题摘要） */
    recent: await prisma.communityPost
      .findMany({ orderBy: { createdAt: "desc" }, take: 10 })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          circle: r.circleName,
          title: r.title,
          contentToken: r.contentToken,
          createdAt: r.createdAt,
        })),
      )
      .catch(() => []),
  });
}

export async function POST(req: NextRequest) {
  const cfg = readCommunityConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        code: "NOT_CONFIGURED",
        error: "服务端未配置知乎社区 API 凭证（ZHIHU_COMMUNITY_USER_TOKEN / ZHIHU_COMMUNITY_APP_SECRET）",
      },
      { status: 503 },
    );
  }

  let body: {
    matchId?: string;
    circle?: CircleKey;
    confirm?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  /* ① 必须显式确认 —— 防止被误触发或被当成批量接口用 */
  if (body.confirm !== true) {
    return NextResponse.json(
      { ok: false, code: "NEED_CONFIRM", error: "需要显式确认（confirm: true）才会发布到知乎社区" },
      { status: 400 },
    );
  }

  /* ② 节流：文档写死每小时最多 5 条 */
  const used = await recentPostCount();
  if (used >= MAX_PER_HOUR) {
    return NextResponse.json(
      {
        ok: false,
        code: "RATE_LIMITED",
        error: `已达发布上限（每小时 ${MAX_PER_HOUR} 条），请稍后再试`,
        quota: { limit: MAX_PER_HOUR, used },
      },
      { status: 429 },
    );
  }

  const circleKey: CircleKey = body.circle ?? "hackathon";
  const circle = CIRCLES[circleKey];
  if (!circle) {
    return NextResponse.json({ ok: false, error: `未知圈子 ${String(body.circle)}` }, { status: 400 });
  }

  if (!body.matchId) {
    return NextResponse.json({ ok: false, error: "缺少 matchId" }, { status: 400 });
  }

  /* ③ 取报告内容，组装成一条**有信息量**的动态（不是模板灌水） */
  const match = await prisma.match.findUnique({
    where: { id: body.matchId },
    include: {
      personaA: { select: { displayName: true } },
      personaB: { select: { displayName: true } },
      report: true,
    },
  });
  if (!match?.report) {
    return NextResponse.json(
      { ok: false, error: "这个匹配还没有生成报告，无法发布" },
      { status: 404 },
    );
  }

  const result = (match.report.result ?? {}) as Record<string, unknown>;
  const dims = (result.dimensions ?? {}) as Record<string, number>;
  const reasons = Array.isArray(result.reasons)
    ? result.reasons.filter((x): x is string => typeof x === "string")
    : [];
  const pct = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v)
      ? `${Math.round(v <= 1 ? v * 100 : v)}%`
      : "—";

  const title = `【知遇】两组 Agent 聊完的结论：${pct(match.report.overallScore)}`;
  const lines = [
    `知遇（ZhiYu）· 让 Agent 先替你认识一个人。`,
    ``,
    `本轮匹配：${match.personaA.displayName} × ${match.personaB.displayName}`,
    `综合匹配度 ${pct(match.report.overallScore)}`,
    ``,
    `五维结果：`,
    `· 兴趣同频 ${pct(dims.interest)}`,
    `· 思维共振 ${pct(dims.thinking)}`,
    `· 价值观契合 ${pct(dims.values)}`,
    `· 沟通适配 ${pct(dims.communication)}`,
    `· 互补程度 ${pct(dims.complementarity)}`,
  ];
  if (reasons.length) {
    lines.push("", `为什么推荐他们认识：`, ...reasons.map((r) => `· ${r}`));
  }
  lines.push("", `（本条由知遇 Agent 匹配结果生成，非人工投放）`);
  const content = lines.join("\n");

  /* ④ 发布会话（文档：content_type 固定 "pin"） */
  const r = await publishPin(cfg, { ringId: circle.id, content, title });
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, code: "PUBLISH_FAILED", error: r.error ?? "发布失败", detail: r.raw },
      { status: 502 },
    );
  }

  const contentToken = String(r.data?.content_token ?? "");
  const saved = await prisma.communityPost.create({
    data: {
      matchId: match.id,
      circleKey,
      circleName: circle.name,
      circleId: circle.id,
      title,
      contentToken,
    },
  });

  return NextResponse.json({
    ok: true,
    id: saved.id,
    circle: circle.name,
    contentToken,
    title,
    quota: { limit: MAX_PER_HOUR, used: used + 1 },
  });
}
