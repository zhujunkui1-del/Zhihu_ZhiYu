"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "zhiyu_demo";

const BUCKETS: Record<string, string[]> = {
  深度思考型: ["THIN-K", "MONK", "ZZZZ", "CTRL"],
  好奇探索型: ["GOGO", "SEXY", "LOVE-R", "IMFW"],
  温和共情型: ["MUM", "THAN-K", "OJBK", "Dior-s"],
  理性辩手型: ["BOSS", "OH-NO", "SHIT", "FUCK", "MALO", "DEAD"],
};

const KIND_LABEL: Record<string, string> = {
  human: "真人",
  synthetic: "AI 演示人格",
  public_creator: "公开创作者",
};

interface MatchItem {
  personaId: string;
  displayName: string;
  kind: string;
  overall: number;
  reasons: string[];
  sbtiType: string | null;
  sbtiTitle: string | null;
  dimensions: Record<string, { score: number | null; label: string }>;
}

export default function FindPage() {
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [mode, setMode] = useState<"quick" | "random" | "person">("quick");
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState("全部");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [report, setReport] = useState<{ name: string; score: number; summary: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    const { personaId } = JSON.parse(raw) as { personaId: string };
    fetch(`/api/matches/quick?personaId=${personaId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMatches(d.matches ?? []);
        else setError(d.error ?? "加载失败");
      })
      .catch(() => setError("加载失败"));
  }, []);

  const visible = useMemo(() => {
    let list = [...matches];
    if (mode === "random") {
      list = list.reverse();
    }
    if (mode === "person" && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => m.displayName.toLowerCase().includes(q));
    }
    if (bucket !== "全部") {
      const allowed = BUCKETS[bucket] ?? [];
      list = list.filter((m) => (m.sbtiType ? allowed.includes(m.sbtiType) : false));
    }
    return list;
  }, [bucket, matches, mode, query]);

  async function startAgentMatch(target: MatchItem) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    const { userId, personaId } = JSON.parse(raw) as { userId: string; personaId: string };
    setBusyId(target.personaId);
    setError("");
    try {
      const created = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaAId: personaId, personaBId: target.personaId, mode: "agent" }),
      }).then((r) => r.json());
      if (!created.ok) throw new Error(created.error ?? "创建匹配失败");
      const started = await fetch(`/api/matches/${created.match.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initiatorUserId: userId }),
      }).then((r) => r.json());
      if (!started.ok) throw new Error(started.error ?? "Agent 对话失败");
      setReport({
        name: target.displayName,
        score: Math.round(started.report.overallScore * 100),
        summary: started.report.summary,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

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
            <Link href="/persona">我的人格</Link>
            <Link href="/find">发现</Link>
          </nav>
        </div>
      </header>

      <main className="dash">
        <div className="wrap">
          <p className="eyebrow">发现</p>
          <h1 style={{ fontSize: 30, marginTop: 6 }}>今天，要和谁相遇？</h1>

          <div className="tabs" role="tablist">
            <button className="tab" aria-selected={mode === "person"} onClick={() => setMode("person")}>
              找特定的人
            </button>
            <button className="tab" aria-selected={mode === "random"} onClick={() => setMode("random")}>
              随机推荐
            </button>
            <button className="tab" aria-selected={mode === "quick"} onClick={() => setMode("quick")}>
              快速匹配
            </button>
          </div>

          <div className="filterbar">
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="输入昵称，找到想认识的人"
              disabled={mode !== "person"}
            />
            <select className="input" value={bucket} onChange={(e) => setBucket(e.target.value)}>
              <option value="全部">人格倾向：全部</option>
              {Object.keys(BUCKETS).map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <span className="meta">位置筛选：待真人注册数据接入后开启</span>
          </div>

          {error ? <p className="empty">出错了：{error}</p> : null}

          {report ? (
            <div className="card" style={{ marginTop: 14 }}>
              <p className="eyebrow">Agent 匹配报告</p>
              <h3 style={{ margin: "8px 0" }}>
                你和 {report.name} 的综合匹配度：{report.score}%
              </h3>
              <p className="meta">{report.summary}</p>
              <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => setReport(null)}>
                关闭
              </button>
            </div>
          ) : null}

          <div className="cards" style={{ marginTop: 18 }}>
            {visible.length === 0 ? (
              <p className="empty">没有符合条件的候选人。</p>
            ) : (
              visible.map((m) => (
                <div className="card" key={m.personaId}>
                  <div className="src-head">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="avatar">{m.displayName.slice(0, 1)}</span>
                      <div>
                        <strong>{m.displayName}</strong>
                        <div className="meta">{KIND_LABEL[m.kind] ?? m.kind}</div>
                      </div>
                    </div>
                    <div className="score">{m.overall}</div>
                  </div>
                  <p className="why" style={{ marginTop: 10 }}>
                    {m.reasons.join("；")}
                  </p>
                  {m.sbtiTitle ? (
                    <div className="source-tags">
                      <span className="pill">
                        {m.sbtiTitle}（{m.sbtiType}）
                      </span>
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setExpanded(expanded === m.personaId ? null : m.personaId)}
                    >
                      {expanded === m.personaId ? "收起人格卡" : "查看人格卡"}
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busyId === m.personaId}
                      onClick={() => startAgentMatch(m)}
                    >
                      {busyId === m.personaId ? "对话中…" : "让 Agent 先聊聊"}
                    </button>
                  </div>

                  {expanded === m.personaId ? (
                    <div style={{ marginTop: 14 }}>
                      {Object.entries(m.dimensions).map(([key, d]) => (
                        <div key={key} style={{ marginBottom: 8 }}>
                          <div className="meta">
                            {d.label}：{d.score == null ? "数据不足" : Math.round(d.score)}
                          </div>
                          <div className="bar" style={{ margin: "4px 0 0" }}>
                            <span style={{ width: `${Math.max(0, Math.min(100, d.score ?? 0))}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </>
  );
}
