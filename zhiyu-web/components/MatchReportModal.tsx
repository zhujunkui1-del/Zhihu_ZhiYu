"use client";

import { useEffect, useState } from "react";
import PersonaRadar from "@/components/PersonaRadar";
import Avatar from "@/components/radar/Avatar";
import PersonaCardModal from "@/components/PersonaCardModal";
import { reportError, reportSuccess, reportWarn } from "@/lib/client/error-bus";
import type { ReportView } from "@/lib/agent-match";
import styles from "./MatchReportModal.module.css";

/**
 * 匹配报告弹窗（**就地打开，不跳页**）。
 *
 * ── 为什么抽成组件 ────────────────────────────────────────────────────
 * 产品要求（用户反复强调）：
 *   · 「Agent 匹配」页看报告 → 底部「查看 TA 的人格卡」必须**弹窗**打开对方人格卡，
 *     不能跳 /persona
 *   · 「通知」页点「再看一次」必须**在本页**打开这场匹配报告，不能跳 /agent-match
 *
 * 两处都要弹窗，所以报告内容与"打开对方人格卡"的行为必须共用一份实现；
 * 各写一遍迟早会出现"某一处又跳页了"。
 *
 * `matchId` 与 `report` 二选一：
 *   · 传 `report`：数据已在手上（Agent 匹配页）
 *   · 传 `matchId`：自己拉（通知页只有 matchId）
 */

export default function MatchReportModal({
  report: reportProp,
  matchId,
  onClose,
  /** 已知这份报告是**别人送来**的（通知页从「发来的报告」打开时）→ 不显示送出按钮 */
  received = false,
}: {
  report?: ReportView | null;
  matchId?: string | null;
  onClose: () => void;
  received?: boolean;
}) {
  const [fetched, setFetched] = useState<ReportView | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  /** 送出状态：由接口如实回报（sentToMe 时压根不显示按钮） */
  const [sendState, setSendState] = useState<{
    sentToMe: boolean;
    sentByMe: boolean;
    sending: boolean;
    /** 送出后对方未注册账号时服务端给的说明 */
    notice: string;
  }>({ sentToMe: received, sentByMe: false, sending: false, notice: "" });

  const open = Boolean(reportProp ?? matchId);

  /* 没直接给 report 时，按 matchId 拉一份 */
  useEffect(() => {
    if (reportProp || !matchId) {
      setFetched(null);
      setErr("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr("");
    void (async () => {
      try {
        const r = (await fetch(`/api/matches/${encodeURIComponent(matchId)}/report`, {
          cache: "no-store",
          headers: { "x-silent-error": "1" },
        }).then((x) => x.json())) as
          | { ok: true; report: ReportView; sentToMe?: boolean; sentByMe?: boolean }
          | { ok: false; error?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(r.error ?? "读取匹配报告失败");
        setFetched(r.report);
        /* 服务端是权威：它说"这份是别人送来的"就听它的，
           不管是哪个入口打开的（通知页 / 直接粘贴 matchId） */
        setSendState((s) => ({
          ...s,
          sentToMe: received || r.sentToMe === true,
          sentByMe: r.sentByMe === true,
        }));
      } catch (e) {
        if (cancelled) return;
        setErr((e as Error).message);
        reportError(e, { title: "打开匹配报告失败" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportProp, matchId, received]);

  /* Esc 关闭 + 锁背景滚动 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  /* 报告里点「查看 TA 的人格卡」→ 就地弹对方人格卡（**不再跳 /persona**） */
  const [viewPersona, setViewPersona] = useState<string | null>(null);

  const report = reportProp ?? fetched;
  if (!open) return null;

  return (
    <>
      <div
        className={styles.wrap}
        data-match-report-modal="1"
        role="dialog"
        aria-modal="true"
        aria-label="匹配报告"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />

        <div className={styles.dialog}>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="关闭匹配报告"
          >
            ✕
          </button>

          {loading && !report ? (
            <p className={styles.state}>正在读取匹配报告…</p>
          ) : err ? (
            <p className={styles.stateError}>打不开这份报告：{err}</p>
          ) : report ? (
            <>
              <div className={styles.head}>
                <div>
                  <p className={styles.eyebrow}>匹配报告 · 综合匹配度</p>
                  <h3 className={styles.title} data-report-title="1">
                    你 × {report.counterpart.displayName}
                  </h3>
                </div>
                <div className={styles.score}>
                  <span className={styles.scoreBig}>
                    {report.overall}
                    <small>%</small>
                  </span>
                </div>
              </div>

              {report.demoMode ? (
                <div className={styles.demoNote}>
                  本报告由<b>确定性规则</b>产生（演示模式），不是真实 LLM 的判断。
                  {report.llmError ? `（LLM 调用失败：${report.llmError}）` : ""}
                </div>
              ) : null}

              <div className={styles.grid}>
                <PersonaRadar
                  axes={report.dimensions.map((d) => ({
                    label: d.label,
                    value: d.value == null ? null : d.value / 100,
                  }))}
                  emptyTip="等待 Judge"
                />

                <div className={styles.dimList}>
                  {report.dimensions.map((d) => (
                    <div key={d.key} className={styles.dimRow}>
                      <span className={styles.dimLabel}>{d.label}</span>
                      <span className="track">
                        <i className="trackFill" style={{ width: `${d.value ?? 0}%` }} />
                      </span>
                      <span className={`num ${styles.dimVal}`}>
                        {d.value == null ? "—" : `${d.value}%`}
                      </span>
                    </div>
                  ))}

                  {report.reasons.length ? (
                    <div className={styles.reasons}>
                      <p className={styles.reasonsHead}>为什么推荐你们认识？</p>
                      <ul>
                        {report.reasons.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>

              {report.summary ? (
                <blockquote className={styles.summary}>{report.summary}</blockquote>
              ) : null}

              <div className={styles.roundsBlock}>
                <p className={styles.reasonsHead}>Agent 对话摘录</p>
                <Rounds
                  rounds={report.rounds}
                  meName="你的 Agent"
                  otherName={`${report.counterpart.displayName} 的 Agent`}
                  meSeed={report.me.id}
                  otherSeed={report.counterpart.id}
                />
              </div>

              <div className={styles.actions}>
                {/* 就地弹对方人格卡：与发现页完全一致的交互 */}
                <button
                  type="button"
                  className="btn btnSecondary"
                  onClick={() => setViewPersona(report.counterpart.id)}
                  data-open-persona-from-report={report.counterpart.id}
                >
                  查看 TA 的人格卡
                </button>

                {/**
                 * 把这份报告送给对方。
                 *
                 * ⚠️ **别人送来的报告不显示这个按钮**（用户明确要求）：
                 * 收到报告的人不该再把它打回去。判定以服务端为准
                 * （`sentToMe`），本地只做已知情况下的提前隐藏。
                 */}
                {!sendState.sentToMe ? (
                  <button
                    type="button"
                    className="btn btnPrimary"
                    disabled={sendState.sending || sendState.sentByMe}
                    data-send-report={report.matchId}
                    onClick={() => {
                      if (sendState.sending || sendState.sentByMe) return;
                      setSendState((s) => ({ ...s, sending: true }));
                      void (async () => {
                        try {
                          const r = (await fetch(
                            `/api/matches/${encodeURIComponent(report.matchId)}/send-report`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ fromPersonaId: report.me.id }),
                            },
                          ).then((x) => x.json())) as
                            | { ok: true; sent: boolean; alreadySent?: boolean; reason?: string; to?: string }
                            | { ok: false; error?: string };
                          if (!r.ok) throw new Error(r.error ?? "送出失败");
                          if (r.sent) {
                            setSendState((s) => ({ ...s, sending: false, sentByMe: true }));
                            reportSuccess(
                              r.alreadySent ? "报告之前已经送出过了" : "报告已送出",
                              r.to ? `对方（${r.to}）可在「通知 → 发来的报告」里看到它` : undefined,
                            );
                          } else {
                            /* 对方是 AI 演示人格 / 公开创作者：如实说明，不算成功 */
                            setSendState((s) => ({
                              ...s,
                              sending: false,
                              notice: r.reason ?? "对方还没有知遇账号，无法站内投递。",
                            }));
                            reportWarn("没送出去", r.reason ?? "对方还没有知遇账号。");
                          }
                        } catch (e) {
                          setSendState((s) => ({ ...s, sending: false }));
                          reportError(e, { title: "送出报告失败" });
                        }
                      })();
                    }}
                  >
                    {sendState.sending
                      ? "正在送出…"
                      : sendState.sentByMe
                        ? "已送去"
                        : "给TA送去报告"}
                  </button>
                ) : (
                  <span className="meta" data-report-received="1">
                    这份报告是 TA 送给你的
                  </span>
                )}

                <button type="button" className="btn btnSecondary" onClick={onClose}>
                  关闭
                </button>
              </div>

              {sendState.notice ? (
                <p className="meta" style={{ marginTop: 8 }} data-send-notice="1">
                  {sendState.notice}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* 嵌套弹窗：对方的人格卡。刻意放在报告弹窗**之后**渲染，
          这样它的 z-index 更高、点击不会被报告弹窗吃掉。 */}
      <PersonaCardModal
        personaId={viewPersona}
        onClose={() => setViewPersona(null)}
      />
    </>
  );
}

/** 对话流：按轮次渲染「问题 → A 答 → B 答」 */
function Rounds({
  rounds,
  meName,
  otherName,
  meSeed,
  otherSeed,
}: {
  rounds: { round: number; question: string; aReply: string; bReply: string }[];
  meName: string;
  otherName: string;
  meSeed: string;
  otherSeed: string;
}) {
  if (!rounds.length) {
    return <p className={styles.chatEmpty}>还没有对话内容。</p>;
  }
  return (
    <ol className={styles.rounds}>
      {rounds.map((r) => (
        <li key={r.round} className={styles.round}>
          <div className={styles.qLine}>
            <span className={styles.qBadge}>第 {r.round} 轮</span>
            <p className={styles.qText}>{r.question}</p>
          </div>

          <div className={styles.msg}>
            <span className={styles.msgAva}>
              <Avatar avatarUrl={null} seed={meSeed} width={30} height={30} />
            </span>
            <div className={styles.bubbleA}>
              <span className={styles.who}>{meName}</span>
              <p>{r.aReply}</p>
            </div>
          </div>

          <div className={`${styles.msg} ${styles.msgB}`}>
            <span className={styles.msgAva}>
              <Avatar avatarUrl={null} seed={otherSeed} width={30} height={30} />
            </span>
            <div className={styles.bubbleB}>
              <span className={styles.who}>{otherName}</span>
              <p>{r.bReply}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
