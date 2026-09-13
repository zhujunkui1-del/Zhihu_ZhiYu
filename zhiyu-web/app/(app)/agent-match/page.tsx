"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "zhiyu_demo";

interface MatchListItem {
  matchId: string;
  mode: string;
  status: string;
  createdAt: string;
  counterpart: { id: string; displayName: string; kind: string };
  report: { overallScore: number; summary: string | null } | null;
}

interface Round {
  round: number;
  question: string;
  aReply: string;
  bReply: string;
}

interface MatchDetail {
  id: string;
  status: string;
  personaA: { id: string; displayName: string };
  personaB: { id: string; displayName: string };
  session: { id: string; status: string; rounds: Round[] } | null;
  report: {
    overallScore: number;
    summary: string | null;
    result: {
      dimensions?: Record<string, number>;
      reasons?: string[];
      demoMode?: boolean;
      llmError?: string | null;
    };
  } | null;
}

const DIM_LABEL: Record<string, string> = {
  interest: "兴趣同频",
  thinking: "思维共振",
  values: "价值观适配",
  communication: "沟通适配",
  complementarity: "互补程度",
};

export default function AgentMatchPage() {
  const [session, setSession] = useState<{ userId: string; personaId: string } | null>(null);
  const [items, setItems] = useState<MatchListItem[]>([]);
  const [tab, setTab] = useState<"running" | "report">("report");
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    const parsed = JSON.parse(raw) as { userId: string; personaId: string };
    setSession(parsed);
    fetch(`/api/matches/list?personaId=${parsed.personaId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setItems(d.items ?? []);
        else setError(d.error ?? "加载失败");
      })
      .catch(() => setError("加载失败"));
  }, []);

  const visible = useMemo(
    () => items.filter((i) => (tab === "report" ? i.status === "report_ready" : i.status !== "report_ready")),
    [items, tab],
  );

  const open = useCallback(async (matchId: string) => {
    const d = await fetch(`/api/matches/${matchId}`).then((r) => r.json());
    if (d.ok) setDetail(d.match);
    else setError(d.error ?? "加载失败");
  }, []);

  const sendReport = useCallback(async () => {
    if (!detail || !session) return;
    setNote("");
    const r = await fetch(`/api/matches/${detail.id}/send-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromPersonaId: session.personaId }),
    }).then((resp) => resp.json());
    if (!r.ok) {
      setError(r.error ?? "发送失败");
      return;
    }
    setNote(r.sent ? "报告已发送到对方通知中心。" : r.reason ?? "报告已生成。");
  }, [detail, session]);

  return (
    <>
      <header className="topnav">
        <div className="wrap topnav-inner">
          <Link href="/home" className="brand">
            <span className="brand-dot">知</span>
            知遇
          </Link>
          <nav className="nav-links">
            <Link href="/home">首页</Link>
            <Link href="/find">发现</Link>
            <Link href="/agent-match">Agent 匹配</Link>
            <Link href="/notify">通知</Link>
          </nav>
        </div>
      </header>

      <main className="dash">
        <div className="wrap">
          <p className="eyebrow">Agent 匹配</p>
          <h1 style={{ fontSize: 30, marginTop: 6 }}>两个 Agent 正在替你们认识彼此</h1>

          <div className="tabs" role="tablist">
            <button className="tab" aria-selected={tab === "running"} onClick={() => setTab("running")}>
              认识中
            </button>
            <button className="tab" aria-selected={tab === "report"} onClick={() => setTab("report")}>
              匹配报告
            </button>
          </div>

          {error ? <p className="empty">出错了：{error}</p> : null}

          <div className="dash-grid">
            <section className="card">
              {visible.length === 0 ? (
                <p className="empty">
                  这里还没有记录。去 <Link href="/find">发现页</Link> 选一个人，让 Agent 先聊聊。
                </p>
              ) : (
                visible.map((i) => (
                  <div className="cand" key={i.matchId}>
                    <div>
                      <strong>{i.counterpart.displayName}</strong>{" "}
                      <span className="meta">
                        {i.counterpart.kind === "synthetic"
                          ? "AI 演示人格"
                          : i.counterpart.kind === "public_creator"
                            ? "公开创作者"
                            : "真人"}
                      </span>
                      <div className="why">
                        {i.report
                          ? `综合匹配度 ${Math.round(i.report.overallScore * 100)}%`
                          : `状态：${i.status}`}
                      </div>
                    </div>
                    <button className="btn btn-secondary" onClick={() => open(i.matchId)}>
                      查看
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="card">
              {detail ? (
                <>
                  <div className="src-head">
                    <div>
                      <strong>
                        {detail.personaA.displayName} × {detail.personaB.displayName}
                      </strong>
                      <div className="meta">状态：{detail.status}</div>
                    </div>
                    {detail.report ? (
                      <div className="score">{Math.round(detail.report.overallScore * 100)}%</div>
                    ) : null}
                  </div>

                  {detail.session?.rounds.map((r) => (
                    <div key={r.round} style={{ marginTop: 12 }}>
                      <div className="msg q">
                        第 {r.round} 轮 · {r.question}
                      </div>
                      <div className="msg a">{detail.personaA.displayName}：{r.aReply}</div>
                      <div className="msg b">{detail.personaB.displayName}：{r.bReply}</div>
                    </div>
                  ))}

                  {detail.report ? (
                    <div style={{ marginTop: 16 }}>
                      <p className="eyebrow">Judge Agent 分析</p>
                      {detail.report.result.dimensions
                        ? Object.entries(detail.report.result.dimensions).map(([k, v]) => (
                            <div key={k} style={{ marginTop: 8 }}>
                              <div className="meta">
                                {DIM_LABEL[k] ?? k}：{Math.round(v * 100)}%
                              </div>
                              <div className="bar" style={{ margin: "4px 0 0" }}>
                                <span style={{ width: `${Math.round(v * 100)}%` }} />
                              </div>
                            </div>
                          ))
                        : null}
                      <p className="meta" style={{ marginTop: 12 }}>
                        {detail.report.summary}
                      </p>
                      {detail.report.result.demoMode ? (
                        <p className="meta">
                          当前为演示模式（未使用真实 LLM）
                          {detail.report.result.llmError ? `：${detail.report.result.llmError}` : ""}
                        </p>
                      ) : null}
                      <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={sendReport}>
                        把报告发给 TA
                      </button>
                      {note ? <p className="meta" style={{ marginTop: 8 }}>{note}</p> : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="empty">从左侧选择一条记录，查看对话过程与匹配报告。</p>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
