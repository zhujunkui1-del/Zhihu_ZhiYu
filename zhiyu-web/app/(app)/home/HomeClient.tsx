"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/radar/Avatar";
import BoardRadar from "@/components/BoardRadar";
import PersonaCardModal from "@/components/PersonaCardModal";
import { locText } from "@/lib/regions";
import { formatDate } from "@/lib/datetime";
import { toDisplayPercent, toDisplayPercentText } from "@/lib/score";
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

/** Fisher–Yates 取 n 个（避免 sort(random) 的分布偏差） */
function pickN<T>(list: T[], n: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/** 内置演示人格的名字形如「演示人格 01」 */
const isBuiltinPersona = (p: DiscoverCandidate) => /^演示人格\s*\d+$/.test(p.displayName);

/**
 * 首页「今日高匹配的 TA」取样。
 *
 * ⚠️ 不能从整个候选池里纯随机抽 3 个。
 * 候选池是按相似度排序的，而**内置演示人格**（16 个）对演示用户算出来的
 * 相似度天然偏高，长期霸占前 16 名；真实知乎用户（27 个）最高才第 17 名。
 * 实测：纯随机抽 3 个几乎总是抽到演示人格，真实用户基本不出现
 * —— 首页因此看不到"真人"的人格卡，而真人恰恰是这个产品最该展示的东西。
 *
 * 所以按**类别**取样：优先保证真人占多数，再用演示人格补位。
 */
function pickPreview(pool: DiscoverCandidate[]): DiscoverCandidate[] {
  const real = pool.filter((p) => !isBuiltinPersona(p));
  const builtin = pool.filter(isBuiltinPersona);

  const chosen = [...pickN(real, 2), ...pickN(builtin, 1)];
  /* 某一类不够时用另一类补满 3 个，保证卡片数量稳定 */
  if (chosen.length < 3) {
    const rest = pool.filter((p) => !chosen.some((c) => c.id === p.id));
    chosen.push(...pickN(rest, 3 - chosen.length));
  }
  return chosen.slice(0, 3);
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
  /* 弹窗人格卡：存"要看谁"，而不是复制一份数据 —— 内容由弹窗自己按 id 拉，
     保证与人格页同源（否则两处会显示不一致）。 */
  const [viewPersona, setViewPersona] = useState<string | null>(null);

  const sbti = board.sbti;
  const hasData = board.injectedCount > 0;

  /**
   * 首页标题用**综合画像**（多源融合判定的六型倾向），与「我的人格」页一致。
   *
   * ⚠️ 这里曾经直接显示 `sbti.typeTitle` —— 那是 SBTI **自评**的结果，
   * 不是综合画像。首页与人格页因此显示两套不同的"人格倾向"（实测被投诉）。
   * 综合画像不可用时才退回"数据已就位/先接来源"的引导语。
   */
  const personaTitle = board.fused
    ? `你的人格倾向是「${board.fused.type}」。`
    : hasData
      ? "数据已就位，等待一次蒸馏。"
      : "还没有人格数据，先接入一个来源。";

  /* 五轴与人格页同源：都取「多源融合」的那一组（axesSource 会标明来源）。
     未做 SBTI 且没有观察数据时全为 null，BoardRadar 显示"等待蒸馏"，
     不编造分数。 */
  const axes = board.axes.map((a) => ({ label: a.label, value: a.value ?? 0 }));
  const axesReady = board.axes.some((a) => a.value != null);

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
              <BoardRadar axes={axes} ready={axesReady} emptyTip="等待蒸馏" />
            </div>

            <div className={styles.poRight}>
              <ul className={styles.metricList}>
                <li>
                  <span className={styles.metricLabel}>人格完整度</span>
                  {/* 完整度是覆盖率推断（四类来源加权），不宣称 0% / 100%：
                      具体到了哪一档旁边的 "x/4"、"x/6" 已经说清楚了 */}
                  <span className={styles.metricValue} data-home-completeness="1">
                    {toDisplayPercentText(board.completeness / 100)}
                  </span>
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
                  <i
                    className="trackFill"
                    style={{ width: `${toDisplayPercent(board.completeness / 100) ?? 0}%` }}
                  />
                </span>
                <p className="meta" style={{ marginTop: 8 }}>
                  完整度按「生活私域 / 职场 / 公共 / 显性」四类来源覆盖计算，不是按来源数量简单相加。
                </p>
              </div>

              {/* 综合画像：与人格页同一套判定（六型倾向 + 匹配度） */}
              {board.fused ? (
                <p className="meta" style={{ marginTop: 14 }} data-home-fused="1">
                  综合画像：<b>{board.fused.type}</b>（匹配度{" "}
                  {toDisplayPercentText(board.fused.similarity / 100)}）
                  <br />
                  {board.fused.blurb}
                  {/* 只有自评时要说清楚 —— 否则等于把 SBTI 当成观察结论（曾经就是这么错的） */}
                  {board.fused.selfReportOnly ? (
                    <span data-home-fused-self-only="1">
                      <br />
                      目前只有 SBTI 自评这一份人格数据，这个倾向是自评折算的结果；
                      注入知乎 / 微信等源后会重新融合。
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="meta" style={{ marginTop: 14 }}>
                  还没有综合画像。注入任一数据源（知乎 / 微信 / QQ / 飞书 / 钉钉），
                  或完成一次 SBTI 自评，这里会给出融合判定的人格倾向。
                </p>
              )}

              {/* SBTI 是**自评**那一面，与综合画像并列但不混为一谈 */}
              {sbti?.type ? (
                <p className="meta" style={{ marginTop: 8 }} data-home-sbti="1">
                  SBTI 自评：{sbti.typeTitle ?? sbti.type}
                  {sbti.codes ? `（${sbti.codes}）` : ""}
                </p>
              ) : (
                <p className="meta" style={{ marginTop: 8 }}>
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
              onClick={() => setPreview(pickPreview(data.previewPool))}
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
              /* 整卡改成按钮：点「去认识 TA」/「查看人格卡」时
                 **就地弹窗打开对方的人格卡**，绝不跳转 /persona
                 （产品要求，用户多次强调）。 */
              <button
                key={p.id}
                type="button"
                className={styles.dcCard}
                onClick={() => setViewPersona(p.id)}
                aria-label={`查看 ${p.displayName} 的人格卡`}
                data-open-persona={p.id}
              >
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

                {/* 相似度：我这边画像没就绪时 `sim` 是 0（哨兵值，代表"没算过"），
                    此时整块不显示 —— 既不能写成 0%（绝对结论），
                    也不该硬凑成 1%（产品要求区间是 1~99，但没数据就是没数据）。 */}
                {data.meReady ? (
                  <>
                    <span className={styles.dcSim}>
                      <span className="track">
                        <i
                          className="trackFill"
                          style={{ width: `${toDisplayPercent(p.sim / 100) ?? 0}%` }}
                        />
                      </span>
                    </span>

                    <span className={styles.dcFoot}>
                      <span className={styles.simLbl}>
                        与你的相似度 <b>{toDisplayPercentText(p.sim / 100)}</b>
                      </span>
                      <span className={styles.dcGo}>
                        查看人格卡
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M5 12h14M13 6l6 6-6 6" />
                        </svg>
                      </span>
                    </span>
                  </>
                ) : (
                  <span className={styles.dcFoot}>
                    <span className={styles.simLbl}>完善我的人格后可比相似度</span>
                    <span className={styles.dcGo}>
                      查看人格卡
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </span>
                  </span>
                )}
              </button>
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
                    {formatDate(n.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.ntEmpty}>暂无新通知。</p>
          )}

          <Link className={styles.panelLink} href="/notify">
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

      {/* 就地弹窗打开对方人格卡：**不跳页、不换路由** */}
      <PersonaCardModal
        personaId={viewPersona}
        ownPersonaId={personaId}
        onClose={() => setViewPersona(null)}
      />
    </>
  );
}
