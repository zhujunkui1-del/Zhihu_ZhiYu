"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./NavProgress.module.css";

/**
 * 顶部导航进度条。
 *
 * 为什么需要它：
 * 本项目页面都是服务端渲染（要读会话与数据库），单次导航实测 350~800ms。
 * 这段时间里浏览器**没有任何视觉反馈**——用户会以为点击没生效，
 * 于是重复点击，体感更差。进度条把"正在加载"这件事显式表达出来。
 *
 * 实现要点：
 *   · 不用真实进度（浏览器拿不到），而是"先快后慢"的拟真推进：
 *     0 → 30% 很快，之后逐渐放缓，接近 90% 时停住，等真正的导航完成再补到 100%
 *   · 监听两类事件：
 *     ① 站内链接点击（capture 阶段，早于 Next 的路由处理）
 *     ② pathname 变化（导航真正完成）
 *   · 同时监听 `popstate`（浏览器前进/后退）
 *   · 组件**不占用布局**（fixed 定位 + pointer-events: none），
 *     不会影响任何现有排版
 */
export default function NavProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  /** 递增定时器；用 ref 避免闭包拿到旧值 */
  const tickRef = useRef<number | null>(null);
  const hideRef = useRef<number | null>(null);
  const startedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (hideRef.current !== null) {
      window.clearTimeout(hideRef.current);
      hideRef.current = null;
    }
  }, []);

  /** 开始：进度先冲到 30%，之后每次 +1% 且越来越慢 */
  const start = useCallback(() => {
    clearTimers();
    startedRef.current = true;
    setVisible(true);
    setProgress(8);
    /* 用两个节奏：先快速到 ~55%，再极慢逼近 90% */
    let p = 8;
    tickRef.current = window.setInterval(() => {
      const step = p < 55 ? 9 : p < 75 ? 3 : p < 88 ? 1 : 0.3;
      p = Math.min(p + step, 92);
      setProgress(p);
      if (p >= 92 && tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }, 180);
  }, [clearTimers]);

  /** 完成：补到 100% 再淡出 */
  const done = useCallback(() => {
    if (!startedRef.current) return;
    startedRef.current = false;
    clearTimers();
    setProgress(100);
    hideRef.current = window.setTimeout(() => {
      setVisible(false);
      /* 等淡出动画结束再归零，避免看到回跳 */
      window.setTimeout(() => setProgress(0), 260);
    }, 200);
  }, [clearTimers]);

  /* ① 站内链接点击 —— capture 阶段监听，早于 Next 接管 */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      /* 只处理左键、无修饰键的普通点击 */
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const a = el?.closest?.("a");
      if (!a) return;

      const href = a.getAttribute("href");
      if (!href) return;
      /* 外链、锚点、下载、新窗口都不算站内导航 */
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      if (/^(https?:)?\/\//.test(href) || href.startsWith("#")) return;
      if (/^(mailto|tel):/.test(href)) return;

      /* 同页跳转不用显示（例如只改 hash） */
      const target = href.split("#")[0];
      if (target && target === window.location.pathname) return;

      start();
    };

    /* ② 浏览器前进/后退 */
    const onPop = () => start();

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, [start]);

  /* ③ 路由变化 = 导航完成 */
  useEffect(() => {
    done();
  }, [pathname, done]);

  /* ④ 超时保护：万一 done 没被触发（例如导航被取消），
        最长 10 秒后强制收起，避免进度条卡在 90% */
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => done(), 10_000);
    return () => window.clearTimeout(t);
  }, [visible, done]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <div
      className={`${styles.wrap} ${visible ? styles.wrapOn : ""}`}
      role="progressbar"
      aria-label="页面加载进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      aria-hidden={!visible}
    >
      <div className={styles.bar} style={{ width: `${progress}%` }} />
    </div>
  );
}
