"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NotifyData, NotifyCategory } from "@/lib/notify";
import { formatListTime } from "@/lib/datetime";
import { reportError, reportSuccess } from "@/lib/client/error-bus";
import MatchReportModal from "@/components/MatchReportModal";
import styles from "./notify.module.css";

type Tab = "all" | NotifyCategory;

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "done", label: "对话完成" },
  { key: "report", label: "发来的报告" },
];

/**
 * 相对时间：今天/昨天/日期。
 *
 * 必须走 lib/datetime —— 它是**时区显式**的。
 * 之前用裸 `toLocaleTimeString("zh-CN")`，服务端在 UTC、浏览器在本地时区，
 * 会渲染出不同文本（实测差 8 小时），触发 React hydration 不一致。
 */
function relTime(d: Date): string {
  return formatListTime(d);
}

export default function NotifyClient({
  data,
  userId,
  personaId,
}: {
  data: NotifyData;
  userId: string;
  personaId: string;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [markedAll, setMarkedAll] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 要就地打开哪一场匹配报告；null = 不显示弹窗 */
  const [reportMatchId, setReportMatchId] = useState<string | null>(null);
  /** 打开的报告是不是**别人送来的**（决定弹窗里显不显示「给TA送去报告」） */
  const [reportReceived, setReportReceived] = useState(false);

  const isRead = (id: string, read: boolean) => read || markedAll || readIds.has(id);

  const list = useMemo(
    () => (tab === "all" ? data.items : data.items.filter((i) => i.category === tab)),
    [data.items, tab],
  );

  const unread = markedAll
    ? 0
    : data.items.filter((i) => !i.read && !readIds.has(i.id)).length;

  /**
   * 点一条通知。
   *
   * ⚠️ **不跳页**（用户强调过）：以前这里 `router.push("/agent-match?matchId=…")`，
   * 点「再看一次」会跳走。现在改为**在当前页面就地弹出该场匹配报告**。
   *
   * 通知里只有 matchId，没有报告内容，所以交给 MatchReportModal 按 id 自己拉
   * （复用与 Agent 匹配页同一份报告装配逻辑，数字与理由不会两处不一致）。
   */
  const open = async (id: string, matchId: string | null, category?: NotifyCategory) => {
    setReadIds((s) => new Set(s).add(id));
    if (!matchId) return;
    /* 「发来的报告」这一类是别人送的 → 弹窗里不显示「给TA送去报告」 */
    setReportReceived(category === "report");
    setReportMatchId(matchId);
  };

  const markAll = async () => {
    if (busy || unread === 0) return;
    setBusy(true);
    try {
      /* 不再传 userId —— 服务端只认 HttpOnly 会话（传了也会被忽略） */
      const r = await fetch("/api/notifications", {
        method: "POST",
        headers: { "x-silent-error": "1" },
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error ?? "操作失败");
      setMarkedAll(true);
      reportSuccess(`已把全部通知标为已读`, `${r.marked ?? 0} 条`);
    } catch (e) {
      reportError(e, { title: "标记已读失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className="meta" style={{ margin: "0 0 10px" }}>
            知遇 · 通知
          </p>
          <h1>通知</h1>
        </div>
        <div className={styles.headActions}>
          <span className={styles.covChip}>
            <span className={styles.dot} />
            {unread > 0 ? `${unread} 条未读` : "暂无未读"}
          </span>
          <button
            type="button"
            className="btn btnSecondary btnSm"
            onClick={markAll}
            disabled={busy || unread === 0}
          >
            {busy ? "处理中…" : "全部标为已读"}
          </button>
        </div>
      </header>

      <div className={styles.seg} role="tablist" aria-label="按消息类型筛选">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? styles.segActive : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className={styles.segCount}>{data.counts[t.key]}</span>
          </button>
        ))}
      </div>

      <section className="panel">
        <div className={styles.secTop}>
          <p className="panelEyebrow">消息流 · 按时间倒序</p>
        </div>

        {list.length ? (
          <div className={styles.list}>
            {list.map((it) => {
              const read = isRead(it.id, it.read);
              return (
                <article
                  key={it.id}
                  className={`${styles.card} ${read ? "" : styles.unread} ${
                    it.category === "report" ? styles.kReport : styles.kDone
                  }`}
                  data-id={it.id}
                  data-kind={it.category}
                >
                  <span className={styles.ico}>
                    <KindIcon category={it.category} />
                  </span>

                  <div className={styles.body}>
                    <div className={styles.top}>
                      <span className={styles.kind}>
                        <span className={styles.kdot} />
                        {it.kindLabel}
                      </span>
                      <span className={styles.time}>{relTime(it.createdAt)}</span>
                      {!read ? <span className={styles.unreadDot} aria-hidden="true" /> : null}
                    </div>

                    <h3 className={styles.title}>{it.title}</h3>
                    <p className={styles.desc}>{it.desc}</p>

                    <div className={styles.foot}>
                      {it.overall != null ? (
                        <span className={styles.dchip}>
                          综合 <b>{it.overall}%</b>
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={`btn btnGhost ${styles.open}`}
                        onClick={() => void open(it.id, it.matchId, it.category)}
                        disabled={!it.matchId}
                        title={it.matchId ? undefined : "这条通知没有可打开的匹配"}
                      >
                        {read ? "再看一次" : "查看"}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </button>

                      {it.category === "report" ? (
                        <span className={styles.sentNote}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          对方主动发来
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyBig}>这个分组下暂时没有消息。</div>
            <p>
              有新进展时这里会出现提醒——比如某组 Agent 对话聊完了，
              或者有人把匹配报告发给了你。
            </p>
            {tab !== "all" ? (
              <button
                type="button"
                className="btn btnSecondary"
                style={{ marginTop: 18 }}
                onClick={() => setTab("all")}
              >
                返回「全部」
              </button>
            ) : (
              <Link className="btn btnSecondary" href={`/find?personaId=${personaId}`} style={{ marginTop: 18 }}>
                去发现页找人
              </Link>
            )}
          </div>
        )}

        <div className={styles.notice}>
          <b>为什么会有这些通知？</b>知遇不会推送营销内容。
          这里只出现两类：你发起的 Agent 对话完成，以及别人（在你允许的前提下）发来的匹配报告。
        </div>
      </section>

      {/* 就地打开匹配报告（不跳「Agent 匹配」页）。
          点「再看一次」时用 matchId 拉取，复用与那页同一份装配逻辑。
          `received`：从「发来的报告」点进来的，是**别人送给我的** ——
          这种报告不再显示「给TA送去报告」按钮（服务端也会回报 sentToMe 兜底）。 */}
      <MatchReportModal
        matchId={reportMatchId}
        received={reportReceived}
        onClose={() => {
          setReportMatchId(null);
          setReportReceived(false);
        }}
      />
    </>
  );
}

function KindIcon({ category }: { category: NotifyCategory }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    "aria-hidden": true,
  } as const;
  if (category === "report") {
    return (
      <svg {...common}>
        <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
        <path d="M14 2v5h5M12 10v7M8.6 13.5h6.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="m8.5 10.6 2.5 2.5 4.5-4.7" />
    </svg>
  );
}
