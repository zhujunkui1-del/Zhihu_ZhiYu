"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeLayout,
  computeView,
  zoomAt,
  DRAG_THRESHOLD,
  K_MIN,
  K_MAX,
  type RadarPerson,
  type View,
} from "./layout";
import Avatar, { SELF_AVATAR } from "./Avatar";
import styles from "./Radar.module.css";

export type { RadarPerson };

interface Props {
  people: RadarPerson[];
  /** 点头像时回调（打开人格卡） */
  onOpenProfile?: (id: string) => void;
  /** 中心「我」的头像；不传用 self.webp */
  selfAvatarUrl?: string | null;
  className?: string;
}

/**
 * 相遇雷达。
 *
 * 性能取舍：拖拽/缩放**不走 React state**，而是用 ref 直接改 canvas 的
 * transform。否则一次拖拽会触发几十次重渲染，每次都要重排 16 个节点。
 * React 只在布局（people 变化）时重算，交互是纯 DOM 操作。
 */
export default function Radar({ people, onOpenProfile, selfAvatarUrl, className }: Props) {
  const layout = useMemo(() => computeLayout(people), [people]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  /** 当前取景。放 ref 里避免每次拖拽都重渲染。 */
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const pressingRef = useRef(false);
  const capturedRef = useRef(false);
  const dragDistanceRef = useRef(0);
  const downAtRef = useRef({ x: 0, y: 0 });
  const startViewRef = useRef({ x: 0, y: 0 });

  const [avatarErrors, setAvatarErrors] = useState<Record<string, true>>({});

  const applyView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const v = viewRef.current;
    canvas.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
  }, []);

  /** 三种取景：默认（自适应）/ 全览 / 聚焦我 */
  const centreView = useCallback(
    (mode: "fit" | "me" | "auto") => {
      const vp = viewportRef.current;
      if (!vp || !layout) return;
      /* 用视口自身的宽高，不掺入它在页面中的位置——
         否则雷达位于页面下方时，中心会被推出视口。 */
      const vw = vp.clientWidth || 900;
      const vh = vp.clientHeight || 620;
      viewRef.current = computeView(mode, layout, vw, vh);
      applyView();
    },
    [layout, applyView],
  );

  /* 首次取景用「自适应」：尽可能多装人，同时保证头像读得清。
     想看全部点「全览」，想细看自己点「聚焦我」。 */
  useEffect(() => {
    if (!layout) return;
    const raf = requestAnimationFrame(() => centreView("auto"));
    return () => cancelAnimationFrame(raf);
  }, [layout, centreView]);

  /* 视口尺寸变化时重新取景（仅当尺寸真正变化） */
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !layout) return;
    let last = { w: vp.clientWidth, h: vp.clientHeight };
    const ro = new ResizeObserver(() => {
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (!w || !h || (w === last.w && h === last.h)) return;
      last = { w, h };
      centreView("auto");
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [layout, centreView]);

  /* ── 拖拽 ──────────────────────────────────────────────────────────────
     三个必须遵守的约束（原型阶段全部踩过）：
     1. 不用「跨交互累积的最大位移」判断是否拖拽——它会永久大于阈值，
        之后所有点击都被吞掉。每次 pointerdown 归零。
     2. 不用 pointerleave 结束拖拽——setPointerCapture 期间指针离开视口
        也会触发它。只认 pointerup / pointercancel。
     3. ★ 不在 pointerdown 就无条件 setPointerCapture ★
        指针一旦被捕获，后续 pointerup / click 的 target 会被重定向到
        捕获元素，点头像永远命不中。必须等位移超过阈值、确认是拖拽后再捕获。
  */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pressingRef.current = true;
    capturedRef.current = false;
    dragDistanceRef.current = 0;
    downAtRef.current = { x: e.clientX, y: e.clientY };
    startViewRef.current = { x: viewRef.current.x, y: viewRef.current.y };
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!pressingRef.current) return;
      const dx = e.clientX - downAtRef.current.x;
      const dy = e.clientY - downAtRef.current.y;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= DRAG_THRESHOLD) return; // 未达阈值：保留点击语义，不移动

      if (!capturedRef.current) {
        capturedRef.current = true;
        dragDistanceRef.current = dist;
        const vp = viewportRef.current;
        if (vp) {
          vp.classList.add(styles.dragging);
          try {
            vp.setPointerCapture(e.pointerId);
          } catch {
            /* 某些环境不支持，忽略 */
          }
        }
      }
      dragDistanceRef.current = Math.max(dragDistanceRef.current, dist);
      viewRef.current = {
        ...viewRef.current,
        x: startViewRef.current.x + dx,
        y: startViewRef.current.y + dy,
      };
      applyView();
    },
    [applyView],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    const vp = viewportRef.current;
    if (vp) {
      vp.classList.remove(styles.dragging);
      if (capturedRef.current) {
        try {
          vp.releasePointerCapture(e.pointerId);
        } catch {
          /* 忽略 */
        }
      }
    }
    capturedRef.current = false;
  }, []);

  /* 滚轮缩放：以光标位置为锚点 */
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      viewRef.current = zoomAt(
        viewRef.current,
        factor,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      applyView();
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [applyView]);

  /* 点头像打开人格卡。
     拖拽确实会捕获指针（click.target 会变成 viewport），
     所以不能只靠 e.target：命中判定加坐标反查兜底。 */
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const wasDrag = dragDistanceRef.current > DRAG_THRESHOLD;
      dragDistanceRef.current = 0; // 本次交互结束，立刻归零
      if (wasDrag) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      const target = e.target as HTMLElement | null;
      let hit = target?.closest?.('[data-action="profile"]') as HTMLElement | null;
      if (!hit && typeof document.elementFromPoint === "function") {
        const under = document.elementFromPoint(e.clientX, e.clientY);
        hit = (under?.closest?.('[data-action="profile"]') as HTMLElement | null) ?? null;
      }
      if (!hit) return;
      const id = hit.getAttribute("data-id");
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      onOpenProfile?.(id);
    },
    [onOpenProfile],
  );

  /** 控件缩放：以视口中心为锚点 */
  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      viewRef.current = zoomAt(viewRef.current, factor, rect.width / 2, rect.height / 2);
      applyView();
    },
    [applyView],
  );

  /* 空态 */
  if (!layout) {
    return (
      <div className={className}>
        <div className={styles.empty}>
          <div className={styles.emptyBig}>雷达上还没有人</div>
          <p>试试清空筛选，或换一个关键词——也可能是 TA 还没有开放 Agent 对话。</p>
        </div>
      </div>
    );
  }

  const { stageW, stageH, centre, nodes, rings, dots, maxSim, minSim } = layout;

  return (
    <div className={className} ref={rootRef}>
      <div
        className={styles.viewport}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onClick}
      >
        <div
          className={styles.canvas}
          ref={canvasRef}
          style={{ width: stageW, height: stageH }}
        >
          {/* 底层 SVG：轨道环 / 连线 / 装饰点 */}
          <svg
            className={styles.svg}
            viewBox={`0 0 ${stageW} ${stageH}`}
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="zy-radar-line" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#e2664f" stopOpacity="0.55" />
                <stop offset="1" stopColor="#ffc94d" stopOpacity="0.5" />
              </linearGradient>
            </defs>

            {rings.map((ring, i) => (
              <circle
                /* key 必须带下标：人少时多道环会落在同一半径
                   （rankRadius(0) 反复出现），只按半径+相似度会撞 key */
                key={`ring-${i}-${ring.r}-${ring.sim}`}
                cx={centre.x}
                cy={centre.y}
                r={ring.r}
                fill="none"
                className={ring.inner ? styles.ringInner : styles.ring}
              />
            ))}

            {dots.map((d, i) => (
              <circle
                key={`dot-${i}`}
                cx={centre.x + d.x}
                cy={centre.y + d.y}
                r={d.r}
                fill={d.fill}
                opacity={d.opacity}
                stroke="none"
              />
            ))}

            {nodes.map((n) => (
              <line
                key={`link-${n.person.id}`}
                x1={centre.x}
                y1={centre.y}
                x2={centre.x + n.x}
                y2={centre.y + n.y}
                className={styles.link}
                strokeDasharray="4 5"
              />
            ))}
          </svg>

          {/* 轨道环上的相似度标注：放在左侧中部，避开右上角控件与其他节点 */}
          {rings.map((ring, i) =>
            ring.inner ? null : (
              <div
                key={`tag-${i}-${ring.sim}`}
                className={styles.ringTag}
                style={{
                  left: Math.round(centre.x + Math.cos((188 * Math.PI) / 180) * ring.r),
                  top: Math.round(centre.y + Math.sin((188 * Math.PI) / 180) * ring.r),
                }}
              >
                ≈ {ring.sim}%
              </div>
            ),
          )}

          {/* 中心「我」 */}
          <div
            className={styles.me}
            style={{ left: centre.x, top: centre.y }}
          >
            <span className={styles.meRing} aria-hidden="true" />
            <span className={styles.meAvatar}>
              <Avatar
                avatarUrl={selfAvatarUrl}
                seed="self"
                alt="我"
                width={88}
                height={88}
              />
            </span>
            <span className={styles.meLabel}>我</span>
          </div>

          {/* 人物节点：螺旋布局已保证互不重叠，直接落位 */}
          {nodes.map((n) => {
            const remoteFailed = avatarErrors[n.person.id];
            const url = remoteFailed
              ? undefined
              : n.person.avatarUrl?.trim() || undefined;
            return (
              <div
                key={n.person.id}
                className={`${styles.node} ${n.right ? styles.sideRight : styles.sideLeft}`}
                style={{ left: centre.x + n.x, top: centre.y + n.y }}
                data-id={n.person.id}
              >
                <button
                  type="button"
                  data-action="profile"
                  data-id={n.person.id}
                  className={`${styles.avatar} ${n.isTop ? styles.avatarTop : ""}`}
                  aria-label={`查看 ${n.person.title} 的人格卡`}
                >
                  <Avatar
                    avatarUrl={url}
                    seed={n.person.id}
                    width={84}
                    height={84}
                    onRemoteError={() =>
                      setAvatarErrors((prev) => ({ ...prev, [n.person.id]: true }))
                    }
                  />
                  {n.isTop ? (
                    <span className={styles.topBadge} title="当前相似度最高">
                      ✓
                    </span>
                  ) : null}
                </button>
                <span className={styles.card}>
                  <b className={styles.name}>{n.person.title}</b>
                  <span className={styles.sub}>
                    <em className={styles.type}>{n.person.type ?? ""}</em>
                    <em className={styles.sim}>{n.sim}%</em>
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        {/* 右上角控件 */}
        <div className={styles.tools}>
          <button type="button" onClick={() => zoomBy(1.18)} aria-label="放大">
            +
          </button>
          <button type="button" onClick={() => zoomBy(1 / 1.18)} aria-label="缩小">
            −
          </button>
          <button
            type="button"
            className={styles.wide}
            onClick={() => centreView("fit")}
            aria-label="全览"
          >
            全览
          </button>
          <button
            type="button"
            className={styles.wide}
            onClick={() => centreView("me")}
            aria-label="聚焦到我"
          >
            聚焦我
          </button>
          <span className={styles.hint}>拖动平移 · 滚轮缩放 · 点头像看人格卡</span>
        </div>

        {/* 左下角统计 */}
        <div className={styles.stats}>
          <span>
            雷达上 <b>{nodes.length}</b> 位
          </span>
          <span>
            最近 <b>{maxSim}%</b>
          </span>
          <span>
            最远 <b>{minSim}%</b>
          </span>
        </div>
      </div>
    </div>
  );
}
