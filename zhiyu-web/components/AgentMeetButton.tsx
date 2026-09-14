"use client";

import { useState } from "react";
import { reportError, reportSuccess, reportWarn } from "@/lib/client/error-bus";
import { toPercentText } from "@/lib/score";

/**
 * 「让 Agent 先聊聊」按钮。
 *
 * 抽成组件的原因：这个动作出现在**三个地方**
 *   · 发现页卡片
 *   · 别人的人格卡弹窗（同事要求：「打开别人的人格卡后，缺少让 agent 先聊聊的按钮」）
 *   · 以后可能还有别的入口
 * 三处各写一份 fetch + 文案，迟早会出现"某处没真调后端"这种事故
 * —— 原先把按钮写成只弹提示不调接口，正是这个坑。
 *
 * 行为：
 *   · 点击后进入"进行中"（一次对话 10~40 秒，必须有反馈）
 *   · 结束后按**真实结果**提示：用了平台/自己的模型，还是只跑了演示对话
 *   · 失败时把后端给的具体原因弹出来（对方关闭了、没有可用模型…）
 */
export interface MeetResponse {
  ok: boolean;
  code?: string;
  error?: string;
  alreadyDone?: boolean;
  llmSource?: "byok" | "platform" | "mock";
  demoMode?: boolean;
  overallScore?: number;
  reportId?: string;
  counterpartName?: string;
  summary?: string;
}

export default function AgentMeetButton({
  targetPersonaId,
  targetName,
  className = "btn btnPrimary",
  /** 完成后回调，调用方可以据此刷新列表或跳到匹配页 */
  onDone,
}: {
  targetPersonaId: string;
  targetName: string;
  className?: string;
  onDone?: (r: MeetResponse) => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = (await fetch("/api/agent/meet", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-silent-error": "1" },
        body: JSON.stringify({ targetPersonaId }),
      }).then((x) => x.json())) as MeetResponse;

      if (!r.ok) {
        /* 有明确业务原因（对方关闭、没有可用模型）时给 warn 而不是 error，
           因为这不是程序故障，是产品规则 */
        const isRule =
          r.code === "AGENT_CLOSED" || r.code === "NO_LLM" || r.code === "SELF_MATCH";
        if (isRule) reportWarn("无法发起 Agent 对话", r.error);
        else reportError(r.error ?? "发起失败", { title: "发起 Agent 对话失败" });
        return;
      }

      if (r.alreadyDone) {
        reportSuccess(
          `你和 ${targetName} 的 Agent 已经聊过了`,
          r.overallScore != null
            ? `综合匹配度 ${toPercentText(r.overallScore)}　（不重复消耗额度，如需重聊请在 Agent 匹配页操作）`
            : undefined,
        );
        onDone?.(r);
        return;
      }

      /* 如实说明这次用的什么模型 —— 不把演示对话说成"大模型聊过了" */
      const how =
        r.llmSource === "platform"
          ? "使用知遇提供的大模型"
          : r.llmSource === "byok"
            ? "使用你接入的模型"
            : "未接上大模型，本次为演示对话";
      reportSuccess(
        `与 ${targetName} 的 Agent 对话已完成`,
        `${how}${r.overallScore != null ? `　·　综合匹配度 ${toPercentText(r.overallScore)}` : ""}`,
      );
      onDone?.(r);
    } catch (e) {
      reportError(e, { title: `与 ${targetName} 的 Agent 对话失败` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      onClick={() => void run()}
      disabled={busy}
      aria-busy={busy}
      data-agent-meet={targetPersonaId}
    >
      {busy ? "Agent 对话中…（约 10~40 秒）" : "让 Agent 先聊聊"}
    </button>
  );
}
