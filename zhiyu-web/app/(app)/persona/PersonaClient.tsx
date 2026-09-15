"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/radar/Avatar";
import PersonaRadar from "@/components/PersonaRadar";
import type { PersonaBoard, SourceChip } from "@/lib/persona-view";
import { formatDate } from "@/lib/datetime";
import { reportError } from "@/lib/client/error-bus";
import { toDisplayPercent, toDisplayPercentText } from "@/lib/score";
import SbtiResultModal, { type SbtiResultData } from "@/components/SbtiResultModal";
import SourceFacets from "@/components/SourceFacets";
import ImportDataDialog, {
  type ImportFileResult,
} from "@/components/ImportDataDialog";
import { IMPORT_SOURCE_LABEL, isImportSource, type ImportSource } from "@/lib/import/parse";
import { sbtiGreetingOf, sbtiDescriptionOf } from "@/lib/sbti/personalities";
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
  wechat: "Observed · 聊天文件导入",
  qq: "Observed · 聊天文件导入",
  feishu: "Observed · 消息导出 / distilly",
  dingtalk: "Observed · 文档 + 消息导入",
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
    dim: "私域人格 · 本地文件导入",
    action: "导入聊天文件",
    note: "上传导出的聊天 JSON / TXT / CSV，可一次选多份（会合并）。重新导入会替换这个源上一次的数据，其它源不受影响。",
  },
  qq: {
    title: "QQ 聊天记录",
    dim: "私域人格 · 本地文件导入",
    action: "导入导出文件",
    note: "支持 QCE / TIM 导出的 TXT、JSON、CSV，可一次选多份。只提取你发的内容，群聊私聊都行。",
  },
  feishu: {
    title: "飞书工作数据",
    dim: "职场人格 · 消息导出 / distilly",
    action: "导入飞书数据",
    note: "支持飞书官方消息导出 JSON，以及 distilly 采集脚本产出的 messages.txt / docs.txt。可一次选多份。",
  },
  dingtalk: {
    title: "钉钉工作数据",
    dim: "职场人格 · 文档 + 消息导入",
    action: "导入钉钉数据",
    note: "支持 distilly 钉钉采集脚本产出的 docs.txt / bitables.txt / messages.txt。可一次选多份。",
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
  /** SBTI 完整结果；null = 没测过 */
  const [sbtiResult, setSbtiResult] = useState<SbtiResultData | null>(null);
  /** 弹窗是否展开。与 sbtiResult 分开存，这样关掉后还能再打开，不必重测 */
  const [sbtiResultOpen, setSbtiResultOpen] = useState(false);

  /**
   * 用**已存在库里**的 SBTI 数据打开结果弹窗（页面刷新后也能看）。
   *
   * 说明：`greeting` / `description` 那两段解读只在刚提交时由接口返回，
   * 库里只存了 codes/type/similarity/dimensions。所以这里从 `sbtiBlurb`
   * 的同一份人格库按代码现取 —— 两条路径都能看到完整解读。
   */
  const openStoredSbtiResult = useCallback(() => {
    const s = board.sbti;
    if (!s?.type) return;
    setSbtiResult({
      code: s.type,
      title: s.typeTitle ?? s.type,
      /* 解读从人格库按代码现取 —— 与刚测完那条路径看到的内容一致 */
      greeting: sbtiGreetingOf(s.type),
      description: sbtiDescriptionOf(s.type),
      similarity: Number(s.similarity ?? 0),
      fallback: Boolean(s.fallback),
      codesFormatted: s.codes ?? "",
      dimensions:
        (s.dimensions as unknown as Record<string, { score: number; level: string }>) ?? {},
    });
    setSbtiResultOpen(true);
  }, [board.sbti]);

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
          headers: { "Content-Type": "application/json", "x-silent-error": "1" },
          body: JSON.stringify({ personaId: board.id, answers: final }),
        }).then((r) => r.json());
        if (!resp.ok) throw new Error(resp.error ?? "提交失败");
        /* 注意：`type` 是**对象** `{ name, title }`，不是字符串。
           直接渲染会抛 "Objects are not valid as a React child" —— 实际踩过。 */
        const t = resp.type as string | { name?: string; title?: string };
        const typeLabel = typeof t === "string" ? t : (t?.title ?? t?.name ?? "");
        setJustDone({ type: typeLabel, codes: String(resp.codes ?? "") });
        setQuizOpen(false);
        /* 弹完整结果。
           需求：测完要有「SBTI 测试结果」弹窗（参考 sbti.unun.dev 的结果页），
           而不是只在顶部留一行「刚完成 SBTI：死者」。 */
        setSbtiResult({
          code: typeof t === "string" ? t : (t?.name ?? ""),
          title: typeLabel,
          greeting: (resp.greeting as string | null) ?? null,
          description: (resp.description as string | null) ?? null,
          similarity: Number(resp.similarity ?? 0),
          fallback: Boolean(resp.fallback),
          codesFormatted: String(resp.codes ?? ""),
          dimensions:
            (resp.dimensions as Record<string, { score: number; level: string }>) ?? {},
        });
        setSbtiResultOpen(true);
        /* 重新拉服务端数据，让完整度与五轴一并刷新 */
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
        /* 弹幕同步一份：错误文案在弹窗里，弹窗被关掉/滚动出视野就看不到了 */
        reportError(e, { title: "SBTI 提交失败" });
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

  /* ── 知乎数据同步 ───────────────────────────────────────────────────── */
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncDetail, setSyncDetail] = useState<{
    counts: Record<string, number>;
    addedInterests: string[];
    addedTopics: string[];
    errors: string[];
    samples: { title: string; likes: number; type: string }[];
  } | null>(null);

  const syncZhihu = useCallback(async () => {
    setSyncing(true);
    setSyncMsg("正在读取你的知乎公开数据…");
    setSyncDetail(null);
    try {
      const r = await fetch("/api/zhihu/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-silent-error": "1" },
        body: JSON.stringify({ personaId: board.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error ?? "同步失败");
      setSyncDetail({
        counts: r.counts,
        addedInterests: r.addedInterests ?? [],
        addedTopics: r.addedTopics ?? [],
        errors: r.errors ?? [],
        samples: r.samples ?? [],
      });
      const total = Object.values(r.counts as Record<string, number>).reduce((a, b) => a + b, 0);
      setSyncMsg(
        total > 0
          ? `同步完成：读了 ${total} 条数据。`
          : "同步完成，但这个账号没有公开的创作/关注/收藏。",
      );
      /* 刷新服务端数据，让六源状态与完整度一并更新 */
      router.refresh();
    } catch (e) {
      setSyncMsg(`同步失败：${(e as Error).message}`);
      reportError(e, { title: "知乎数据同步失败" });
    } finally {
      setSyncing(false);
    }
  }, [board.id, router]);

  /* ── 手动导入（微信 / QQ / 飞书 / 钉钉）────────────────────────────────
   * 需求："点击按钮后要能跳出用户的电脑窗口，然后让用户把 json、txt 等
   * 文件格式的、产品支持的、可以用于蒸馏的文件数据导入到网站上。"
   * 所以这里只负责"哪个源、开弹窗、导入完刷新服务端数据"，
   * 解析与落库都在 /api/import（见 lib/import/parse.ts）。
   */
  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  const [importMsg, setImportMsg] = useState("");
  const [importDetail, setImportDetail] = useState<ImportFileResult | null>(null);

  const onImported = useCallback(
    (r: ImportFileResult) => {
      setImportDetail(r);
      setImportMsg(
        `导入完成：${r.counts?.items ?? 0} 条内容已写入「${
          IMPORT_SOURCE_LABEL[r.source as ImportSource] ?? r.source
        }」，分源解析已刷新。`,
      );
      /* 刷新服务端数据：六源状态、完整度、分源解析、综合画像都会跟着更新 */
      router.refresh();
    },
    [router],
  );

  /* ── Agent 蒸馏 ─────────────────────────────────────────────────────────
   * 之前这里只有展示：按钮 disabled + 标着"蒸馏服务尚未接入（演示占位）"。
   * 现在接上了真实后端（POST /api/persona/distill）：把已注入的证据
   * 交给大模型归纳成结构化人格，并返回每一条结论的溯源。
   */
  interface DistillResponse {
    ok: boolean;
    method: "llm" | "rules";
    usedSources: string[];
    evidenceCount: number;
    llmError?: string;
    distilled: {
      bio: string;
      interests: string[];
      topics: string[];
      communicationStyle: string[];
      values: Record<string, number>;
      summary: string;
      groundedIn: { claim: string; from: string[] }[];
    };
  }
  const [distilling, setDistilling] = useState(false);
  const [distillResult, setDistillResult] = useState<DistillResponse | null>(null);
  const [distillReady, setDistillReady] = useState<{
    canUseLlm: boolean;
    platformLlm: boolean;
    byokCount: number;
  } | null>(null);

  /* 查是否具备蒸馏条件，用于给按钮一个诚实的提示文案 */
  const loadDistillReady = useCallback(async () => {
    try {
      const r = await fetch("/api/persona/distill").then((x) => x.json());
      if (r.ok) {
        setDistillReady({
          canUseLlm: r.canUseLlm === true,
          platformLlm: r.platformLlm === true,
          byokCount: r.byokCount ?? 0,
        });
      }
    } catch {
      /* 查不到就不提示，不影响主流程 */
    }
  }, []);

  useEffect(() => {
    if (tab === "distill") void loadDistillReady();
  }, [tab, loadDistillReady]);

  const runDistill = useCallback(async () => {
    setDistilling(true);
    setDistillResult(null);
    try {
      const r = (await fetch("/api/persona/distill", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-silent-error": "1" },
        body: JSON.stringify({ personaId: board.id }),
      }).then((x) => x.json())) as DistillResponse & { error?: string };

      if (!r.ok) throw new Error(r.error ?? "蒸馏失败");
      setDistillResult(r);
      /* 蒸馏会写回 interests/topics/communicationStyle，刷新服务端数据 */
      router.refresh();
    } catch (e) {
      setDistillResult(null);
      /* 弹幕而非 alert：alert 会阻塞页面，移动端体验尤其差 */
      reportError(e, { title: "蒸馏失败", detail: `POST /api/persona/distill` });
    } finally {
      setDistilling(false);
    }
  }, [board.id, router]);

  /* 蒸馏五阶段：有证据就能走到归纳，归纳完成后才算写完索引 */
  const stageState = (i: number): "done" | "doing" | "todo" => {
    if (board.injectedCount === 0) return "todo";
    if (i === 0) return "done";
    if (distilling) return i === 1 || i === 2 ? "doing" : "todo";
    if (distillResult?.ok) return "done";
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
          {/* 结果弹窗关掉后还能再打开，不用重测一遍 */}
          {sbtiResult ? (
            <button
              type="button"
              className="btn btnGhost btnSm"
              style={{ marginLeft: 12 }}
              onClick={() => setSbtiResultOpen(true)}
            >
              查看完整结果
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.seg} role="tablist" aria-label={isSelf ? "我的人格内容" : "人格卡内容"}>
        {(
          [
            ["card", "人格卡"],
            /* 「注入数据」与「Agent 蒸馏」是**本人专属操作**：
               注入要用自己的数据源、蒸馏要处理自己的数据。
               看别人的人格卡时必须隐藏，否则会出现"可以给别人的卡注数据"
               这种既无意义又困惑的入口。 */
            ...(isSelf
              ? ([
                  ["sources", "注入数据"],
                  ["distill", "Agent 蒸馏"],
                ] as [Tab, string][])
              : []),
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
              {/* 这里以前显示的是 SBTI 的等级码 —— 那是**自评结果**，
                  不是综合画像。综合画像应是多源融合的产物，标记改为来源说明。
                  SBTI 现在也参与融合（产品要求），所以还要标明自评占比。 */}
              {board.fused ? (
                <span className="meta" data-fused-sources="1">
                  由{" "}
                  {board.fused.usedSources
                    .map((s) => (board.fused!.selfReportSources.includes(s) ? `${s}（自评）` : s))
                    .join(" + ") || "已有数据"}{" "}
                  融合
                </span>
              ) : null}
            </div>

            <div className={styles.fusionGrid}>
              <PersonaRadar axes={radarAxes} emptyTip="等待蒸馏" />

              <div className={styles.prCol}>
                {/* ① 综合画像判定的**人格倾向**（六型之一）——
                    不是 SBTI 的沙雕人格，两者含义不同。 */}
                {board.fused ? (
                  <>
                    <div className={styles.typeBadge}>
                      <span className={styles.typeName} data-fused-type="1">
                        {board.fused.type}
                      </span>
                      <span className="meta">
                        匹配度 {toDisplayPercentText(board.fused.similarity / 100)}
                      </span>
                    </div>
                    <p className={styles.hint} style={{ marginTop: 8 }}>
                      {board.fused.blurb}
                    </p>
                    {/* 只有自评时，必须说清这份"综合画像"目前等于把自评折算了一遍 */}
                    {board.fused.selfReportOnly ? (
                      <p className={styles.selfOnlyNote} data-fused-self-only="1">
                        目前只有 <b>SBTI 自评</b>这一份人格数据，因此这个倾向是
                        <b>自评折算</b>的结果 —— 还没观察到你公开内容里的行为特征。
                        注入知乎 / 微信等源后会重新融合。
                      </p>
                    ) : board.fused.selfReportSources.length ? (
                      <p className={styles.selfMixNote} data-fused-self-mix="1">
                        这份结论含 <b>SBTI 自评</b>成分，其余来自观察到的数据。
                      </p>
                    ) : null}
                    {board.fused.runnerUp.length ? (
                      <p className="meta" style={{ marginTop: 6 }}>
                        次接近：
                        {board.fused.runnerUp
                          .map((r) => `${r.type} ${toDisplayPercentText(r.similarity / 100)}`)
                          .join("、")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.hint}>
                    还没有综合画像。注入任一数据源（知乎 / 微信 / QQ / 飞书 / 钉钉），
                    或完成一次 SBTI 自评，这里会给出融合判定的人格倾向。
                  </p>
                )}

                {/* ② SBTI 自评单独一行 —— 与上面的综合画像并列，不混为一谈 */}
                {sbti?.type ? (
                  <p className={styles.sbtiLine} data-sbti-self="1">
                    <span className={styles.sbtiTag}>SBTI 自评</span>
                    <b>
                      {sbti.typeTitle ?? sbti.type}
                      {sbti.type ? `（${sbti.type}）` : ""}
                    </b>
                    <span className="meta"> · {sbti.codes}</span>
                    <button
                      type="button"
                      className={styles.sbtiMore}
                      onClick={openStoredSbtiResult}
                    >
                      查看
                    </button>
                  </p>
                ) : null}

                <div className={styles.axisList}>
                  {board.axes.map((a) => (
                    <div key={a.key} className={styles.axisRow}>
                      <span className={styles.axisLabel}>{a.label}</span>
                      <span className="track">
                        <i
                          className="trackFill"
                          style={{ width: `${toDisplayPercent(a.value) ?? 0}%` }}
                        />
                      </span>
                      <span className={`num ${styles.axisVal}`}>
                        {toDisplayPercentText(a.value)}
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

          {/* 分源解析：每个源各自解析出的特征。
              需求：拿到某个源的数据后就该能看出"这个源里的我是什么样的"，
              并在这里分别列出（此前这一块完全缺失）。 */}
          <div className={styles.featBlock} data-facets-block="1">
            <div className={styles.featHead}>
              <h3>分源解析 · 每个数据源各自的结论</h3>
            </div>
            <SourceFacets facets={board.sourceFacets} />
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
                          {formatDate(c.importedAt)}
                        </span>
                      </li>
                    </ul>
                  ) : null}

                  <div className={styles.srcFoot}>
                    {c.type === "zhihu" && isSelf ? (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={() => void syncZhihu()}
                        disabled={syncing}
                      >
                        {syncing ? "同步中…" : c.injected ? "重新同步知乎数据" : "连接知乎并同步"}
                      </button>
                    ) : c.type === "sbti" ? (
                      <button
                        type="button"
                        className="btn btnPrimary"
                        onClick={openQuiz}
                        disabled={!isSelf}
                      >
                        {c.injected ? "重新测试" : "去完成 SBTI"}
                      </button>
                    ) : isImportSource(c.type) ? (
                      /* 微信 / QQ / 飞书 / 钉钉：**手动导入本地文件**。
                         没有其它平台的网页授权可走（原因见 api/import/route.ts），
                         所以这里的按钮必须真的能打开系统文件窗口。 */
                      <button
                        type="button"
                        className="btn btnPrimary"
                        data-open-import={c.type}
                        onClick={() => setImportSource(c.type as ImportSource)}
                        disabled={!isSelf}
                        title={isSelf ? undefined : "只能导入自己的人格数据"}
                      >
                        {c.injected ? `重新${meta.action}` : meta.action}
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

          {/* 手动导入结果（微信 / QQ / 飞书 / 钉钉）。
              导入完必须让用户看见"到底读到了什么"，而不是一句"成功"。 */}
          {importMsg ? (
            <div className={styles.syncBox} data-import-box="1">
              <p className={styles.syncMsg}>{importMsg}</p>

              {importDetail?.counts ? (
                <ul className={styles.syncCounts}>
                  <li>
                    <span>读到的原始内容</span>
                    <b>{importDetail.counts.raw}</b>
                  </li>
                  <li>
                    <span>可用于蒸馏</span>
                    <b>{importDetail.counts.items}</b>
                  </li>
                  <li>
                    <span>写入证据</span>
                    <b>{importDetail.counts.evidence}</b>
                  </li>
                  <li>
                    <span>总字数</span>
                    <b>{importDetail.counts.chars}</b>
                  </li>
                </ul>
              ) : null}

              {importDetail?.addedInterests?.length ? (
                <p className={styles.syncLine}>
                  <span className={styles.syncLbl}>新增兴趣标签</span>
                  <span className={styles.syncTags}>
                    {importDetail.addedInterests.slice(0, 14).map((t) => (
                      <span key={t} className="badge">
                        {t}
                      </span>
                    ))}
                  </span>
                </p>
              ) : null}

              {importDetail?.samples?.length ? (
                <div className={styles.syncSamples}>
                  <p className={styles.syncLbl}>读到的内容</p>
                  <ul>
                    {importDetail.samples.map((s, i) => (
                      <li key={i}>
                        <span className="badge">{s.trait}</span>
                        <span className={styles.sampleTitle}>{s.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importDetail?.warnings?.length ? (
                <ul className={styles.syncWarn} data-import-warnings="1">
                  {importDetail.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}

              <p className={styles.syncLine}>
                <button
                  type="button"
                  className="btn btnSecondary btnSm"
                  onClick={() => {
                    setImportMsg("");
                    setImportDetail(null);
                  }}
                >
                  收起
                </button>
                <span className="meta" style={{ marginLeft: 10 }}>
                  去「Agent 蒸馏」页重新蒸馏，这份数据就会进入综合画像。
                </span>
              </p>
            </div>
          ) : null}

          {/* 知乎同步：进度与结果。数据来自真实开放平台接口，不是占位 */}
          {syncMsg ? (
            <div className={styles.syncBox}>
              <p className={styles.syncMsg}>{syncMsg}</p>

              {syncDetail ? (
                <>
                  <ul className={styles.syncCounts}>
                    <li>
                      <span>我的创作</span>
                      <b>{syncDetail.counts.contents ?? 0}</b>
                    </li>
                    <li>
                      <span>我的关注</span>
                      <b>{syncDetail.counts.followees ?? 0}</b>
                    </li>
                    <li>
                      <span>收藏夹</span>
                      <b>{syncDetail.counts.favlists ?? 0}</b>
                    </li>
                    <li>
                      <span>收藏内容</span>
                      <b>{syncDetail.counts.favlistContents ?? 0}</b>
                    </li>
                  </ul>

                  {syncDetail.addedInterests.length ? (
                    <p className={styles.syncLine}>
                      <span className={styles.syncLbl}>新增兴趣标签</span>
                      <span className={styles.syncTags}>
                        {syncDetail.addedInterests.slice(0, 14).map((t) => (
                          <span key={t} className="badge">
                            {t}
                          </span>
                        ))}
                      </span>
                    </p>
                  ) : null}

                  {syncDetail.addedTopics.length ? (
                    <p className={styles.syncLine}>
                      <span className={styles.syncLbl}>新增话题</span>
                      <span className={styles.syncTags}>
                        {syncDetail.addedTopics.slice(0, 10).map((t) => (
                          <span key={t} className="badge">
                            {t}
                          </span>
                        ))}
                      </span>
                    </p>
                  ) : null}

                  {syncDetail.samples.length ? (
                    <div className={styles.syncSamples}>
                      <p className={styles.syncLbl}>读到的创作</p>
                      <ul>
                        {syncDetail.samples.map((s, i) => (
                          <li key={i}>
                            <span className="badge">{s.type || "内容"}</span>
                            <span className={styles.sampleTitle}>{s.title}</span>
                            <span className="meta">赞 {s.likes}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {syncDetail.errors.length ? (
                    <p className={styles.syncWarn}>
                      部分接口未取到（不影响其它来源）：{syncDetail.errors.join("；")}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
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
                  disabled={board.injectedCount === 0 || distilling}
                  onClick={() => void runDistill()}
                  title={
                    board.injectedCount === 0
                      ? "先注入至少一个数据源"
                      : "让大模型把已注入的证据归纳成结构化人格"
                  }
                >
                  {distilling ? "蒸馏中…（约 5~15 秒）" : "开始蒸馏"}
                </button>
                <span className="meta">
                  {board.injectedCount === 0
                    ? "先注入至少一个数据源"
                    : distilling
                      ? "正在调用大模型归纳证据…"
                      : distillReady?.canUseLlm
                        ? "由大模型归纳；结论都能溯源到具体证据"
                        : "未接入大模型，将退化为规则归并（结果会标注）"}
                </span>
              </div>

              {/* 蒸馏结果：逐项展示，并给出溯源 */}
              {distillResult ? (
                <div className={styles.distillBox} data-distill-result="1">
                  <p className={styles.distillHead}>
                    {distillResult.method === "llm" ? "大模型归纳完成" : "规则归并完成"}
                    <span className="meta">
                      　用了 {distillResult.evidenceCount} 条证据 · 源：
                      {distillResult.usedSources.join("、")}
                    </span>
                  </p>

                  {distillResult.method === "rules" ? (
                    <p className={styles.distillWarn}>
                      本次<b>没有调用大模型</b>
                      {distillResult.llmError ? `（${distillResult.llmError}）` : ""}
                      ，只把已有标签做了归并。结果不代表模型对你的判断。
                    </p>
                  ) : null}

                  <dl className={styles.distillList}>
                    <div>
                      <dt>画像</dt>
                      <dd>{distillResult.distilled.bio || "—"}</dd>
                    </div>
                    <div>
                      <dt>兴趣</dt>
                      <dd>
                        {distillResult.distilled.interests.length
                          ? distillResult.distilled.interests.map((x) => (
                              <span key={x} className="badge">
                                {x}
                              </span>
                            ))
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>话题</dt>
                      <dd>
                        {distillResult.distilled.topics.length
                          ? distillResult.distilled.topics.map((x) => (
                              <span key={x} className="badge">
                                {x}
                              </span>
                            ))
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>表达习惯</dt>
                      <dd>
                        {distillResult.distilled.communicationStyle.length
                          ? distillResult.distilled.communicationStyle.map((x) => (
                              <span key={x} className="badge">
                                {x}
                              </span>
                            ))
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  <p className={styles.distillSummary}>{distillResult.distilled.summary}</p>

                  {distillResult.distilled.groundedIn.length ? (
                    <div className={styles.distillGround}>
                      <p className="meta">结论溯源（凭什么这么判断）</p>
                      <ul>
                        {distillResult.distilled.groundedIn.map((g, i) => (
                          <li key={i}>
                            <b>{g.claim}</b>
                            <span className="meta">← 证据 {g.from.join(", ")}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
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

      {/* SBTI 完整结果弹窗：测完自动弹出，关掉后可用「查看完整结果」再打开 */}
      <SbtiResultModal
        result={sbtiResultOpen ? sbtiResult : null}
        onClose={() => setSbtiResultOpen(false)}
      />

      {/* 手动导入弹窗：打开即弹出系统文件选择窗口（微信 / QQ / 飞书 / 钉钉） */}
      {importSource ? (
        <ImportDataDialog
          source={importSource}
          personaId={board.id}
          onClose={() => setImportSource(null)}
          onImported={onImported}
        />
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
