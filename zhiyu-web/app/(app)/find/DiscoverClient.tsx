"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Radar from "@/components/radar/Radar";
import Avatar from "@/components/radar/Avatar";
import { citiesOf, locText } from "@/lib/regions";
import type { DiscoverCandidate, DiscoverResult } from "@/lib/discover";
import styles from "./find.module.css";

type Area = "search" | "random" | "quick";
type View = "grid" | "radar";

const TABS: { key: Area; label: string }[] = [
  { key: "search", label: "找特定的人" },
  { key: "random", label: "随机推荐" },
  { key: "quick", label: "快速匹配" },
];

/* 人格倾向下拉项：与 seed 里的 type 取值一致 */
const TYPES = ["深度思考型", "好奇探索型", "温和共情型", "理性辩手型", "体验派", "务实执行型"];

/* 卡片上的一句话状态 */
const KIND_LABEL: Record<string, string> = {
  human: "真人",
  synthetic: "AI 演示人格",
  public_creator: "公开创作者",
};

/** 随机取 n 个（用 Fisher–Yates，避免 sort(random) 的分布偏差） */
function pickRandom<T>(list: T[], n: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export default function DiscoverClient({
  data,
  personaId,
}: {
  data: DiscoverResult;
  personaId: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Area>("search");

  /* 三个区域各自记忆视图，切换标签时不丢 */
  const [view, setView] = useState<Record<Area, View>>({
    search: "grid",
    random: "grid",
    quick: "grid",
  });

  /* 筛选条件 */
  const [kw, setKw] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [type, setType] = useState("");
  const [agentOnly, setAgentOnly] = useState(false);

  /* 随机推荐的一批（首次进入随机取 4 位） */
  const [randomPick, setRandomPick] = useState<DiscoverCandidate[]>(() =>
    pickRandom(data.candidates, 4),
  );

  /* 快速匹配：点击后才出结果 */
  const [quickList, setQuickList] = useState<DiscoverCandidate[] | null>(null);

  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  };

  /* ── 筛选 ────────────────────────────────────────────────────────────── */
  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase();
    return data.candidates.filter((c) => {
      if (province && c.province !== province) return false;
      if (city && c.city !== city) return false;
      if (type && c.type !== type) return false;
      if (agentOnly && !c.agentOpen) return false;
      if (q) {
        const hay = [c.displayName, c.type ?? "", c.bio ?? "", c.city ?? "", c.province ?? "", ...c.tags]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.candidates, kw, province, city, type, agentOnly]);

  const cityOptions = province ? citiesOf(province) : [];

  const resetFilters = () => {
    setKw("");
    setProvince("");
    setCity("");
    setType("");
    setAgentOnly(false);
  };

  const setAreaView = (area: Area, v: View) => setView((s) => ({ ...s, [area]: v }));

  /* 让我的 Agent 先聊聊：不跳页，弹提示。
     与首页/人格卡一致 —— 侧栏的进度小圆点由 AppShell 负责。 */
  const startMeet = (p: DiscoverCandidate) => {
    try {
      localStorage.setItem(
        "zhiyu-pending-meet",
        JSON.stringify({ id: p.id, title: p.displayName, at: Date.now() }),
      );
      localStorage.setItem("zhiyu-match-focus", p.id);
    } catch {
      /* 隐私模式下写入失败不影响本次交互 */
    }
    showToast(`你的 Agent 已在后台开始和 ${p.displayName} 对话，有进展会通知你。`);
  };

  /* ── 卡片 ────────────────────────────────────────────────────────────── */
  const Card = ({ p, withSim }: { p: DiscoverCandidate; withSim: boolean }) => (
    <article className={styles.card} data-id={p.id}>
      <div className={styles.pHead}>
        <span className={`${styles.pAvatar} avatar`}>
          <Avatar avatarUrl={null} seed={p.id} width={46} height={46} />
        </span>
        <div>
          <div className={styles.pTitle}>{p.displayName}</div>
          <span className={styles.pPill}>{KIND_LABEL[p.kind] ?? p.kind}</span>
        </div>
      </div>

      <ul className={styles.pMeta}>
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          {locText(p.province, p.city)}
        </li>
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-3.9 3.6-6 8-6s8 2.1 8 6" />
          </svg>
          {p.type ?? "—"}
        </li>
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {p.agentOpen ? "接受 Agent 对话" : "暂未开放 Agent 对话"}
        </li>
      </ul>

      <div className={styles.pTags}>
        {p.tags.map((t) => (
          <span key={t} className={styles.pTag}>
            {t}
          </span>
        ))}
      </div>

      {withSim ? (
        <div className={styles.simBlock}>
          <div className={styles.simTop}>
            <span>与你的相似度</span>
            <span className={`num ${styles.simNum}`}>{p.sim}%</span>
          </div>
          <span className="track">
            <i className="trackFill" style={{ width: `${p.sim}%` }} />
          </span>
        </div>
      ) : null}

      <div className={styles.pActions}>
        <button
          type="button"
          className="btn btnGhost btnArrow"
          onClick={() => router.push(`/persona?id=${p.id}`)}
        >
          查看人格卡
        </button>
        {p.agentOpen ? (
          <button type="button" className="btn btnPrimary" onClick={() => startMeet(p)}>
            让 Agent 先聊聊
          </button>
        ) : null}
      </div>
    </article>
  );

  const Grid = ({ list, withSim }: { list: DiscoverCandidate[]; withSim: boolean }) =>
    list.length ? (
      <div className={styles.grid}>
        {list.map((p) => (
          <Card key={p.id} p={p} withSim={withSim} />
        ))}
      </div>
    ) : (
      <div className={styles.emptyState}>
        <div className={styles.emptyBig}>没有符合条件的结果</div>
        <p>试试清空筛选，或换一个关键词——也可能是 TA 还没有开放 Agent 对话。</p>
      </div>
    );

  /* 视图切换器 */
  const ViewSeg = ({ area }: { area: Area }) => (
    <span className={styles.viewSeg} role="tablist" aria-label="结果展示方式">
      {(["grid", "radar"] as View[]).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view[area] === v}
          className={view[area] === v ? styles.segActive : ""}
          onClick={() => setAreaView(area, v)}
        >
          {v === "grid" ? "卡片" : "相遇雷达"}
        </button>
      ))}
    </span>
  );

  /* 一个区域的结果区：按当前视图画卡片或雷达 */
  const ResultArea = ({
    area,
    list,
    withSim,
  }: {
    area: Area;
    list: DiscoverCandidate[];
    withSim: boolean;
  }) =>
    view[area] === "radar" ? (
      <div className={styles.radarStage}>
        <Radar
          people={list.map((p) => ({
            id: p.id,
            title: p.displayName,
            type: p.type ?? "",
            sim: p.sim,
            avatarUrl: null,
          }))}
          onOpenProfile={(id) => router.push(`/persona?id=${id}`)}
        />
      </div>
    ) : (
      <Grid list={list} withSim={withSim} />
    );

  return (
    <>
      <header className={styles.findHead}>
        <div>
          <p className={styles.eyebrowMeta}>知遇 · 发现</p>
          <h1>今天，要和谁相遇？</h1>
        </div>
        <span className={styles.seg}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? styles.segActive : ""}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </span>
      </header>

      {!data.meReady ? (
        <div className={styles.warnBar}>
          你的人设数据还不完整，相似度可能不准。先去「我的人格」补齐数据源再回来。
        </div>
      ) : null}

      {/* ① 找特定的人 */}
      {tab === "search" ? (
        <section className="panel">
          <p className="panelEyebrow">找人 · 按条件筛选</p>

          <div className={styles.searchRow}>
            <span className={`searchInput ${styles.searchInput}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" width="17" height="17">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="输入昵称、话题或标签，找到想认识的人"
                aria-label="搜索关键词"
              />
            </span>
          </div>

          <div className={styles.filterRow}>
            <div className={styles.filterField}>
              <label htmlFor="f-prov">省份</label>
              <select
                id="f-prov"
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setCity("");
                }}
              >
                <option value="">全部省份</option>
                {data.provinces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="f-city">城市</label>
              <select
                id="f-city"
                value={city}
                disabled={!province}
                onChange={(e) => setCity(e.target.value)}
              >
                <option value="">{province ? "全部城市" : "请先选省份"}</option>
                {cityOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.filterField}>
              <label htmlFor="f-type">人格倾向</label>
              <select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">全部</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <label className={styles.switchWrap}>
              <span>只看接受 Agent 对话</span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={agentOnly}
                  onChange={(e) => setAgentOnly(e.target.checked)}
                  aria-label="只看接受 Agent 对话"
                />
                <i aria-hidden="true" />
              </span>
            </label>
          </div>

          <div className={styles.resultMeta}>
            <span>共 {filtered.length} 位结果</span>
            <span className={styles.resultMetaRight}>
              <ViewSeg area="search" />
              <button type="button" className={styles.resetBtn} onClick={resetFilters}>
                重置筛选
              </button>
            </span>
          </div>

          <ResultArea area="search" list={filtered} withSim={false} />
        </section>
      ) : null}

      {/* ② 随机推荐 */}
      {tab === "random" ? (
        <section className="panel">
          <p className="panelEyebrow">随机推荐 · 随机抓取</p>
          <div className={styles.randomHead}>
            <button
              type="button"
              className="btn btnSecondary"
              onClick={() => setRandomPick(pickRandom(data.candidates, 4))}
            >
              换一批 · 随机人格
            </button>
            <ViewSeg area="random" />
          </div>
          <div className={styles.resultMeta}>
            <span>本次推荐 {randomPick.length} 位</span>
          </div>
          <ResultArea area="random" list={randomPick} withSim />
        </section>
      ) : null}

      {/* ③ 快速匹配 */}
      {tab === "quick" ? (
        <section className="panel">
          <p className="panelEyebrow">快速匹配 · 直接用人格找人</p>
          <div className={styles.quickIntro}>
            <h2>用你的人格，直接找到最可能同频的人。</h2>
            <p>
              不经过 Agent 对话：直接比较兴趣、思维、价值观与沟通方式，按五维加权排出最合拍的几位。
            </p>
          </div>
          <div className={styles.quickActions}>
            <button
              type="button"
              className="btn btnPrimary"
              onClick={() =>
                setQuickList([...data.candidates].sort((a, b) => b.sim - a.sim).slice(0, 8))
              }
            >
              开始快速匹配
            </button>
            {quickList ? <ViewSeg area="quick" /> : null}
          </div>

          {quickList ? (
            <div className={styles.quickResult}>
              <div className={styles.quickResultHead}>
                <h3>匹配结果</h3>
                <span className="meta">从 {data.total} 位候选中选出 {quickList.length} 位</span>
              </div>
              <ResultArea area="quick" list={quickList} withSim />
            </div>
          ) : null}
        </section>
      ) : null}

      <div className={`toast ${toast ? "toastShow" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </>
  );
}
