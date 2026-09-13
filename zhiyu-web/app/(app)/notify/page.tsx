"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "zhiyu_demo";

interface NotificationItem {
  id: string;
  type: string;
  payload: { counterpart?: string; overallScore?: number; matchId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

export default function NotifyPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [tab, setTab] = useState<"all" | "agent_completed" | "report_received">("all");
  const [error, setError] = useState("");

  const load = useCallback(async (uid: string) => {
    const d = await fetch(`/api/notifications?userId=${uid}`).then((r) => r.json());
    if (d.ok) setItems(d.items ?? []);
    else setError(d.error ?? "加载失败");
  }, []);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!raw) return;
    const { userId: uid } = JSON.parse(raw) as { userId: string };
    setUserId(uid);
    load(uid);
  }, [load]);

  const visible = useMemo(
    () => (tab === "all" ? items : items.filter((i) => i.type === tab)),
    [items, tab],
  );

  async function markAllRead() {
    if (!userId) return;
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    load(userId);
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
            <Link href="/agent-match">Agent 匹配</Link>
            <Link href="/notify">通知</Link>
          </nav>
          <button className="btn btn-secondary" onClick={markAllRead}>
            全部标为已读
          </button>
        </div>
      </header>

      <main className="dash">
        <div className="wrap">
          <p className="eyebrow">通知</p>
          <h1 style={{ fontSize: 30, marginTop: 6 }}>消息流 · 按时间倒序</h1>

          <div className="tabs" role="tablist">
            <button className="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
              全部
            </button>
            <button
              className="tab"
              aria-selected={tab === "agent_completed"}
              onClick={() => setTab("agent_completed")}
            >
              对话完成
            </button>
            <button
              className="tab"
              aria-selected={tab === "report_received"}
              onClick={() => setTab("report_received")}
            >
              发来的报告
            </button>
          </div>

          {error ? <p className="empty">出错了：{error}</p> : null}

          <section className="card">
            {visible.length === 0 ? (
              <p className="empty">这个分组下暂时没有消息。</p>
            ) : (
              visible.map((n) => (
                <div className="cand" key={n.id}>
                  <div>
                    <strong>
                      {n.type === "report_received" ? "收到一份匹配报告" : "Agent 对话完成"}
                    </strong>
                    <div className="why">
                      {n.payload?.counterpart ? `对方：${n.payload.counterpart}` : ""}
                      {typeof n.payload?.overallScore === "number"
                        ? ` · 综合匹配度 ${Math.round(n.payload.overallScore * 100)}%`
                        : ""}
                    </div>
                    <div className="meta">{new Date(n.createdAt).toLocaleString("zh-CN")}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className={`badge${n.readAt ? "" : " done"}`}>
                      {n.readAt ? "已读" : "未读"}
                    </span>
                    {n.payload?.matchId ? (
                      <div style={{ marginTop: 8 }}>
                        <Link className="btn btn-secondary" href="/agent-match">
                          查看报告
                        </Link>
                      </div>
                    ) : null}
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
