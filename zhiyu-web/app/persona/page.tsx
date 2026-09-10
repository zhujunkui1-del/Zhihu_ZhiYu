"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "zhiyu_demo";

const SOURCE_META: Record<string, { label: string; hint: string }> = {
  wechat: { label: "微信 · 私域生活", hint: "上传导出的聊天 JSON（开发中）" },
  qq: { label: "QQ · 私域表达", hint: "上传 QCE 导出的 JSON（开发中）" },
  feishu: { label: "飞书 · 职场", hint: "OAuth 授权同步（待接入）" },
  dingtalk: { label: "钉钉 · 职场", hint: "文档 API / 消息上传（开发中）" },
  zhihu: { label: "知乎 · 公共表达", hint: "OAuth 授权同步（待接入）" },
  sbti: { label: "SBTI · 显性自评", hint: "在线完成 30 题测试" },
};

interface PersonaView {
  id: string;
  displayName: string;
  completeness: number;
  stage: string;
  sbti: { codes?: string; type?: string; typeTitle?: string; similarity?: number; fallback?: boolean } | null;
  categories: Record<string, { covered: boolean; label: string; injected: string[] }>;
  sources: Array<{ type: string; status: string }>;
}

interface Question {
  id: string;
  dim: string;
  dimName: string;
  text: string;
  options: Array<{ key: string; text: string }>;
}

export default function PersonaPage() {
  const router = useRouter();
  const [persona, setPersona] = useState<PersonaView | null>(null);
  const [tab, setTab] = useState<"card" | "sources" | "sbti">("card");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ type: string; codes: string; similarity: number } | null>(null);
  const [error, setError] = useState("");

  const personaId = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as { personaId: string }).personaId : null;
    } catch {
      return null;
    }
  }, []);

  const loadPersona = useCallback(async () => {
    if (!personaId) return;
    const resp = await fetch(`/api/persona/${personaId}`).then((r) => r.json());
    if (resp.ok) setPersona(resp.persona);
    else setError(resp.error ?? "加载失败");
  }, [personaId]);

  useEffect(() => {
    if (!personaId) {
      router.replace("/");
      return;
    }
    loadPersona();
  }, [loadPersona, personaId, router]);

  const openSbti = useCallback(async () => {
    setTab("sbti");
    if (questions.length > 0) return;
    const resp = await fetch("/api/sbti/questions").then((r) => r.json());
    if (resp.ok) setQuestions(resp.questions);
    else setError(resp.error ?? "题库加载失败");
  }, [questions.length]);

  const submit = useCallback(
    async (finalAnswers: Record<string, string>) => {
      if (!personaId) return;
      setBusy(true);
      setError("");
      try {
        const resp = await fetch("/api/sbti/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId, answers: finalAnswers }),
        }).then((r) => r.json());
        if (!resp.ok) throw new Error(resp.error ?? "提交失败");
        setResult({ type: resp.type.title, codes: resp.codes, similarity: resp.similarity });
        await loadPersona();
        setTab("card");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadPersona, personaId],
  );

  function choose(questionId: string, key: string) {
    const next = { ...answers, [questionId]: key };
    setAnswers(next);
    if (index < questions.length - 1) {
      setIndex(index + 1);
    } else if (Object.keys(next).length === questions.length) {
      void submit(next);
    }
  }

  const sbtiDone = Boolean(persona?.sbti?.type);
  const gif = busy
    ? "/persona/agent-distill.gif"
    : sbtiDone
      ? "/persona/agent-hello.gif"
      : "/persona/agent-idle.gif";
  const q = questions[index];

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
          </nav>
        </div>
      </header>

      <main className="dash">
        <div className="wrap">
          <p className="eyebrow">我的人格</p>
          <h1 style={{ fontSize: 30, marginTop: 6 }}>
            {persona ? `${persona.displayName} 的人格卡` : "正在加载…"}
          </h1>

          <div className="tabs" role="tablist">
            <button className="tab" aria-selected={tab === "card"} onClick={() => setTab("card")}>
              人格卡
            </button>
            <button className="tab" aria-selected={tab === "sources"} onClick={() => setTab("sources")}>
              注入数据
            </button>
            <button className="tab" aria-selected={tab === "sbti"} onClick={openSbti}>
              SBTI 测试
            </button>
          </div>

          {error ? <p className="empty">出错了：{error}</p> : null}

          {tab === "card" ? (
            <div className="dash-grid">
              <section className="card">
                <p className="eyebrow">综合画像</p>
                <div className="metric">{persona ? `${persona.completeness}%` : "—"}</div>
                <div className="bar">
                  <span style={{ width: `${persona?.completeness ?? 0}%` }} />
                </div>
                <p className="meta">人格完整度（四类来源覆盖）</p>
                {result ? (
                  <p className="meta" style={{ marginTop: 10 }}>
                    刚完成测试：{result.type} · {result.codes} · 匹配度 {Math.round(result.similarity)}%
                  </p>
                ) : null}
                {persona?.sbti?.type ? (
                  <div style={{ marginTop: 14 }}>
                    <h3>{persona.sbti.typeTitle ?? persona.sbti.type}</h3>
                    <p className="meta">
                      SBTI {persona.sbti.type} · {persona.sbti.codes}
                      {persona.sbti.fallback ? "（兜底人格）" : ""}
                    </p>
                    <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={openSbti}>
                      重新测试
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: 14 }}>
                    <p className="meta">还没有 SBTI 数据。30 题、约 3 分钟，完成即可生成显性人格。</p>
                    <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openSbti}>
                      去完成 SBTI
                    </button>
                  </div>
                )}
              </section>

              <section className="card" style={{ textAlign: "center" }}>
                <p className="eyebrow">我的 Agent</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="agent-fig" src={gif} alt="Agent 状态动画" style={{ margin: "10px auto" }} />
                <p className="meta">
                  {busy ? "正在蒸馏你的 Agent…" : sbtiDone ? "Agent 已具备基础人格，可以开始认识别人。" : "Agent 待生成：先注入至少一个数据源。"}
                </p>
              </section>
            </div>
          ) : null}

          {tab === "sources" ? (
            <div className="src-list">
              {Object.entries(SOURCE_META).map(([type, meta]) => {
                const injected = persona?.sources.some((s) => s.type === type && s.status === "injected");
                return (
                  <div className="src" key={type}>
                    <div className="src-head">
                      <span className="src-title">{meta.label}</span>
                      <span className={`badge${injected ? " done" : ""}`}>{injected ? "已注入" : "未注入"}</span>
                    </div>
                    <p className="meta" style={{ marginTop: 8 }}>
                      {meta.hint}
                    </p>
                    {type === "sbti" ? (
                      <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={openSbti}>
                        去完成测试
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {tab === "sbti" ? (
            busy ? (
              <p className="empty">正在计算人格结果…</p>
            ) : q ? (
              <div className="q-card">
                <div className="src-head">
                  <span className="eyebrow">
                    {q.dim} {q.dimName}
                  </span>
                  <span className="meta">
                    {index + 1} / {questions.length}
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${((index + 1) / questions.length) * 100}%` }} />
                </div>
                <p className="q-text">{q.text}</p>
                {q.options.map((o) => (
                  <button
                    key={o.key}
                    className={`opt${answers[q.id] === o.key ? " sel" : ""}`}
                    onClick={() => choose(q.id, o.key)}
                  >
                    <span className="k">{o.key}</span>
                    <span>{o.text}</span>
                  </button>
                ))}
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  <button
                    className="btn btn-secondary"
                    disabled={index === 0}
                    onClick={() => setIndex(Math.max(0, index - 1))}
                  >
                    上一题
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={!answers[q.id] || index === questions.length - 1}
                    onClick={() => setIndex(Math.min(questions.length - 1, index + 1))}
                  >
                    下一题
                  </button>
                </div>
              </div>
            ) : (
              <p className="empty">题库加载中…</p>
            )
          ) : null}
        </div>
      </main>
    </>
  );
}
