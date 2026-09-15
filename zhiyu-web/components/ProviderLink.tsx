"use client";

import { useCallback, useEffect, useState } from "react";
import type { OAuthProvider } from "@/lib/oauth/platforms";
import { reportError } from "@/lib/client/error-bus";
import SyncSetup from "./SyncSetup";
import styles from "./ProviderLink.module.css";

/**
 * 「同步数据」按钮 —— 飞书 / 钉钉卡片上那一个。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「按钮分成两个，一个"同步数据"…一步步跳转网页，一步步引导用户操作，
 *     能不让用户动手就不要让用户做。」
 *   「不要搞一大堆文字说明！！！」
 *
 * 所以这里**只有一行状态 + 一个按钮**，点下去自动分流：
 *   未配置凭证 → 弹三步向导（点按钮跳平台、复制回调地址、粘 App ID/Secret）
 *   已配置未授权 → 直接跳平台授权页（回来即自动同步）
 *   已授权 → 直接同步（只加不删）
 */

interface ProviderStatus {
  provider: OAuthProvider;
  label: string;
  configured: boolean;
  linked: { displayName: string | null; expired: boolean } | null;
}

export default function ProviderLink({
  provider,
  onSynced,
}: {
  provider: OAuthProvider;
  onSynced: () => void;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [wizard, setWizard] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = (await fetch("/api/oauth/status").then((x) => x.json())) as {
        ok: boolean;
        providers: Record<string, ProviderStatus>;
      };
      if (r.ok) setStatus(r.providers?.[provider] ?? null);
    } catch {
      /* 查不到就不显示按钮，不打断主流程 */
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 授权回来时带上结果（callback 会顺手同步），直接展示，省一次点击 */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    /* 服务端说"还没配凭证"时**自动打开向导** —— 用户点完「同步数据」
       不该看到一个需要自己解读的参数 */
    if (sp.get("link") === `${provider}_unconfigured`) {
      setWizard(true);
      return;
    }
    if (sp.get("linked") !== provider) return;
    const pulled = sp.get("pulled");
    const failed = sp.get("syncFailed");
    if (pulled) setNote(`已同步 ${pulled} 条`);
    else if (failed) setNote(`已授权，但同步失败：${failed}`);
  }, [provider]);

  const sync = useCallback(async () => {
    setBusy(true);
    setNote("");
    try {
      const r = (await fetch(`/api/oauth/${provider}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-silent-error": "1" },
        body: JSON.stringify({ mode: "append" }),
      }).then((x) => x.json())) as {
        ok: boolean;
        error?: string;
        code?: string;
        counts?: { pulled: number; written: number; total: number };
      };

      if (!r.ok) {
        /* 授权过期 / 没授权 → 直接推去授权，不让用户自己判断 */
        if (r.code === "NOT_LINKED" || r.code === "TOKEN_EXPIRED") {
          window.location.href = `/api/oauth/${provider}`;
          return;
        }
        setNote(r.error ?? "同步失败");
        reportError(new Error(r.error ?? "同步失败"), { title: "同步失败" });
        return;
      }
      setNote(
        `新增 ${r.counts?.written ?? 0} 条（读到 ${r.counts?.pulled ?? 0} 条，共 ${
          r.counts?.total ?? 0
        } 条）`,
      );
      onSynced();
    } catch (e) {
      setNote(`同步失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [onSynced, provider]);

  const onClick = useCallback(() => {
    /**
     * 状态还没拿到（接口慢或失败）时**也让按钮可用**：
     * 直接交给服务端判断 —— 它要么跳平台授权页，要么带
     * `link=<provider>_unconfigured` 回来，页面会把向导自动弹出来。
     *
     * 为什么这么写：先前 `if (!status) return null` 会让按钮**整个消失**，
     * 一次接口抖动就等于功能不见了（e2e 因此偶发失败，实测）。
     * 按钮永远在，判断交给后端。
     */
    if (!status) {
      window.location.href = `/api/oauth/${provider}`;
      return;
    }
    /* 没配凭证 → 向导；配了但没授权 → 直接跳授权页；都好了 → 同步 */
    if (!status.configured) {
      setWizard(true);
      return;
    }
    if (!status.linked || status.linked.expired) {
      window.location.href = `/api/oauth/${provider}`;
      return;
    }
    void sync();
  }, [status, sync, provider]);

  const state = !status
    ? "检查中…"
    : !status.configured
      ? "未配置"
      : status.linked && !status.linked.expired
        ? status.linked.displayName
          ? `已连接 ${status.linked.displayName}`
          : "已连接"
        : "未授权";

  return (
    <span className={styles.row} data-provider-link={provider}>
      <button
        type="button"
        className="btn btnPrimary btnSm"
        onClick={onClick}
        disabled={busy}
        data-provider-sync="1"
        data-provider-state={state}
      >
        {busy ? "同步中…" : "同步数据"}
      </button>
      <span className={styles.state} data-provider-state-text="1">
        {note || state}
      </span>

      {wizard ? (
        <SyncSetup
          provider={provider}
          onClose={() => setWizard(false)}
          onSaved={() => {
            setWizard(false);
            void load();
            /* 存完凭证直接推去授权 —— 用户不需要再点一次 */
            window.location.href = `/api/oauth/${provider}`;
          }}
        />
      ) : null}
    </span>
  );
}
