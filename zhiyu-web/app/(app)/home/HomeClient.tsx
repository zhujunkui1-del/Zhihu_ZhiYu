"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/radar/Avatar";
import BoardRadar from "@/components/BoardRadar";
import { locText } from "@/lib/regions";
import type { HomeData } from "@/lib/home";
import type { DiscoverCandidate } from "@/lib/discover";
import styles from "./home.module.css";

const KIND_LABEL: Record<string, string> = {
  human: "真人",
  synthetic: "AI 演示人格",
  public_creator: "公开创作者",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  running: "对话中",
  analyzing: "分析中",
  completed: "已完成",
  failed: "已中断",
};

/** Fisher–Yates 取 3 个（避免 sort(random) 的分布偏差） */
function pick3(list: DiscoverCandidate[]): DiscoverCandidate[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, 3);
}

/**
 * 首页。
 *
 * 五维示意的取值说明：目前用「四个来源类别的覆盖度」近似（0.82 / 0.16），
 * 因为真正的「人格五维」要等蒸馏产出，而蒸馏尚未接入。
 * 接入后把 axes 换成真实五维分数即可，BoardRadar 的接口不变。
 */
export default function HomeClient({
  data,
  personaId,
}: {
  data: HomeData;
  personaId: string;
  userId: string;
}) {
  const router = useRouter();
  const { board } = data;
  const [preview, setPreview] = useState<DiscoverCandidate[]>(data.preview);

  const sbti = board.sbti;
  const hasData = board.injectedCount > 0;

  const personaTitle = sbti?.type
    ? `你的人格倾向是「${sbti.typeTitle ?? sbti.type}」。`
    : hasData
      ? "数据已就位，等待一次蒸馏。"
      : "还没有人格数据，先接入一个来源。";

  const axes = [
    ["life", "生活私域"],
    ["work", "职场"],
    ["public", "公共"],
    ["explicit", "显性"],
    ["identity", "身份"],
  ].map(([key, label]) => ({
    label,
    value: board.categories[key]?.covered ? 0.82 : 0.16,
  }));

  return (
    <>
      {/* ① 人格总览 + Agent 匹配进行中 */}
      <section className={styles.homeTop}>
        <article className="panel">
          <div className={styles.panelHead}>
            <div>
              <p className="panelEyebrow">我的人格</p>
              <h2>{personaTitle}</h2>
            </div>
            <Link className="btn btnSecondary btnSm" href={`/persona?personaId=${personaId}`}>
              查看完整人格卡
            </Link>
          </div>

          <div className={styles.poBody}>
            <div className={styles.poVisual}>
              <BoardRadar axes={axes} ready={hasData} emptyTip="等待蒸馏" />
            </div>

            <div className={styles.poRight}>
              <ul className={styles.metricList}>
                <li>
                  <span className={styles.metricLabel}>人格完整度</span>
                  <span className={styles.metricValue}>{board.completeness}%</span>
                </li>
                <li>
                  <span className={styles.metricLabel}>已覆盖来源类别</span>
                  <span className={styles.metricValue}>{board.coveredCategories} / 4</span>
                </li>
                <li>
                  <span className={styles.metricLabel}>已注入数据源</span>
                  <span className={styles.metricValue}>{board.injectedCount} / 6</span>
                </li>
              </ul>

              <div className={styles.progress}>
                <span className="track">
                  <i className="trackFill" style={{ width: `${board.completeness}%` }} />
                </span>
                <p className="meta" style={{ marginTop: 8 }}>
                  完整度按「生活私域 / 职场 / 公共 / 显性」四类来源覆盖计算，不是按来源数量简单相加。
                </p>
              </div>

              {sbti?.type ? (
                <p className="meta" style={{ marginTop: 14 }}>
                  SBTI：{sbti.typeTitle ?? sbti.type}
                  {sbti.codes ? `（${sbti.codes}）` : ""}
                </p>
              ) : (
                <p className="meta" style={{ marginTop: 14 }}>
                  还没有 SBTI 数据，去「我的人格」完成测试。
                </p>
              )}
            </div>
          </div>

          <div className={styles.poSrc}>
            <div className={styles.srcLine}>
              <span className={styles.srcT}>人格数据源</span>
              <ul className={styles.srcChips}>
                {board.sourceChips.map((c) => (
                  <li
                    key={c.type}
                    className={`${styles.chip} ${c.injected ? styles.chipOk : ""}`}
                  >
                    <span className={styles.dot} />
                    <b>{c.label}</b>
                    <small>{c.injected ? "已注入" : "未注入"}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </article>

        <article className={`panel ${styles.agentPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className="panelEyebrow">Agent 匹配 · 认识中</p>
              <h3>现在正在进行的对话</h3>
            </div>
          </div>

          {data.running.length ? (
            <div className={styles.amList}>
              {data.running.map((s) => (
                <div key={s.matchId} className={styles.amItem}>
                  <span className={styles.amAva}>
                    <Avatar avatarUrl={null} seed={s.counterpartId} width={36} height={36} />
                  </span>
                  <div className={styles.amBody}>
                    <div className={styles.amName}>与 {s.counterpartName}</div>
                    <div className={styles.amMeta}>
                      第 {Math.max(1, s.currentRound)} / {s.maxRounds} 轮 ·{" "}
                      {STATUS_LABEL[s.status] ?? s.status}
                    </div>
                  </div>
                  <span
                    className={`${styles.amPill} ${s.status === "running" ? styles.amPillRun : ""}`}
                  >
                    <span className={styles.dot} />
                    {s.status === "running" ? "进行中" : "已结束"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.amEmpty}>
              还没有进行中的 Agent 对话。去「发现」找一位感兴趣的人，让 Agent 先聊聊。
            </p>
          )}

          <Link className={styles.panelLink} href={`/agent-match?personaId=${personaId}`}>
            去 Agent 匹配页
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </article>
      </section>

      {/* ② 发现预览 + 通知中心 */}
      <section className={styles.workGrid}>
        <article className="panel">
          <div className={styles.panelHead}>
            <div>
              <p className="panelEyebrow">发现 · 快速匹配预览</p>
              <h2>今日高匹配的 TA</h2>
            </div>
            <button
              type="button"
              className={styles.dcRoll}
              onClick={() => setPreview(pick3(data.previewPool))}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              换一批
            </button>
          </div>

          <div className={styles.dcGrid}>
            {preview.map((p) => (
              <Link key={p.id} className={styles.dcCard} href={`/persona?id=${p.id}`}>
                <span className={styles.dcHead}>
                  <span className={styles.dcAva}>
                    <Avatar avatarUrl={null} seed={p.id} width={42} height={42} />
                  </span>
                  <span className={styles.dcId}>
                    <span className={styles.dcTitle}>{p.displayName}</span>
                    <span className={styles.dcPill}>{KIND_LABEL[p.kind] ?? p.kind}</span>
                  </span>
                </span>

                <span className={styles.dcMeta}>
                  {locText(p.province, p.city)} · {p.type ?? "—"}
                </span>

                <span className={styles.dcTags}>
                  {p.tags.slice(0, 2).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </span>

                <span className={styles.dcSim}>
                  <span className="track">
                    <i className="trackFill" style={{ width: `${p.sim}%` }} />
                  </span>
                </span>

                <span className={styles.dcFoot}>
                  <span className={styles.simLbl}>
                    与你的相似度 <b>{p.sim}%</b>
                  </span>
                  <span className={styles.dcGo}>
                    去认识 TA
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </article>

        <article className={`panel ${styles.notifyPanel}`}>
          <div className={styles.panelHead}>
            <div>
              <p className="panelEyebrow">通知中心</p>
              <h3>最新通知</h3>
            </div>
            <span className={`badge ${data.unread ? "done" : ""}`}>
              {data.unread ? `${data.unread} 条未读` : "暂无未读"}
            </span>
          </div>

          {data.notify.length ? (
            <div className={styles.ntList}>
              {data.notify.map((n) => (
                <div key={n.id} className={`${styles.ntItem} ${n.read ? "" : styles.ntUnread}`}>
                  <span className={styles.ntTitle}>{n.title}</span>
                  <span className="meta">
                    {new Date(n.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.ntEmpty}>暂无新通知。</p>
          )}

          <Link className={styles.panelLink} href={`/notify?userId=${data.board.id}`}>
            查看全部通知
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        </article>
      </section>

      <footer className={styles.footNote}>
        <span>© 2026 知遇 · 知乎黑客松「灵魂匹配局」赛道作品</span>
        <button type="button" className="btn btnGhost btnSm" onClick={() => router.push("/")}>
          退出登录
        </button>
      </footer>
    </>
  );
}
