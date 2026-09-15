"use client";

import { useCallback, useEffect, useState } from "react";
import type { OAuthProvider } from "@/lib/oauth/platforms";
import { reportError } from "@/lib/client/error-bus";
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
  onNeedSetup,
}: {
  provider: OAuthProvider;
  onSynced: () => void;
  /**
   * 需要配置凭证时，通知**页面**去打开配置向导。
   *
   * ⚠️ 向导**不在卡片里渲染**（原先就是这么写的，用户实测出问题）：
   *   · 每张卡各渲染一份 → 页面上同时存在两个弹窗；
   *   · 卡片的 hover 有 transform，会让 `position: fixed` **相对卡片定位**，
   *     弹窗就不在屏幕中央（用户截图里它歪在微信卡片上方）。
   * 现在全页只有一份，由页面统一渲染在中央。
   */
  onNeedSetup: () => void;
}) {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  /** 飞书：私聊会话 ID 的输入面板（可选，不填就只同步群聊） */
  const [p2pOpen, setP2pOpen] = useState(false);
  const [p2pText, setP2pText] = useState("");
  const [p2pSaved, setP2pSaved] = useState<string[]>([]);

  /** 读"配没配 / 授权没授权"（决定按钮点下去是弹向导、跳授权页还是直接同步） */
  const load = useCallback(async () => {
    try {
      const r = (await fetch("/api/oauth/status").then((x) => x.json())) as {
        ok: boolean;
        providers: Record<string, ProviderStatus>;
      };
      if (r.ok) setStatus(r.providers?.[provider] ?? null);
    } catch {
      /* 查不到就不显示状态文字，按钮照样能点（见 onClick 的兜底） */
    }
  }, [provider]);

  const loadP2p = useCallback(async () => {
    if (provider !== "feishu") return;
    try {
      const r = (await fetch("/api/oauth/feishu/p2p").then((x) => x.json())) as {
        ok: boolean;
        p2pChatIds?: string[];
      };
      if (r.ok) {
        setP2pSaved(r.p2pChatIds ?? []);
        setP2pText((r.p2pChatIds ?? []).join("\n"));
      }
    } catch {
      /* 拿不到就不显示这块，不影响主流程 */
    }
  }, [provider]);

  useEffect(() => {
    void load();
    void loadP2p();
  }, [load, loadP2p]);

  const saveP2p = useCallback(async () => {
    setBusy(true);
    try {
      const ids = p2pText
        .split(/[\s,，;；]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = (await fetch("/api/oauth/feishu/p2p", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-silent-error": "1" },
        body: JSON.stringify({ ids }),
      }).then((x) => x.json())) as {
        ok: boolean;
        error?: string;
        p2pChatIds?: string[];
        dropped?: string[];
      };

      /* 未授权时后端回 409 NOT_LINKED —— 要把那句话原样说给用户，
         不能显示成"已保存 0 个"（那等于骗人）。 */
      if (!r.ok) {
        setNote(r.error ?? "保存失败");
        return;
      }

      const saved = r.p2pChatIds ?? [];
      setP2pSaved(saved);
      setP2pText(saved.join("\n"));
      setNote(
        r.dropped?.length
          ? `已保存 ${saved.length} 个；有 ${r.dropped.length} 个格式不对被忽略（要是 oc_ 开头）`
          : `已保存 ${saved.length} 个私聊会话`,
      );
      setP2pOpen(false);
    } catch (e) {
      setNote(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [p2pText]);

  /* 授权回来时带上结果（callback 会顺手同步），直接展示，省一次点击 */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("linked") !== provider) return;
    const pulled = sp.get("pulled");
    const failed = sp.get("syncFailed");
    if (pulled) setNote(`已同步 ${pulled} 条`);
    else if (failed) setNote(`已授权，但同步失败：${failed}`);
    /* ⚠️ 结果读到就把参数清掉：不清的话任何一次重挂载都会再读一遍，
       配上"自动开向导"的逻辑就会变成弹窗反复弹出（实测的闪屏）。 */
    sp.delete("linked");
    sp.delete("pulled");
    sp.delete("syncFailed");
    const q = sp.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
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
     * `link=<provider>_unconfigured` 回来，页面会把向导弹出来。
     *
     * 为什么这么写：先前 `if (!status) return null` 会让按钮**整个消失**，
     * 一次接口抖动就等于功能不见了（e2e 因此偶发失败，实测）。
     * 按钮永远在，判断交给后端。
     */
    if (!status) {
      window.location.href = `/api/oauth/${provider}`;
      return;
    }
    /* 没配凭证 → 让**页面**打开向导（全页只有一份，居中）；配了但没授权 → 跳授权页；
       都好了 → 同步 */
    if (!status.configured) {
      onNeedSetup();
      return;
    }
    if (!status.linked || status.linked.expired) {
      window.location.href = `/api/oauth/${provider}`;
      return;
    }
    void sync();
  }, [status, sync, provider, onNeedSetup]);

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

      {/* 飞书：私聊会话 ID（可选）。平时只占一个字链接，点开才出现输入框 */}
      {provider === "feishu" ? (
        <button
          type="button"
          className={styles.linkBtn}
          data-provider-p2p="1"
          onClick={() => setP2pOpen((v) => !v)}
        >
          私聊{p2pSaved.length ? ` ${p2pSaved.length}` : ""}
        </button>
      ) : null}

      <span className={styles.state} data-provider-state-text="1" title={note || state}>
        {note || state}
      </span>

      {p2pOpen ? (
        <div className={styles.p2p} data-provider-p2p-panel="1">
          <p className={styles.p2pHint}>
            飞书里打开那个私聊 → 右上角设置 → 复制「群 ID」，粘到这里（一行一个）
          </p>
          <textarea
            className={styles.p2pInput}
            rows={3}
            placeholder="oc_xxxxxxxxxxxxxxxx"
            value={p2pText}
            onChange={(e) => setP2pText(e.target.value)}
            data-provider-p2p-input="1"
          />
          <span className={styles.p2pBtns}>
            <button
              type="button"
              className="btn btnSecondary btnSm"
              onClick={() => setP2pOpen(false)}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btnPrimary btnSm"
              onClick={() => void saveP2p()}
              disabled={busy}
              data-provider-p2p-save="1"
            >
              保存
            </button>
          </span>
        </div>
      ) : null}
    </span>
  );
}
