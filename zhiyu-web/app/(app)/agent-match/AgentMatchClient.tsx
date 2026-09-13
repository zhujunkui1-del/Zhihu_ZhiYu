"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/radar/Avatar";
import PersonaRadar from "@/components/PersonaRadar";
import type { AgentMatchData, ReportView, SessionView } from "@/lib/agent-match";
import styles from "./agent-match.module.css";

type Tab = "running" | "reports";

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "对话中",
  analyzing: "分析中",
  completed: "已完成",
  failed: "已中断",
};

/** 状态 → 胶囊样式类 */
function statusClass(s: string): string {
  if (s === "running" || s === "analyzing") return styles.pillRun;
  if (s === "completed") return styles.pillDone;
  if (s === "failed") return styles.pillFail;
  return styles.pillTodo;
}

function fmtDate(d: Date | string): string {
  const t = new Date(d);
  return t.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AgentMatchClient({
  data,
  personaId,
  focusMatchId,
}: {
  data: AgentMatchData;
  personaId: string;
  focusMatchId: string | null;
}) {
  /* 有 focusMatchId 时直接落到对应页签，省一次点击 */
  const initialTab: Tab = useMemo(() => {
    if (!focusMatchId) return "running";
    return data.reports.some((r) => r.matchId === focusMatchId) ? "reports" : "running";
  }, [data.reports, focusMatchId]);

  const [tab, setTab] = useState<Tab>(initialTab);
  const [openSession, setOpenSession] = useState<SessionView | null>(null);
  const [openReport, setOpenReport] = useState<ReportView | null>(null);

  /* 从通知点进来时自动展开那一条 */
  useEffect(() => {
    if (!focusMatchId) return;
    const r = data.reports.find((x) => x.matchId === focusMatchId);
    if (r) {
      setTab("reports");
      setOpenReport(r);
      return;
    }
    const s = data.sessions.find((x) => x.matchId === focusMatchId);
    if (s) {
      setTab("running");
      setOpenSession(s);
    }
  }, [focusMatchId, data.reports, data.sessions]);

  /* Esc 关弹窗 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenSession(null);
      setOpenReport(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runningCount = data.counts.running;
  const reportCount = data.counts.reports;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className="meta" style={{ margin: "0 0 10px" }}>
            知遇 · Agent 匹配
          </p>
          <h1>Agent 匹配</h1>
        </div>
        <div className={styles.headSide}>
          <span className={styles.covChip}>
            <span className={styles.dot} />
            {runningCount > 0 ? `${runningCount} 组正在进行` : "暂无进行中"}
          </span>
        </div>
      </header>

      <div className={styles.seg} role="tablist" aria-label="Agent 匹配内容">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "running"}
          className={tab === "running" ? styles.segActive : ""}
          onClick={() => setTab("running")}
        >
          认识中
          <span className={styles.segCount}>{runningCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reports"}
          className={tab === "reports" ? styles.segActive : ""}
          onClick={() => setTab("reports")}
        >
          匹配报告
          <span className={styles.segCount}>{reportCount}</span>
        </button>
      </div>

      {/* ① 认识中 */}
      {tab === "running" ? (
        <section className="panel">
          <p className="panelEyebrow">认识中 · Agent-to-Agent Session</p>

          {data.sessions.length ? (
            <div className={styles.list}>
              {data.sessions.map((s) => {
                const pct = Math.round((s.currentRound / Math.max(1, s.maxRounds)) * 100);
                return (
                  <article key={s.matchId} className={styles.row} data-match={s.matchId}>
                    <span className={styles.duo} aria-label="你的 Agent 与对方 Agent">
                      <span className={styles.duoAva}>
                        <Avatar avatarUrl={null} seed={s.me.id} width={44} height={44} />
                      </span>
                      <span className={styles.duoAva}>
                        <Avatar avatarUrl={null} seed={s.counterpart.id} width={44} height={44} />
                      </span>
                    </span>

                    <div className={styles.body}>
                      <div className={styles.top}>
                        <span className={styles.pair}>
                          你的 Agent <em>×</em> {s.counterpart.displayName} 的 Agent
                        </span>
                        <span className={`${styles.pill} ${statusClass(s.status)}`}>
                          <span className={styles.pdot} />
                          {STATUS_LABEL[s.status] ?? s.status}
                        </span>
                        <span className={styles.time}>
                          {s.startedAt ? fmtDate(s.startedAt) : "尚未开始"}
                        </span>
                      </div>

                      <p className={styles.preview}>
                        {s.lastQuestion
                          ? `最近一问：${s.lastQuestion}`
                          : "对话尚未产生内容——对方的模型可能还在准备。"}
                      </p>

                      <div className={styles.progressWrap}>
                        <span className="track">
                          <i className="trackFill" style={{ width: `${pct}%` }} />
                        </span>
                        <span className={`num ${styles.roundTxt}`}>
                          第 {s.currentRound} / {s.maxRounds} 轮
                        </span>
                      </div>
                    </div>

                    <div className={styles.actions}>
                      <button
                        type="button"
                        className="btn btnSecondary btnSm"
                        onClick={() => setOpenSession(s)}
                        disabled={s.rounds.length === 0}
                        title={s.rounds.length === 0 ? "还没有可看的对话内容" : undefined}
                      >
                        查看对话
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyBig}>还没有进行中的 Agent 对话。</div>
              <p>
                去「发现」找一位感兴趣的人，点「让 Agent 先聊聊」——
                两个 Agent 会在后台先认识彼此，聊完把报告放到这里。
              </p>
              <Link
                className="btn btnPrimary"
                href={`/find?personaId=${personaId}`}
                style={{ marginTop: 18 }}
              >
                去发现页找人
              </Link>
            </div>
          )}
        </section>
      ) : null}

      {/* ② 匹配报告 */}
      {tab === "reports" ? (
        <section className="panel">
          <p className="panelEyebrow">匹配报告 · Judge Agent 分析</p>

          {data.reports.length ? (
            <div className={styles.list}>
              {data.reports.map((r) => (
                <article key={r.matchId} className={styles.row} data-match={r.matchId}>
                  <span className={styles.duo} aria-label="你的 Agent 与对方 Agent">
                    <span className={styles.duoAva}>
                      <Avatar avatarUrl={null} seed={r.me.id} width={44} height={44} />
                    </span>
                    <span className={styles.duoAva}>
                      <Avatar avatarUrl={null} seed={r.counterpart.id} width={44} height={44} />
                    </span>
                  </span>

                  <div className={styles.body}>
                    <div className={styles.top}>
                      <span className={styles.pair}>
                        你 <em>×</em> {r.counterpart.displayName}
                      </span>
                      <span className={`${styles.pill} ${styles.pillDone}`}>
                        <span className={styles.pdot} />
                        报告已生成
                      </span>
                      {r.demoMode ? (
                        <span className={styles.demoChip} title="由确定性规则产生，非真实 LLM">
                          演示模式
                        </span>
                      ) : null}
                      <span className={styles.time}>{fmtDate(r.createdAt)}</span>
                    </div>

                    <p className={styles.preview}>{r.summary}</p>

                    <div className={styles.scoreRow}>
                      <span className={styles.scoreBig}>
                        {r.overall}
                        <small>%</small>
                      </span>
                      <span className={styles.scoreLbl}>综合匹配度</span>
                      <span className={styles.miniBars}>
                        {r.dimensions.map((d) => (
                          <span key={d.key} className={styles.miniBar} title={`${d.label} ${d.value ?? "—"}%`}>
                            <span
                              className={styles.miniFill}
                              style={{ width: `${d.value ?? 0}%` }}
                            />
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="btn btnPrimary btnSm"
                      onClick={() => setOpenReport(r)}
                    >
                      查看报告
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyBig}>还没有生成任何匹配报告。</div>
              <p>
                报告要等一组 Agent 对话结束后由 Judge 产出。
                去「发现」发起一次，聊完就会有。
              </p>
              <Link
                className="btn btnPrimary"
                href={`/find?personaId=${personaId}`}
                style={{ marginTop: 18 }}
              >
                去发现页找人
              </Link>
            </div>
          )}
        </section>
      ) : null}

      {/* ── 对话弹窗 ── */}
      {openSession ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Agent 对话">
          <div className="modalBackdrop" onClick={() => setOpenSession(null)} />
          <div className={`modalDialog modalDialogWide ${styles.chatDialog}`}>
            <button
              type="button"
              className="modalClose"
              onClick={() => setOpenSession(null)}
              aria-label="关闭"
            >
              ✕
            </button>
            <h3 className={styles.dlgTitle}>
              你的 Agent × {openSession.counterpart.displayName} 的 Agent
            </h3>
            <p className="meta" style={{ marginTop: 6 }}>
              第 {openSession.currentRound} / {openSession.maxRounds} 轮 ·{" "}
              {STATUS_LABEL[openSession.status] ?? openSession.status}
            </p>
            <Rounds
              rounds={openSession.rounds}
              meName="你的 Agent"
              otherName={`${openSession.counterpart.displayName} 的 Agent`}
              meSeed={openSession.me.id}
              otherSeed={openSession.counterpart.id}
            />
          </div>
        </div>
      ) : null}

      {/* ── 报告弹窗 ── */}
      {openReport ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="匹配报告">
          <div className="modalBackdrop" onClick={() => setOpenReport(null)} />
          <div className={`modalDialog modalDialogWide ${styles.chatDialog}`}>
            <button
              type="button"
              className="modalClose"
              onClick={() => setOpenReport(null)}
              aria-label="关闭"
            >
              ✕
            </button>

            <div className={styles.repHead}>
              <div>
                <p className="panelEyebrow">匹配报告 · 综合匹配度</p>
                <h3 className={styles.dlgTitle}>
                  你 × {openReport.counterpart.displayName}
                </h3>
              </div>
              <div className={styles.repScore}>
                <span className={styles.scoreBig}>
                  {openReport.overall}
                  <small>%</small>
                </span>
              </div>
            </div>

            {openReport.demoMode ? (
              <div className={styles.demoNote}>
                本报告由<b>确定性规则</b>产生（演示模式），不是真实 LLM 的判断。
                {openReport.llmError ? `（LLM 调用失败：${openReport.llmError}）` : ""}
              </div>
            ) : null}

            <div className={styles.repGrid}>
              <PersonaRadar
                axes={openReport.dimensions.map((d) => ({
                  label: d.label,
                  value: d.value == null ? null : d.value / 100,
                }))}
                emptyTip="等待 Judge"
              />

              <div className={styles.dimList}>
                {openReport.dimensions.map((d) => (
                  <div key={d.key} className={styles.dimRow}>
                    <span className={styles.dimLabel}>{d.label}</span>
                    <span className="track">
                      <i
                        className="trackFill"
                        style={{ width: `${d.value ?? 0}%` }}
                      />
                    </span>
                    <span className={`num ${styles.dimVal}`}>
                      {d.value == null ? "—" : `${d.value}%`}
                    </span>
                  </div>
                ))}

                {openReport.reasons.length ? (
                  <div className={styles.reasons}>
                    <p className={styles.reasonsHead}>为什么推荐你们认识？</p>
                    <ul>
                      {openReport.reasons.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            {openReport.summary ? (
              <blockquote className={styles.repSummary}>{openReport.summary}</blockquote>
            ) : null}

            <div className={styles.featBlock}>
              <p className={styles.reasonsHead}>Agent 对话摘录</p>
              <Rounds
                rounds={openReport.rounds}
                meName="你的 Agent"
                otherName={`${openReport.counterpart.displayName} 的 Agent`}
                meSeed={openReport.me.id}
                otherSeed={openReport.counterpart.id}
              />
            </div>

            <div className="modalActions">
              <Link className="btn btnSecondary" href={`/persona?id=${openReport.counterpart.id}`}>
                查看 TA 的人格卡
              </Link>
              <button
                type="button"
                className="btn btnPrimary"
                onClick={() => setOpenReport(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
