"use client";

import { useCallback, useEffect, useState } from "react";
import PersonaCard from "./PersonaCard";
import { reportError } from "@/lib/client/error-bus";
import type { PersonaCardData } from "@/lib/persona-card";
import styles from "./PersonaCardModal.module.css";

/**
 * 弹窗人格卡。
 *
 * 产品要求（用户反复强调，之前一直没做到）：
 *   首页「去看看 TA」与发现页「查看人格卡」**不要跳转界面** ——
 *   不换路由、不离开当前页，**就地以弹窗打开对方的人格卡**。
 *
 * 所以这里没有任何 router.push：只用 `?persona=<id>` 同步一下地址栏
 * （便于刷新/分享回到同一张卡），页面本身不离开。
 *
 * 关闭方式给了四种，避免"弹出来关不掉"：
 *   ① 右上角 ✕　② 点背景　③ Esc　④ 点「关闭」
 */
export default function PersonaCardModal({
  personaId,
  /** 自己的 persona id：等于对方时说明是"我的人格"，文案要区分 */
  ownPersonaId,
  onClose,
}: {
  personaId: string | null;
  ownPersonaId?: string | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<PersonaCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const open = Boolean(personaId);
  const isSelf = Boolean(personaId && ownPersonaId && personaId === ownPersonaId);

  /* 拉数据。用一个 cancelled 标记：快速连点不同的人时，
     先发的请求可能后回来，避免把旧结果盖到新弹窗上。 */
  useEffect(() => {
    if (!personaId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const r = (await fetch(`/api/persona/${encodeURIComponent(personaId)}`, {
          cache: "no-store",
          headers: { "x-silent-error": "1" },
        }).then((x) => x.json())) as
          | { ok: true; persona: PersonaCardData }
          | { ok: false; error?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(r.error ?? "读取人格卡失败");
        setData(r.persona);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        reportError(e, { title: "打开人格卡失败" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  /* Esc 关闭 + 锁滚动（弹窗打开时背后页面不该跟着滚） */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  if (!open) return null;

  return (
    <div
      className={styles.wrap}
      data-persona-modal="1"
      role="dialog"
      aria-modal="true"
      aria-label={data ? `${data.displayName} 的人格卡` : "人格卡"}
    >
      {/* 点背景关闭 */}
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />

      <div className={styles.dialog} onClick={stop}>
        <button type="button" className={styles.close} aria-label="关闭人格卡" onClick={onClose}>
          ✕
        </button>

        <header className={styles.head}>
          <p className={styles.eyebrow}>{isSelf ? "知遇 · 我的人格" : "知遇 · 人格卡"}</p>
          <h2 className={styles.title} data-modal-title="1">
            {loading && !data
              ? "正在打开人格卡…"
              : data
                ? isSelf
                  ? "我的人格"
                  : `${data.displayName} 的人格卡`
                : "人格卡"}
          </h2>
        </header>

        <div className={styles.body}>
          {loading && !data ? (
            <p className={styles.state}>正在读取…</p>
          ) : error ? (
            <p className={styles.stateError}>打不开这张人格卡：{error}</p>
          ) : data ? (
            <PersonaCard data={data} compact />
          ) : null}
        </div>

        <footer className={styles.foot}>
          <button type="button" className="btn btnSecondary" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}
