"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface PersonaView {
  id: string;
  displayName: string;
  kind: string;
  completeness: number;
  stage: string;
  sbti: { codes?: string; type?: string; typeTitle?: string; similarity?: number } | null;
  categories: Record<string, { covered: boolean; label: string; injected: string[] }>;
}

interface MatchView {
  personaId: string;
  displayName: string;
  kind: string;
  overall: number;
  reasons: string[];
}

interface ReportView {
  overallScore: number;
  summary: string;
}

const STORAGE_KEY = "zhiyu_demo";

export default function HomePage() {
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaView | null>(null);
  const [matches, setMatches] = useState<MatchView[]>([]);
  const [report, setReport] = useState<ReportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) {
      router.replace("/");
      return;
    }
    const { personaId } = JSON.parse(raw) as { personaId: string };
    Promise.all([
      fetch(`/api/persona/${personaId}`).then((r) => r.json()),
      fetch(`/api/matches/quick?personaId=${personaId}`).then((r) => r.json()),
    ])
      .then(([p, m]) => {
        if (p.ok) setPersona(p.persona);
        else setError(p.error ?? "加载人格失败");
        if (m.ok) setMatches(m.matches ?? []);
      })
      .catch(() => setError("加载失败"));
  }, [router]);

  const startAgentMatch = useCallback(
    async (target: MatchView) => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { userId, personaId } = JSON.parse(raw) as {
        userId: string;
        personaId: string;
      };
      setBusy(true);
      setError("");
      try {
        const created = await fetch("/api/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            personaAId: personaId,
            personaBId: target.personaId,
            mode: "agent",
          }),
        }).then((r) => r.json());
        if (!created.ok) throw new Error(created.error ?? "创建匹配失败");
        const started = await fetch(`/api/matches/${created.match.id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initiatorUserId: userId }),
        }).then((r) => r.json());
        if (!started.ok) throw new Error(started.error ?? "Agent 对话失败");
        setReport(started.report);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function logout() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    router.push("/");
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
            <a href="#matches">快速匹配</a>
            <a href="#agent">Agent 匹配</a>
          </nav>
          <button className="btn btn-secondary" onClick={logout}>
            退出
          </button>
        </div>
      </header>

      <main className="dash">
        <div className="wrap">
          <div className="dash-head">
            <div>
              <p className="eyebrow">欢迎回到知遇</p>
              <h1 style={{ fontSize: 30 }}>
                {persona ? `${persona.displayName}，今天想认识谁？` : "正在加载你的人格…"}
              </h1>
            </div>
            <Link className="btn btn-secondary" href="/">
              回到首页
            </Link>
          </div>

          {error ? <p className="empty">出错了：{error}</p> : null}

          <div className="dash-grid">
            <section className="card">
              <p className="eyebrow">我的人格</p>
              <div className="metric">{persona ? `${persona.completeness}%` : "—"}</div>
              <div className="bar">
                <span style={{ width: `${persona?.completeness ?? 0}%` }} />
              </div>
              <p className="meta">人格完整度（按四类来源覆盖计算）</p>
              <div className="source-tags">
                {persona
                  ? Object.entries(persona.categories).map(([key, c]) => (
                      <span className="pill" key={key}>
                        {c.covered ? "✓ " : "○ "}
                        {c.label}
                      </span>
                    ))
                  : null}
              </div>
              {persona?.sbti?.type ? (
                <p className="meta" style={{ marginTop: 12 }}>
                  SBTI：{persona.sbti.typeTitle ?? persona.sbti.type}（{persona.sbti.codes}）
                  {typeof persona.sbti.similarity === "number" && persona.sbti.similarity > 0
                    ? ` · 匹配度 ${Math.round(persona.sbti.similarity)}%`
                    : ""}
                </p>
              ) : (
                <p className="meta" style={{ marginTop: 12 }}>
                  还没有 SBTI 数据，去“我的人格”完成测试。
                </p>
              )}
            </section>

            <section className="card" id="agent">
              <p className="eyebrow">我的 Agent</p>
              <h3 style={{ margin: "8px 0 6px" }}>
                {persona?.stage === "ready_for_distill" ? "可以开始蒸馏与匹配" : "先补全人格数据"}
              </h3>
              <p className="meta">
                演示说明：从下方“今日高匹配的 TA”里选一位，让两个 Agent 先聊 5 轮，随后生成匹配报告。
              </p>
              {report ? (
                <div style={{ marginTop: 14 }}>
                  <div className="metric" style={{ fontSize: 26 }}>
                    {Math.round(report.overallScore * 100)}%
                  </div>
                  <p className="meta">{report.summary}</p>
                </div>
              ) : (
                <p className="empty">还没有进行中的 Agent 对话。</p>
              )}
            </section>
          </div>

          <section className="card" id="matches" style={{ marginTop: 18 }}>
            <p className="eyebrow">快速匹配预览</p>
            <h3 style={{ margin: "8px 0 10px" }}>今日高匹配的 TA</h3>
            {matches.length === 0 ? (
              <p className="empty">还没有候选，先运行 seed 或等待其他用户加入。</p>
            ) : (
              matches.slice(0, 5).map((m) => (
                <div className="cand" key={m.personaId}>
                  <div>
                    <strong>{m.displayName}</strong>{" "}
                    <span className="meta">
                      {m.kind === "synthetic" ? "AI 演示人格" : m.kind === "public_creator" ? "公开创作者" : "真人"}
                    </span>
                    <div className="why">{m.reasons.join("；")}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="score">{m.overall}</div>
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => startAgentMatch(m)}
                      style={{ marginTop: 8 }}
                    >
                      {busy ? "对话中…" : "让 Agent 先聊聊"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </main>
    </>
  );
}
