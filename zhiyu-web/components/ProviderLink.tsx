"use client";

import { useCallback, useEffect, useState } from "react";
import type { OAuthProvider } from "@/lib/oauth/platforms";
import { reportError, reportSuccess } from "@/lib/client/error-bus";
import styles from "./ProviderLink.module.css";

/**
 * 「授权平台自动同步」区块（飞书 / 钉钉）。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「你要引导用户允许授权网站使用他们的飞书、钉钉账号的数据呀。」
 *
 * 所以这个区块在**三种状态下都给得出下一步**，绝不出现"点了没反应"：
 *   ① 服务端还没配应用凭证 → 展示**申请与配置步骤**（含环境变量名与控制台入口），
 *      并如实说明"配好之后这里会变成授权按钮"
 *   ② 配好了但用户没授权 → 「授权飞书并同步」，点进平台授权页
 *   ③ 已授权 → 「同步」/「追加同步」，另有"重新授权"与"解除授权"
 *
 * 并且无论哪种状态，都先把**会读什么、读不到什么**写在按钮上方 ——
 * 让用户在点"同意"之前就知道自己交出去的是什么。
 */

interface ProviderStatus {
  meta: {
    provider: OAuthProvider;
    label: string;
    connectLabel: string;
    summary: string;
    capability: { canPull: string[]; cannotPull: { what: string; why: string }[] };
    setupSteps: string[];
    envKeys: { appId: string; appSecret: string; redirectUri: string };
    consoleUrl: string;
    scope: string;
  };
  configured: boolean;
  redirectUri: string;
  envKeys: { appId: string; appSecret: string; redirectUri: string };
  linked: { displayName: string | null; expired: boolean } | null;
}

export default function ProviderLink({
  provider,
  /** 同步成功后通知父组件刷新服务端数据 */
  onSynced,
}: {
  provider: OAuthProvider;
  onSynced: () => void;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showSteps, setShowSteps] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = (await fetch("/api/oauth/status").then((x) => x.json())) as {
        ok: boolean;
        providers: Record<string, ProviderStatus>;
      };
      if (r.ok) setStatus(r.providers[provider] ?? null);
    } catch {
      /* 查不到就不显示这个区块，不打断主流程 */
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = useCallback(
    async (mode: "replace" | "append") => {
      setBusy(true);
      setMsg("");
      try {
        const r = (await fetch(`/api/oauth/${provider}/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-silent-error": "1" },
          body: JSON.stringify({ mode }),
        }).then((x) => x.json())) as {
          ok: boolean;
          error?: string;
          code?: string;
          counts?: { pulled: number; evidence: number; total: number };
          warning?: string;
        };
        if (!r.ok) {
          setMsg(r.error ?? "同步失败");
          reportError(new Error(r.error ?? "同步失败"), { title: `${status?.meta.label ?? ""}同步失败` });
          return;
        }
        setMsg(
          `同步完成：拉到 ${r.counts?.pulled ?? 0} 条，写入证据 ${r.counts?.evidence ?? 0} 条` +
            `（该源现有 ${r.counts?.total ?? 0} 条）。`,
        );
        reportSuccess(`${status?.meta.label ?? ""}数据已同步`);
        onSynced();
      } catch (e) {
        setMsg(`同步失败：${(e as Error).message}`);
        reportError(e, { title: "同步失败" });
      } finally {
        setBusy(false);
      }
    },
    [onSynced, provider, status?.meta.label],
  );

  if (!status) return null;
  const { meta, configured, linked } = status;
  /* 授权地址就在本站，用 location 跳转（后端会 302 到平台授权页） */
  const authorizeHref = `/api/oauth/${provider}?returnTo=${encodeURIComponent(
    "/persona?tab=sources",
  )}`;

  return (
    <div className={styles.wrap} data-provider-link={provider}>
      <p className={styles.head}>
        <span className={styles.badge}>授权自动同步</span>
        {linked && !linked.expired ? (
          <span className={styles.linked}>
            已授权{linked.displayName ? `（${linked.displayName}）` : ""}
          </span>
        ) : linked ? (
          <span className={styles.expired}>授权已过期，请重新授权</span>
        ) : (
          <span className={styles.unlinked}>{configured ? "尚未授权" : "功能待配置"}</span>
        )}
      </p>

      {/* 会读什么 / 读不到什么 —— 点"同意"之前就该看到 */}
      <p className={styles.summary}>{meta.summary}</p>
      <ul className={styles.can}>
        {meta.capability.canPull.map((x) => (
          <li key={x}>
            <b>可读取</b>
            {x}
          </li>
        ))}
        {meta.capability.cannotPull.map((c) => (
          <li key={c.what} data-cannot-pull="1">
            <b>读不到</b>
            {c.what} —— {c.why}
          </li>
        ))}
      </ul>

      {configured ? (
        <div className={styles.actions}>
          {linked && !linked.expired ? (
            <>
              <button
                type="button"
                className="btn btnPrimary btnSm"
                data-provider-sync="replace"
                onClick={() => void sync("replace")}
                disabled={busy}
              >
                {busy ? "同步中…" : "同步（覆盖）"}
              </button>
              <button
                type="button"
                className="btn btnSecondary btnSm"
                data-provider-sync="append"
                onClick={() => void sync("append")}
                disabled={busy}
              >
                追加同步
              </button>
              <a className={styles.relink} href={authorizeHref}>
                重新授权
              </a>
            </>
          ) : (
            <a
              className="btn btnPrimary btnSm"
              data-provider-authorize="1"
              href={authorizeHref}
            >
              {meta.connectLabel}
            </a>
          )}
        </div>
      ) : (
        <div className={styles.setup} data-provider-setup="1">
          <p className={styles.setupLead}>
            本站还没有配置{meta.label}应用凭证，所以自动同步暂时不可用 ——
            自动同步需要你先在{meta.label}开放平台注册一个应用，
            把凭证交给本站使用（本站只读取上面列出的数据，不会写、不会改）。
          </p>
          <button
            type="button"
            className={styles.stepsToggle}
            onClick={() => setShowSteps((v) => !v)}
          >
            {showSteps ? "收起配置步骤" : `查看配置步骤（${meta.setupSteps.length} 步）`}
          </button>
          {showSteps ? (
            <div className={styles.steps}>
              <ol>
                {meta.setupSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <ul className={styles.envList}>
                <li>
                  <code>{status.envKeys.appId}</code>
                </li>
                <li>
                  <code>{status.envKeys.appSecret}</code>
                </li>
                <li>
                  <code>{status.envKeys.redirectUri}</code>
                  {status.redirectUri ? ` = ${status.redirectUri}` : ""}
                </li>
              </ul>
              {status.redirectUri ? (
                <p className={styles.redirectNote}>
                  回调地址就是这个（填到平台后台的「重定向 URL / 回调域名」里）：
                  <code>{status.redirectUri}</code>
                </p>
              ) : null}
              <p className={styles.consoleNote}>
                申请入口：
                <a href={meta.consoleUrl} target="_blank" rel="noreferrer noopener">
                  {meta.consoleUrl} ↗
                </a>
                <br />
                需要的权限：<code>{meta.scope}</code>
              </p>
              <p className={styles.fallbackNote}>
                在配好之前，{meta.label}的数据仍可用下方的
                <b>手动导入</b>
                提供（用 distilly 在本机采集，或平台自带的导出功能）。
              </p>
            </div>
          ) : null}
        </div>
      )}

      {msg ? (
        <p className={styles.msg} data-provider-msg="1">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
