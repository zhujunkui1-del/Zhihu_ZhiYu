"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PersonaBoard } from "@/lib/persona-view";
import { LLM_PRESETS, presetById } from "@/lib/llm-presets";
import styles from "./settings.module.css";

export interface Prefs {
  allowAgentInvite: boolean;
  showSimilarity: boolean;
  allowReportDelivery: boolean;
}

interface Props {
  userId: string;
  personaId: string;
  displayName: string;
  zhihuAuthorized: boolean;
  zhihuHashId: string | null;
  board: PersonaBoard | null;
  prefs: Prefs;
  llmCount: number;
  encryptionOk: boolean;
  encryptionMissing: string[];
}

/** 02 区的三个开关：字段名 → 文案 */
const PREF_ROWS: {
  field: keyof Prefs;
  title: string;
  desc: string;
}[] = [
  {
    field: "allowAgentInvite",
    title: "允许他人派 Agent 与我对话",
    desc: "开启后，对方可以发起一轮 Agent 认识。关闭后，对方只能看到人格卡与相似度，不能发起 Agent 对话。",
  },
  {
    field: "showSimilarity",
    title: "允许在「快速匹配」中展示相似度",
    desc: "当你的人格数据可用时，你的 Persona 会进入快速匹配候选池，对方可以看到与你的人格相似度。关闭后，你不会被推荐给陌生人。",
  },
  {
    field: "allowReportDelivery",
    title: "允许对方发送匹配报告给我",
    desc: "对方完成与你的 Agent 对话后，可以把生成的「TA × 你」匹配报告发给你，并出现在通知中心。关闭后，对方不能把匹配报告发送到你的账号。",
  },
];

/** 01 区：数据源行（顺序与人格页一致） */
const SOURCE_ROWS: { type: string; label: string; action: string }[] = [
  { type: "wechat", label: "微信数据源", action: "去接入" },
  { type: "qq", label: "QQ 数据源", action: "去接入" },
  { type: "feishu", label: "飞书工作数据", action: "去接入" },
  { type: "dingtalk", label: "钉钉工作数据", action: "去接入" },
  { type: "sbti", label: "SBTI 人格测试", action: "去测试" },
];

interface SavedLlm {
  id: string;
  displayName: string;
  baseUrl: string;
  model: string;
  isDefault: boolean;
  keyMask: string;
  lastTestOk: boolean | null;
  latencyMs: number | null;
}

export default function SettingsClient({
  userId,
  personaId,
  displayName,
  zhihuAuthorized,
  zhihuHashId,
  board,
  prefs: initialPrefs,
  llmCount,
  encryptionOk,
  encryptionMissing,
}: Props) {
  const router = useRouter();
  const [toast, setToast] = useState("");
  const showToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(""), 3000);
  };

  /* ── ② 沟通偏好：乐观更新，失败回滚 ─────────────────────────────────── */
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [savingPref, setSavingPref] = useState<keyof Prefs | null>(null);

  const togglePref = useCallback(
    async (field: keyof Prefs) => {
      const next = !prefs[field];
      const before = prefs;
      setPrefs({ ...prefs, [field]: next }); /* 先动 UI，避免开关卡顿 */
      setSavingPref(field);
      try {
        const r = await fetch("/api/settings/prefs", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, [field]: next }),
        }).then((x) => x.json());
        if (!r.ok) throw new Error(r.error ?? "保存失败");
        setPrefs(r.prefs as Prefs);
      } catch (e) {
        setPrefs(before); /* 回滚，绝不让 UI 与服务端不一致 */
        showToast(`保存失败：${(e as Error).message}`);
      } finally {
        setSavingPref(null);
      }
    },
    [prefs, userId],
  );

  /* ── ③ BYOK ─────────────────────────────────────────────────────────── */
  const [preset, setPreset] = useState<string>("");
  const [aiName, setAiName] = useState("");
  const [aiBase, setAiBase] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [aiBusy, setAiBusy] = useState<"" | "test" | "save">("");
  const [aiResult, setAiResult] = useState("");
  const [saved, setSaved] = useState<SavedLlm[]>([]);
  const [loadErr, setLoadErr] = useState("");

  const loadLlm = useCallback(async () => {
    try {
      /* 身份由服务端从 HttpOnly 会话解析，不再通过 URL 传 userId */
      const r = await fetch("/api/settings/llm").then((x) => x.json());
      if (r.ok) setSaved(r.items as SavedLlm[]);
      else setLoadErr(r.error ?? "读取失败");
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadLlm();
  }, [loadLlm]);

  /** 选预设：自动填名称与地址（原型行为） */
  const choosePreset = (id: string) => {
    setPreset(id);
    setAiResult("");
    if (id === "__custom") {
      setAiName("");
      setAiBase("");
      setAiModel("");
      return;
    }
    const p = presetById(id);
    if (!p) return;
    setAiName(p.name);
    setAiBase(p.base);
    setAiModel(p.defaultModel ?? "");
  };

  const testLlm = async () => {
    if (!aiBase || !aiKey || !aiModel) {
      setAiResult("请先填好接入地址、API Key 与模型名");
      return;
    }
    setAiBusy("test");
    setAiResult("测试中…");
    try {
      const r = await fetch("/api/settings/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: aiBase, apiKey: aiKey, model: aiModel }),
      }).then((x) => x.json());
      setAiResult(
        r.ok ? `连接正常 · ${r.latencyMs ?? "?"}ms` : `失败：${r.error ?? "未知错误"}`,
      );
    } catch (e) {
      setAiResult(`失败：${(e as Error).message}`);
    } finally {
      setAiBusy("");
    }
  };

  const saveLlm = async () => {
    if (!aiName || !aiBase || !aiModel || !aiKey) {
      setAiResult("请填齐供应商名、接入地址、模型名与 API Key");
      return;
    }
    setAiBusy("save");
    try {
      const r = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          type: preset === "__custom" ? "custom" : "preset",
          providerKey: preset && preset !== "__custom" ? preset : null,
          displayName: aiName,
          baseUrl: aiBase,
          apiKey: aiKey,
          model: aiModel,
          isDefault: saved.length === 0,
        }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error ?? "保存失败");
      setAiResult("已保存");
      setAiKey(""); /* 保存后立刻清掉输入框里的明文 */
      await loadLlm();
      showToast("模型已接入。Agent 对话会优先使用它。");
    } catch (e) {
      setAiResult(`保存失败：${(e as Error).message}`);
    } finally {
      setAiBusy("");
    }
  };

  const removeLlm = async (id: string) => {
    const r = await fetch(`/api/settings/llm?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then((x) => x.json());
    if (r.ok) {
      await loadLlm();
      showToast("已移除该模型。");
    } else {
      showToast(r.error ?? "移除失败");
    }
  };

  /* ── ④ 退出 ─────────────────────────────────────────────────────────── */
  const [logoutOpen, setLogoutOpen] = useState(false);
  const doLogout = async () => {
    try {
      /* 清服务端会话（真实 OAuth 登录时有效；演示登录没有会话，忽略结果） */
      await fetch("/api/auth/session", { method: "DELETE" });
    } catch {
      /* 网络失败也继续本地清理 */
    }
    try {
      localStorage.removeItem("zhiyu_demo");
    } catch {
      /* 隐私模式忽略 */
    }
    router.push("/");
  };

  const injected = (type: string) =>
    board?.sourceChips.find((c) => c.type === type)?.injected ?? false;

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className="meta" style={{ margin: "0 0 10px" }}>
            知遇 · 设置
          </p>
          <h1>设置</h1>
          <p className={styles.sub}>
            管理你的身份与数据源、别人能否派 Agent 来认识你、以及大模型接入。
          </p>
        </div>
      </header>

      <div className={styles.list}>
        {/* ① 身份与数据源 */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <p className="panelEyebrow">01 · 身份与数据源</p>
          </header>
          <div className={styles.rows}>
            <div className={styles.row}>
              <div className={styles.body}>
                <h3>
                  知乎账号
                  <span className={`badge ${zhihuAuthorized ? "done" : ""}`}>
                    {zhihuAuthorized ? "已授权" : "未授权"}
                  </span>
                </h3>
                <p>
                  {zhihuAuthorized
                    ? `匹配与 Agent 只使用你授权的知乎公开内容作为人格输入之一，原始内容不用于其他用途。${
                        zhihuHashId ? `（hash_id：${zhihuHashId}）` : ""
                      }`
                    : "匹配与 Agent 只使用你授权的知乎公开内容作为人格输入之一，原始内容不用于其他用途。"}
                </p>
              </div>
            </div>

            {SOURCE_ROWS.map((r) => (
              <div key={r.type} className={styles.row}>
                <div className={styles.body}>
                  <h3>
                    {r.label}
                    <span className={`badge ${injected(r.type) ? "done" : ""}`}>
                      {injected(r.type) ? "已注入" : "未注入"}
                    </span>
                  </h3>
                </div>
                <div className={styles.ctl}>
                  <Link
                    className="btn btnSecondary btnSm"
                    href={`/persona?personaId=${personaId}`}
                  >
                    {r.action}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ② Agent 沟通偏好 */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <p className="panelEyebrow">02 · Agent 沟通偏好</p>
          </header>
          <div className={styles.rows}>
            {PREF_ROWS.map((r) => (
              <div key={r.field} className={styles.row}>
                <div className={styles.body}>
                  <h3>{r.title}</h3>
                  <p>{r.desc}</p>
                </div>
                <div className={styles.ctl}>
                  <span className={styles.swT}>
                    {savingPref === r.field ? "保存中…" : prefs[r.field] ? "已开启" : "已关闭"}
                  </span>
                  <label className={styles.switchWrap}>
                    <span className="switch">
                      <input
                        type="checkbox"
                        checked={prefs[r.field]}
                        disabled={savingPref === r.field}
                        aria-label={r.title}
                        onChange={() => void togglePref(r.field)}
                      />
                      <i aria-hidden="true" />
                    </span>
                  </label>
                </div>
              </div>
            ))}
          </div>
          <p className={styles.hint}>
            关闭任一项都会在<b>服务端</b>生效，不只是隐藏界面上的按钮。
          </p>
        </section>

        {/* ③ AI 大模型接入 */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <p className="panelEyebrow">03 · AI 大模型接入</p>
          </header>

          <div className={styles.aiWrap}>
            <p className={styles.aiLead}>
              接入你的大模型 API Key，用于驱动 Agent 对话与人格蒸馏推理。
              <b>选择下方供应商后会自动填入接入地址</b>，你只需粘贴 API Key；
              也可选择「自定义模型」手动指定。
            </p>

            {!encryptionOk ? (
              <div className={styles.warn}>
                服务端未配置加密密钥（缺 {encryptionMissing.join(" / ")}）——
                出于安全考虑，<b>生产环境必须配置后才能保存 Key</b>。开发环境会自动回落。
              </div>
            ) : null}

            <p className={styles.gLabel}>供应商</p>
            <div className={styles.providers} role="group" aria-label="选择大模型供应商">
              {LLM_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.chip} ${preset === p.id ? styles.chipOn : ""}`}
                  onClick={() => choosePreset(p.id)}
                  title={p.note ?? p.base}
                >
                  <b>{p.name}</b>
                  <small>{p.sub}</small>
                </button>
              ))}
              <button
                type="button"
                className={`${styles.chip} ${preset === "__custom" ? styles.chipOn : ""}`}
                onClick={() => choosePreset("__custom")}
              >
                <b>自定义模型</b>
                <small>手动填写</small>
              </button>
            </div>

            {preset && preset !== "__custom" && presetById(preset)?.note ? (
              <p className={styles.aiNote}>注意：{presetById(preset)!.note}</p>
            ) : null}

            <div className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="ai-name">供应商名</label>
                <input
                  id="ai-name"
                  className={styles.input}
                  value={aiName}
                  onChange={(e) => setAiName(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ai-base">接入地址 Base URL</label>
                <input
                  id="ai-base"
                  className={`${styles.input} num`}
                  type="url"
                  value={aiBase}
                  onChange={(e) => setAiBase(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ai-model">模型名</label>
                <input
                  id="ai-model"
                  className={`${styles.input} num`}
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="deepseek-chat"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="ai-key">API Key</label>
                <div className={styles.keyZone}>
                  <input
                    id="ai-key"
                    className={`${styles.input} num`}
                    type={showKey ? "text" : "password"}
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    placeholder="sk-…"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className={styles.eye}
                    aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                    aria-pressed={showKey}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className={styles.aiActions}>
                <button
                  type="button"
                  className="btn btnSecondary"
                  onClick={() => void testLlm()}
                  disabled={aiBusy !== ""}
                >
                  {aiBusy === "test" ? "测试中…" : "延迟测试"}
                </button>
                <button
                  type="button"
                  className="btn btnPrimary"
                  onClick={() => void saveLlm()}
                  disabled={aiBusy !== ""}
                >
                  {aiBusy === "save" ? "保存中…" : "保存接入"}
                </button>
                <span className={styles.aiResult} role="status" aria-live="polite">
                  {aiResult}
                </span>
              </div>
            </div>

            <div className={styles.savedBox}>
              <p className={styles.savedHead}>
                已接入的模型<span className={styles.n}>{saved.length || llmCount}</span>
              </p>
              {loadErr ? <p className={styles.aiEmpty}>读取失败：{loadErr}</p> : null}
              {saved.length ? (
                <div className={styles.savedList}>
                  {saved.map((s) => (
                    <div key={s.id} className={styles.savedRow}>
                      <div className={styles.savedMain}>
                        <b>{s.displayName}</b>
                        {s.isDefault ? <span className={styles.defChip}>默认</span> : null}
                        <span className={styles.savedMeta}>
                          {s.model} · {s.keyMask}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btnDanger btnSm"
                        onClick={() => void removeLlm(s.id)}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.aiEmpty}>还没有接入任何模型。选择一个供应商完成首次接入。</p>
              )}
              <p className={styles.aiEmpty} style={{ marginTop: 10 }}>
                未接入时，Agent 对话会使用服务端的默认模型（若有）；BYOK 的 Key
                会加密后存在服务端，<b>不会回传到浏览器</b>。
              </p>
            </div>
          </div>
        </section>

        {/* ④ 账号与退出 */}
        <section className={styles.card}>
          <header className={styles.cardHead}>
            <p className="panelEyebrow">04 · 账号与退出</p>
          </header>
          <div className={styles.rows}>
            <div className={styles.row}>
              <div className={styles.body}>
                <h3>退出登录</h3>
                <p>当前账号：{displayName}。退出后回到登录页。</p>
              </div>
              <div className={styles.ctl}>
                <button
                  type="button"
                  className="btn btnDanger btnSm"
                  onClick={() => setLogoutOpen(true)}
                >
                  退出登录
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* 退出确认 */}
      {logoutOpen ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="退出确认">
          <div className="modalBackdrop" onClick={() => setLogoutOpen(false)} />
          <div className="modalDialog" style={{ width: "min(420px, 100%)" }}>
            <h3 style={{ fontSize: 19 }}>退出登录？</h3>
            <p className="meta" style={{ marginTop: 10, lineHeight: 1.75 }}>
              退出后会回到登录页。你的人格数据与已接入的模型都会保留，下次登录还能接着用。
            </p>
            <div className="modalActions">
              <button
                type="button"
                className="btn btnSecondary"
                onClick={() => setLogoutOpen(false)}
              >
                再想想
              </button>
              <button type="button" className="btn btnSolidDanger" onClick={() => void doLogout()}>
                退出登录
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`toast ${toast ? "toastShow" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </>
  );
}
