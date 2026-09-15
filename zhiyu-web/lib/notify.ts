/**
 * 通知中心数据装配。
 *
 * 通知的 `type` 是数据库里的原始值（如 `agent_completed`），
 * 而页面要按「对话完成 / 发来的报告」两个分组筛选，
 * 所以这里统一做一次分类映射，避免页面里散落 if-else。
 */

import { prisma } from "@/lib/db";

/** 页面上的两个分组 */
export type NotifyCategory = "done" | "report";

export interface NotifyItemView {
  id: string;
  type: string;
  category: NotifyCategory;
  /** 分类标签，如「Agent 对话完成」 */
  kindLabel: string;
  title: string;
  desc: string;
  read: boolean;
  createdAt: Date;
  /** 可跳转的匹配 id（若有） */
  matchId: string | null;
  /** 综合匹配度（0~100 的整数）；无报告时为 null */
  overall: number | null;
}

export interface NotifyData {
  items: NotifyItemView[];
  unread: number;
  counts: Record<"all" | NotifyCategory, number>;
}

/** type → 分组 + 标签 */
function categoryOf(type: string): { category: NotifyCategory; label: string } {
  switch (type) {
    case "agent_completed":
      return { category: "done", label: "Agent 对话完成" };
    case "report_received":
      return { category: "report", label: "对方发来的报告" };
    case "agent_started":
      return { category: "done", label: "Agent 对话开始" };
    case "agent_failed":
      return { category: "done", label: "Agent 对话中断" };
    default:
      /* 未登记的类型归入「对话完成」而不是丢弃 —— 宁可多显示也不要静默吞掉 */
      return { category: "done", label: "系统通知" };
  }
}

/* overallScore 在库里是 0~1 的小数（如 0.52），页面要显示百分数。
   换算逻辑统一在 lib/score.ts —— 原先这里自己抄了一份，散在多处迟早不一致。 */
import { clampPercent, toPercent as scoreToPercent } from "@/lib/score";

function toPercent(v: unknown): number | null {
  /* 展示值再收进 [1, 99]：产品要求界面上不出现 0% / 100%。 */
  return clampPercent(scoreToPercent(typeof v === "number" ? v : null));
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function buildNotify(userId: string): Promise<NotifyData> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const items: NotifyItemView[] = rows.map((n) => {
    const p = (n.payload ?? {}) as Record<string, unknown>;
    const { category, label } = categoryOf(n.type);
    const who = str(p.counterpart) || str(p.counterpartName) || "对方";
    const overall = toPercent(p.overallScore ?? p.overall);

    let title = "有一条新通知";
    let desc = "";
    if (n.type === "agent_completed") {
      title = `你与 ${who} 的 Agent 对话已完成`;
      desc =
        overall != null
          ? `两个 Agent 聊完了。综合匹配度 ${overall}%，可以看看它们聊了些什么。`
          : "两个 Agent 聊完了，可以看看它们聊了些什么。";
    } else if (n.type === "report_received") {
      title = `${who} 把匹配报告发给了你`;
      desc =
        overall != null
          ? `对方完成与你的 Agent 对话后把报告发了过来，综合匹配度 ${overall}%。`
          : "对方完成与你的 Agent 对话后把报告发了过来。";
    } else if (n.type === "agent_started") {
      title = `与 ${who} 的 Agent 对话已开始`;
      desc = "你的 Agent 正在后台和对方交流，有进展会通知你。";
    } else if (n.type === "agent_failed") {
      title = `与 ${who} 的 Agent 对话中断了`;
      desc = "可能是对方的模型配置有问题，可以稍后重试。";
    } else {
      const t = str(p.title);
      if (t) title = t;
      desc = str(p.desc);
    }

    return {
      id: n.id,
      type: n.type,
      category,
      kindLabel: label,
      title,
      desc,
      read: Boolean(n.readAt),
      createdAt: n.createdAt,
      matchId: str(p.matchId) || null,
      overall,
    };
  });

  return {
    items,
    unread: items.filter((i) => !i.read).length,
    counts: {
      all: items.length,
      done: items.filter((i) => i.category === "done").length,
      report: items.filter((i) => i.category === "report").length,
    },
  };
}
