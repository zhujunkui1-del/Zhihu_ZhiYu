"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/radar/Avatar";
import PersonaRadar from "@/components/PersonaRadar";
import type { PersonaBoard, SourceChip } from "@/lib/persona-view";
import styles from "./persona.module.css";

type Tab = "card" | "sources" | "distill";

/* 六源在卡片上的名称与副标题（与原型一致）。
   必须以 const 定义在组件之前 —— 组件体里会读到它们。 */
const SOURCE_LABEL: Record<string, string> = {
  zhihu: "知乎 · 公共表达",
  wechat: "微信 · 私域生活",
  qq: "QQ · 私域表达",
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
  sbti: "SBTI · 显性自评",
};
const SOURCE_SUB: Record<string, string> = {
  zhihu: "Observed · 公开内容推断",
  wechat: "Observed · 本地聊天分析",
  qq: "Observed · 本地群聊分析",
  feishu: "Observed · 官方 API / 文档",
  dingtalk: "Observed · 文档 API / 消息上传",
  sbti: "Self-reported · 你眼中的自己",
};

interface BankQuestion {
  id: string;
  dim: string;
  dimName: string;
  text: string;
  options: { key: string; text: string }[];
}

/** 六个来源的说明（注入数据页用） */
const SOURCE_META: Record<
  string,
  { title: string; dim: string; action: string; note: string }
> = {
  wechat: {
    title: "微信聊天记录",
    dim: "私域人格 · 本地处理",
    action: "选择聊天文件",
    note: "上传导出的聊天 JSON。数据仅用于生成你的人格，不会离开你的账号。",
  },
  qq: {
    title: "QQ 聊天记录",
    dim: "私域人格 · 本地处理",
    action: "选择导出文件",
    note: "支持 QCE 导出的 JSON。群聊与私聊会分开提取证据。",
  },
  feishu: {
    title: "飞书工作数据",
    dim: "职场人格 · 官方 API",
    action: "连接飞书",
    note: "通过飞书官方 API 授权同步文档与协作记录（待接入）。",
  },
  dingtalk: {
    title: "钉钉工作数据",
    dim: "职场人格 · 文档 API + 消息上传",
    action: "导入钉钉数据",
    note: "支持文档 API 与消息记录上传（开发中）。",
  },
  zhihu: {
    title: "知乎公开数据",
    dim: "公共人格 · OAuth 授权",
    action: "连接知乎",
    note: "读取你的公开回答、想法与关注，用于推断「表达的我」。",
  },
  sbti: {
    title: "SBTI 四维自评",
    dim: "显性人格 · 产品内置",
    action: "去完成 SBTI",
    note: "30 题、约 3 分钟。它记录的是「你眼中的自己」。",
  },
};

/* 蒸馏五阶段（与原型一致） */
const STAGES = [
  "校验已注入的数据源",
  "提取内容证据 · 区分来源",
  "多源融合 · 计算人格特征",
  "蒸馏 · 写入 Persona 索引",
  "Agent 实例就绪",
];

export default function PersonaClient({
  board,
  bank,
  isSelf,
}: {
  board: PersonaBoard;
  bank: BankQuestion[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("card");

  /* SBTI 测试：弹窗内的答题状态 */
  const [quizOpen, setQuizOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justDone, setJustDone] = useState<{ type: string; codes: string } | null>(null);

  const sbti = board.sbti;
  const injectedSet = useMemo(
    () => new Set(board.sourceChips.filter((c) => c.injected).map((c) => c.type)),
    [board.sourceChips],
  );

  /* 五轴：来自 SBTI 的 15 维聚合（见 lib/sbti/axes.ts），是真实数据 */
  const radarAxes = board.axes.map((a) => ({ label: a.label, value: a.value }));
  const radarReady = board.axes.some((a) => a.value != null);

  const openQuiz = useCallback(() => {
    setQuizOpen(true);
    setIndex(0);
    setAnswers({});
    setError("");
  }, []);

  const submit = useCallback(
    async (final: Record<string, string>) => {
      setBusy(true);
      setError("");
      try {
        const resp = await fetch("/api/sbti/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personaId: board.id, answers: final }),
        }).then((r) => r.json());
        if (!resp.ok) throw new Error(resp.error ?? "提交失败");
        /* 注意：`type` 是**对象** `{ name, title }`，不是字符串。
           直接渲染会抛 "Objects are not valid as a React child" —— 实际踩过。 */
        const t = resp.type as string | { name?: string; title?: string };
        const typeLabel = typeof t === "string" ? t : (t?.title ?? t?.name ?? "");
        setJustDone({ type: typeLabel, codes: String(resp.codes ?? "") });
        setQuizOpen(false);
        /* 重新拉服务端数据，让完整度与五轴一并刷新 */
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [board.id, router],
  );

  const choose = useCallback(
    (qid: string, key: string) => {
      const next = { ...answers, [qid]: key };
      setAnswers(next);
      if (index < bank.length - 1) {
        setIndex(index + 1);
      } else if (Object.keys(next).length === bank.length) {
        void submit(next);
      }
    },
    [answers, bank.length, index, submit],
  );

  const q = bank[index];
  const answered = Object.keys(answers).length;

  /* 蒸馏阶段状态：已注入就能走到第 2 步，「开始蒸馏」尚未实现后端 */
  const stageState = (i: number): "done" | "doing" | "todo" => {
    if (board.injectedCount === 0) return "todo";
    if (i === 0) return "done";
    if (i === 1) return "done";
    return "todo";
  };

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className="meta" style={{ margin: "0 0 10px" }}>
            知遇 · 我的人格
          </p>
          <h1>{isSelf ? "我的人格" : `${board.displayName} 的人格卡`}</h1>
        </div>
        {isSelf ? (
          <Link className="btn btnSecondary btnSm" href={`/find?personaId=${board.id}`}>
            去发现页找人
          </Link>
        ) : null}
      </header>

      {justDone ? (
        <div className={styles.doneBar}>
          刚完成 SBTI：<b>{justDone.type}</b> · {justDone.codes}
        </div>
      ) : null}

      <div className={styles.seg} role="tablist" aria-label="我的人格内容">
        {(
          [
            ["card", "人格卡"],
            ["sources", "注入数据"],
            ["distill", "Agent 蒸馏"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles.segActive : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ① 人格卡 */}
      {tab === "card" ? (
        <section className="panel">
          <p className="panelEyebrow">六源注入状态</p>
          <ul className={styles.covList}>
            {board.sourceChips.map((c: SourceChip) => (
              <li key={c.type}>
                <span className={`${styles.covMark} ${c.injected ? styles.covOn : styles.covOff}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={c.injected ? 2.4 : 2} aria-hidden="true">
                    {c.injected ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 5v14M5 12h14" />}
                  </svg>
                </span>
                <span className={styles.covName}>
                  {SOURCE_LABEL[c.type] ?? c.label}
                  <small>{SOURCE_SUB[c.type] ?? ""}</small>
                </span>
                <span className={`${styles.covState} ${c.injected ? styles.covStateOn : ""}`}>
                  {c.injected ? "已注入" : "未注入"}
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.featBlock}>
            <div className={styles.featHead}>
              <h3>综合画像 · 融合特征</h3>
              {sbti?.codes ? <span className="meta">SBTI {sbti.codes}</span> : null}
            </div>

            <div className={styles.fusionGrid}>
              <PersonaRadar axes={radarAxes} emptyTip="等待蒸馏" />

              <div className={styles.prCol}>
                {sbti?.type ? (
                  <>
                    <div className={styles.typeBadge}>
                      <span className={styles.typeName}>{sbti.typeTitle ?? sbti.type}</span>
                      {typeof sbti.similarity === "number" && sbti.similarity > 0 ? (
                        <span className="meta">匹配度 {Math.round(sbti.similarity)}%</span>
                      ) : null}
                    </div>
                    {sbti.fallback ? (
                      <p className="meta" style={{ marginTop: 8 }}>
                        未精确命中类型库，已回退到最接近的一种。
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.hint}>
                    还没有人格数据。做一次 SBTI（30 题，约 3 分钟）就能生成「你眼中的自己」这一面。
                  </p>
                )}

                <div className={styles.axisList}>
                  {board.axes.map((a) => (
                    <div key={a.key} className={styles.axisRow}>
                      <span className={styles.axisLabel}>{a.label}</span>
                      <span className="track">
                        <i
                          className="trackFill"
                          style={{ width: `${Math.round((a.value ?? 0) * 100)}%` }}
                        />
                      </span>
                      <span className={`num ${styles.axisVal}`}>
                        {a.value == null ? "—" : `${Math.round(a.value * 100)}%`}
                      </span>
                    </div>
                  ))}
                </div>

                {isSelf ? (
                  <button
                    type="button"
                    className="btn btnPrimary"
                    style={{ marginTop: 18 }}
                    onClick={openQuiz}
                  >
                    {sbti?.type ? "重新测试 SBTI" : "去完成 SBTI"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* ② 注入数据 */}
      {tab === "sources" ? (
        <section className="panel">
          <p className="panelEyebrow">注入数据 · Multi-source Fusion</p>
          <div className={styles.secIntro}>
            <h2>注入数据</h2>
            <p>
              六种来源任选其一即可开始。数据越丰富，Agent 对你的理解就越完整——
              完整度按「生活私域 / 职场 / 公共 / 显性」四类覆盖计算。
            </p>
          </div>

          <div className={styles.srcGrid}>
            {board.sourceChips.map((c) => {
              const meta = SOURCE_META[c.type];
              if (!meta) return null;
              return (
                <article key={c.type} className={styles.srcCard}>
                  <div className={styles.srcTop}>
                    <span className={styles.srcMark}>
                      <SourceIcon type={c.type} />
                    </span>
                    <div>
                      <div className={styles.srcTitle}>{meta.title}</div>
                      <span className={styles.srcDim}>{meta.dim}</span>
                    </div>
                    <span className={`badge ${c.injected ? "done" : ""}`}>
                      {c.injected ? "已注入" : "未注入"}
                    </span>
                  </div>

                  <p className={styles.srcNote}>{meta.note}</p>

                  {c.injected && c.importedAt ? (
                    <ul className={styles.srcStats}>
                      <li>
                        <span>最近同步</span>
                        <span className="num">
                          {new Date(c.importedAt).toLocaleDateString("zh-CN")}
                        </span>
                      </li>
                    </ul>
                  ) : null}

                  <div className={styles.srcFoot}>
                    {c.type === "sbti" ? (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={openQuiz}
                        disabled={!isSelf}
                      >
                        {c.injected ? "重新测试" : "去完成 SBTI"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btnSecondary"
                        disabled
                        title="该来源尚未接入"
                      >
                        {meta.action}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ③ Agent 蒸馏 */}
      {tab === "distill" ? (
        <section className="panel">
          <p className="panelEyebrow">Agent 蒸馏 · Persona 训练</p>
          <div className={styles.secIntro}>
            <h2>Agent 蒸馏</h2>
          </div>

          <div className={styles.runGrid}>
            <div>
              <div className={styles.runReq}>
                <span className="meta">数据源注入情况</span>
                {board.sourceChips.map((c) => (
                  <span key={c.type} className={`badge ${c.injected ? "done" : ""}`}>
                    {SOURCE_LABEL[c.type] ?? c.label} {c.injected ? "已注入" : "未注入"}
                  </span>
                ))}
              </div>

              <ol className={styles.stageList}>
                {STAGES.map((name, i) => {
                  const st = stageState(i);
                  return (
                    <li key={name} className={styles[`st_${st}`]}>
                      <span className={styles.stageIc}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                          {st === "doing" ? (
                            <circle cx="12" cy="12" r="5" fill="currentColor" />
                          ) : (
                            <path d="M20 6 9 17l-5-5" />
                          )}
                        </svg>
                      </span>
                      <span className={styles.stName}>{name}</span>
                      <span className={`num ${styles.stNote}`}>
                        {st === "done" ? "已完成" : st === "doing" ? "进行中" : "等待"}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className={styles.runReq}>
                <span className="meta">Agent 状态</span>
                <span className={`badge ${sbti?.type ? "done" : ""}`}>
                  {sbti?.type ? "已具备基础人格" : "待生成"}
                </span>
              </div>

              <div className={styles.runActions}>
                <button
                  type="button"
                  className="btn btnPrimary"
                  disabled={board.injectedCount === 0}
                  title={
                    board.injectedCount === 0
                      ? "先注入至少一个数据源"
                      : "蒸馏服务尚未接入，当前为演示占位"
                  }
                >
                  开始蒸馏
                </button>
                <span className="meta">
                  {board.injectedCount === 0
                    ? "先注入至少一个数据源"
                    : "蒸馏服务尚未接入（演示占位）"}
                </span>
              </div>
            </div>

            <figure className={styles.agentFig}>
              <Avatar
                avatarUrl={null}
                seed={board.id}
                width={148}
                height={148}
                alt="刘看山角色，用于表示 Agent 当前状态"
              />
              <figcaption>
                {sbti?.type ? "Agent 已具备基础人格" : "Agent 待生成"}
              </figcaption>
              <p className={styles.agentCap}>
                {sbti?.type
                  ? "可以开始认识别人了。补充更多来源会让它更像你。"
                  : "先注入一个数据源，再回来蒸馏。"}
              </p>
            </figure>
          </div>
        </section>
      ) : null}

      {/* SBTI 测试弹窗 */}
      {quizOpen ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="SBTI 测试">
          <div
            className={`${styles.quizBackdrop} modalBackdrop`}
            onClick={() => (busy ? null : setQuizOpen(false))}
          />
          <div className={`${styles.quizDialog} modalDialog`}>
            <button
              type="button"
              className="modalClose"
              onClick={() => setQuizOpen(false)}
              aria-label="关闭"
              disabled={busy}
            >
              ✕
            </button>

            {busy ? (
              <div className={styles.quizBusy}>
                <p className={styles.quizBusyBig}>正在计算你的人格结果…</p>
                <p className="meta">依据 15 个维度的作答，匹配人格类型库中的 25 种类型。</p>
              </div>
            ) : q ? (
              <>
                <div className={styles.quizHead}>
                  <span className="meta">
                    {q.dim} · {q.dimName}
                  </span>
                  <span className="meta">
                    {index + 1} / {bank.length}
                  </span>
                </div>
                <span className="track" style={{ margin: "10px 0 20px" }}>
                  <i
                    className="trackFill"
                    style={{ width: `${((index + 1) / bank.length) * 100}%` }}
                  />
                </span>

                <p className={styles.quizText}>{q.text}</p>

                <div className={styles.optList}>
                  {q.options.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      className={`${styles.opt} ${answers[q.id] === o.key ? styles.optSel : ""}`}
                      onClick={() => choose(q.id, o.key)}
                    >
                      <span className={styles.optKey}>{o.key}</span>
                      <span>{o.text}</span>
                    </button>
                  ))}
                </div>

                <div className={styles.quizNav}>
                  <button
                    type="button"
                    className="btn btnSecondary btnSm"
                    disabled={index === 0}
                    onClick={() => setIndex(Math.max(0, index - 1))}
                  >
                    上一题
                  </button>
                  <button
                    type="button"
                    className="btn btnSecondary btnSm"
                    disabled={!answers[q.id] || index === bank.length - 1}
                    onClick={() => setIndex(Math.min(bank.length - 1, index + 1))}
                  >
                    下一题
                  </button>
                  <span className={`meta ${styles.quizProgress}`}>已答 {answered} / {bank.length}</span>
                </div>

                {answered === bank.length - 1 && answers[q.id] ? (
                  <button
                    type="button"
                    className="btn btnPrimary"
                    style={{ marginTop: 14, width: "100%" }}
                    onClick={() => void submit(answers)}
                  >
                    提交并生成人格
                  </button>
                ) : null}
              </>
            ) : null}

            {error ? (
              <p className="meta" role="alert" style={{ marginTop: 12, color: "var(--danger)" }}>
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 六源图标 */
function SourceIcon({ type }: { type: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7 } as const;
  switch (type) {
    case "zhihu":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          <path d="M9 8h7M9 12h5" />
        </svg>
      );
    case "wechat":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8.5 9.5h7M8.5 13h4" />
        </svg>
      );
    case "qq":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      );
    case "feishu":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22l-4-9-9-4z" />
        </svg>
      );
    case "dingtalk":
      return (
        <svg {...common} aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true">
          <rect x="5" y="3" width="14" height="18" rx="3" />
          <path d="M9 3.5h6M9.5 12l2 2 3-3.5" />
        </svg>
      );
  }
}
