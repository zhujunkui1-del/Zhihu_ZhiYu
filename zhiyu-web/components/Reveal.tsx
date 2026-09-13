"use client";

import { useEffect, useRef } from "react";

/**
 * 滚动进场动画。
 *
 * 结构（两层，各有职责）：
 *   <div class="reveal">      ← 布局中性壳（display: contents），不生成盒子，
 *   │                            因此放进 grid / flex 容器不会破坏父级布局
 *   └ <div class="revealBox"> ← 真正承担 opacity / transform 的内层
 *
 * 为什么必须是两层：早期版本只有一层，它插进 grid 容器时会把列结构撑坏
 * （登录页的卡片因此变成满宽、两列失效）。布局跟动画不能由同一个盒子承担。
 */
export default function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    /* 不支持 IntersectionObserver（或自动化环境里被禁用）时直接显现，
       避免内容永久停留在 opacity: 0 —— 那会让整页看起来是空的。 */
    if (typeof IntersectionObserver === "undefined") {
      node.classList.add("is-in");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.22, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`reveal ${className}`.trim()}>
      <div
        ref={ref}
        className="revealBox"
        style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
