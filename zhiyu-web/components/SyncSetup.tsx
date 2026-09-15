"use client";

import { useCallback, useState } from "react";
import type { OAuthProvider } from "@/lib/oauth/platforms";
import styles from "./SyncSetup.module.css";

/**
 * 「同步数据」的配置向导 —— 三步，每步一个**直接跳转的按钮**。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「这样的方式给我一步步跳转网页，一步步引导用户操作，能不让用户动手就
 *     不要让用户做，你自己写脚本怎么让用户方便怎么来。」
 *   「不要搞一大堆文字说明！！！」
 *
 * 所以这里的形态是：**一屏三步、每步一句话 + 一个跳转按钮 + 一个复制按钮**。
 * 不写原理、不写权限列表、不写 API 说明 —— 用户只需要点。
 *
 * 三件事本来必须去平台后台做（任何网站都替不了）：建应用、加权限、填回调地址。
 * 能替用户做的都替了：直达链接带到底、回调地址一键复制、App ID/Secret 存本站
 * （不用去 Vercel 配环境变量）。
 */

interface ProviderStatus {
  provider: OAuthProvider;
  label: string;
  configured: boolean;
  appId: string | null;
  redirectUri: string;
  consoleUrl: string;
  scope: string;
}

export default function SyncSetup({
  provider,
  onClose,
  onSaved,
}: {
  provider: OAuthProvider;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  /* 这些值在打开时由父组件传进来是不必要的耦合：向导自己拉一次最省事 */
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  useState(() => {
    void (async () => {
      try {
        const r = (await fetch("/api/oauth/status").then((x) => x.json())) as {
          providers: Record<string, ProviderStatus>;
        };
        setStatus(r.providers?.[provider] ?? null);
      } catch {
        /* 拿不到就只显示通用步骤，不阻塞 */
      }
    })();
  });

  const redirectUri =
    status?.redirectUri ?? `${typeof location !== "undefined" ? location.origin : ""}/api/oauth/${provider}/callback`;
  const consoleUrl = status?.consoleUrl ?? (provider === "feishu" ? "https://open.feishu.cn/app" : "https://open-dev.dingtalk.com");

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setMsg("复制失败，请手动选中复制");
    }
  }, [redirectUri]);

  const save = useCallback(async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = (await fetch("/api/oauth/app", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-silent-error": "1" },
        body: JSON.stringify({ provider, appId, appSecret, redirectUri }),
      }).then((x) => x.json())) as { ok: boolean; error?: string };
      if (!r.ok) {
        setMsg(r.error ?? "保存失败");
        return;
      }
      onSaved();
    } catch (e) {
      setMsg(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [appId, appSecret, onSaved, provider, redirectUri]);

  return (
    <div className={styles.wrap} data-sync-setup={provider} role="dialog" aria-modal="true">
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.dialog}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
          ✕
        </button>
        <h3 className={styles.title}>{status?.label ?? ""}同步 · 首次配置</h3>
        <p className={styles.sub}>只需一次，之后点「同步数据」一步到位。</p>

        <ol className={styles.steps}>
          <li data-step="1">
            <span className={styles.num}>1</span>
            <span className={styles.stepText}>建一个应用</span>
            <a
              className="btn btnSecondary btnSm"
              href={consoleUrl}
              target="_blank"
              rel="noreferrer noopener"
              data-setup-open-console="1"
            >
              打开{status?.label ?? ""}开放平台 ↗
            </a>
          </li>

          <li data-step="2">
            <span className={styles.num}>2</span>
            <span className={styles.stepText}>
              复制这个回调地址，粘到应用的「重定向 URL / 回调域名」
            </span>
            <span className={styles.copyRow}>
              <code className={styles.uri} data-setup-redirect="1">
                {redirectUri}
              </code>
              <button
                type="button"
                className="btn btnSecondary btnSm"
                onClick={() => void copy()}
                data-setup-copy="1"
              >
                {copied ? "已复制 ✓" : "复制"}
              </button>
            </span>
          </li>

          <li data-step="3">
            <span className={styles.num}>3</span>
            <span className={styles.stepText}>
              把应用的 App ID / App Secret 粘到这里
            </span>
            <span className={styles.inputs}>
              <input
                className={styles.input}
                placeholder={provider === "feishu" ? "App ID（cli_…）" : "AppKey（ding…）"}
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                data-setup-appid="1"
              />
              <input
                className={styles.input}
                placeholder="App Secret"
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                data-setup-secret="1"
              />
            </span>
          </li>
        </ol>

        {msg ? (
          <p className={styles.msg} data-setup-msg="1">
            {msg}
          </p>
        ) : null}

        <div className={styles.foot}>
          <button type="button" className="btn btnSecondary" onClick={onClose} disabled={busy}>
            稍后
          </button>
          <button
            type="button"
            className="btn btnPrimary"
            onClick={() => void save()}
            disabled={busy || !appId.trim() || !appSecret.trim()}
            data-setup-save="1"
          >
            {busy ? "保存中…" : "保存并开始同步"}
          </button>
        </div>
      </div>
    </div>
  );
}
