"use client";

import { useEffect, useState } from "react";
import {
  installGlobalHandlers,
  subscribe,
  dismiss,
  type ToastItem,
  type ToastLevel,
} from "@/lib/client/error-bus";
import styles from "./GlobalToasts.module.css";

/**
 * 全局报错弹幕。
 *
 * 挂在根 layout 上，所以**任何页面**的报错都会在这里出现。
 * 位置固定在界面下方中部，自下而上堆叠（最新的在最下面，符合"弹幕"阅读方向）。
 *
 * 层级与样式：
 *   error   红——出错了，需要用户知道
 *   warn    橙——部分功能可能受影响
 *   info    中性——只是告知
 *   success 绿——操作成功
 */
export default function GlobalToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    installGlobalHandlers();
    return subscribe(setItems);
  }, []);

  if (!items.length) return null;

  return (
    <div className={styles.stack} role="region" aria-label="操作提示" data-toast-stack="1">
      {items.map((t) => (
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.level]}`}
          role={t.level === "error" ? "alert" : "status"}
          aria-live={t.level === "error" ? "assertive" : "polite"}
          data-toast-level={t.level}
        >
          <span className={styles.icon} aria-hidden="true">
            <LevelIcon level={t.level} />
          </span>

          <div className={styles.body}>
            <p className={styles.title}>{t.title}</p>
            {t.detail ? <p className={styles.detail}>{t.detail}</p> : null}
          </div>

          {t.action ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                t.action?.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}

          <button
            type="button"
            className={styles.close}
            aria-label="关闭提示"
            onClick={() => dismiss(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function LevelIcon({ level }: { level: ToastLevel }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
  } as const;
  if (level === "success") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (level === "info") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    );
  }
  /* error 与 warn 共用三角感叹号，靠颜色区分 */
  return (
    <svg {...common}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
