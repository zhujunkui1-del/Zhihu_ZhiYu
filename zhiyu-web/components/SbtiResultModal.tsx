"use client";

import { useEffect } from "react";
import { toDisplayPercentText } from "@/lib/score";
import styles from "./SbtiResultModal.module.css";

/**
 * SBTI 测试结果弹窗。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「在『我的人格』页下测试 SBTI，测试完后并没有跳出『SBTI 测试结果』的弹窗
 *     展示。参考 sbti.unun.dev，最后会返回完整的测试结果解析；
 *     sbti-skill 里也有各种图片与解析。参考 SBTI测试结果.png，
 *     但同样遵循网站的美术风格，追加该弹窗。」
 *
 * 之前测完只显示了顶部一条「刚完成 SBTI：死者 · …」的细条，等于没有结果页。
 *
 * 内容编排照参考图：
 *   左：大头像 + 「你的人格类型是」+ 中文名 + 代码
 *   右上：主类型代码 + 匹配度徽章 + 维度命中
 *   中：一句话点睛（greeting）
 *   下：完整解读（description）
 *   附：15 维等级明细 —— 有据可查，不是只给个结论
 */

export interface SbtiResultData {
  /** 人格代码，如 MONK */
  code: string;
  /** 中文名，如 僧人 */
  title: string;
  /** 一句话点睛，如「没有那种世俗的欲望。」 */
  greeting: string | null;
  /** 完整解读 */
  description: string | null;
  /** 0~100；接近但未精确命中时由后台给出 */
  similarity: number;
  /** 是否未精确命中类型库（回退到最接近的） */
  fallback: boolean;
  /** 15 位等级码，如 HHL-LLH-LLM-MML-LHM */
  codesFormatted: string;
  /** 各维度得分（维度名 → { score, level }） */
  dimensions: Record<string, { score: number; level: string }>;
}

/** 维度前缀 → 类目名（与 lib/sbti/axes.ts 的 AXIS_GROUPS 一致） */
const DIM_GROUP: { prefix: string; label: string }[] = [
  { prefix: "S", label: "自我" },
  { prefix: "E", label: "情感" },
  { prefix: "A", label: "观念" },
  { prefix: "Ac", label: "行动" },
  { prefix: "So", label: "社交" },
];

/** 前缀匹配要先长后短，否则 "Ac1" 会被 "A" 抢走 */
function groupOfDim(key: string): { prefix: string; label: string } | null {
  return (
    [...DIM_GROUP].sort((a, b) => b.prefix.length - a.prefix.length).find((g) =>
      key.startsWith(g.prefix),
    ) ?? null
  );
}

/** 人格代码 → 头像路径。归一化只留字母数字：`WOC!` → `WOC.webp` */
function avatarOf(code: string): string {
  const norm = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `/assets/sbti/${norm}.webp`;
}

const LEVEL_LABEL: Record<string, string> = { L: "低", M: "中", H: "高" };

export default function SbtiResultModal({
  result,
  onClose,
}: {
  /** null 表示不显示 */
  result: SbtiResultData | null;
  onClose: () => void;
}) {
  const open = Boolean(result);

  /* Esc 关闭 + 锁背景滚动 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!result) return null;

  /* 按类目把维度分组展示 */
  const grouped = new Map<string, { key: string; score: number; level: string }[]>();
  for (const [key, v] of Object.entries(result.dimensions)) {
    const g = groupOfDim(key);
    const label = g?.label ?? "其他";
    const list = grouped.get(label) ?? [];
    list.push({ key, score: v.score, level: v.level });
    grouped.set(label, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div
      className={styles.wrap}
      data-sbti-result="1"
      role="dialog"
      aria-modal="true"
      aria-label={`SBTI 测试结果：${result.title}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />

      <div className={styles.dialog}>
        <button
          type="button"
          className={styles.close}
          aria-label="关闭测试结果"
          onClick={onClose}
        >
          ✕
        </button>

        {/* ① 结果主视觉 */}
        <div className={styles.hero}>
          <div className={styles.heroLeft}>
            <p className={styles.heroEyebrow}>你的人格类型是</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.avatar}
              src={avatarOf(result.code)}
              alt=""
              width={160}
              height={160}
            />
            <p className={styles.heroTitle} data-sbti-title="1">
              {result.title}
            </p>
            <p className={styles.heroCode}>{result.code}</p>
            {result.greeting ? (
              <p className={styles.heroGreeting}>{result.greeting}</p>
            ) : null}
          </div>

          <div className={styles.heroRight}>
            <p className={styles.sideLabel}>你的主类型</p>
            <p className={styles.sideCode}>{result.code}</p>

            <p className={styles.simBadge}>
              {result.fallback ? (
                <>未精确命中类型库 · 已回退到最接近的一种</>
              ) : (
                <>
                  {/* 展示值收进 [1,99]（产品要求界面上不出现 0% / 100%）。
                      这里的"匹配度"是 15 位等级码与类型库原型的**模式匹配率**，
                      满分在数学上可能出现，但宣称"100% 就是你"并不合适。 */}
                  匹配度{" "}
                  <b data-sbti-similarity="1">
                    {toDisplayPercentText(result.similarity / 100)}
                  </b>
                  <span className={styles.simDivider}>·</span>
                  维度命中{" "}
                  <b>
                    {Object.values(result.dimensions).filter((d) => d.level === "H").length}/
                    {Object.keys(result.dimensions).length}
                  </b>{" "}
                  维偏高
                </>
              )}
            </p>

            <p className={styles.dimIntro}>
              {result.fallback
                ? "你的维度组合比较少见，还没有完全对应的人格库条目 —— 下面是最接近的一种解读。"
                : "维度命中度较高，当前结果可视为你的第一人格画像。"}
            </p>

            {/* 15 维等级：结论的依据，逐维可查 */}
            <p className={styles.dimTitle}>15 维等级</p>
            <div className={styles.dimGrid}>
              {[...grouped.entries()].map(([label, list]) => (
                <div key={label} className={styles.dimGroup}>
                  <span className={styles.dimGroupName}>{label}</span>
                  <span className={styles.dimChips}>
                    {list.map((d) => (
                      <span
                        key={d.key}
                        /* data-* 供测试稳定定位：CSS Module 的类名含哈希，
                           而 `[class*="dimChip"]` 会同时匹配到外层 .dimChips 容器
                           （实测把 15 个维度数成 20 个） */
                        data-sbti-dim={d.key}
                        className={`${styles.dimChip} ${styles[`lv${d.level}`] ?? ""}`}
                        title={`${d.key}：${d.score} 分`}
                      >
                        {d.key}
                        <i>{LEVEL_LABEL[d.level] ?? d.level}</i>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>

            <p className={styles.codeLine}>
              等级码 <code>{result.codesFormatted}</code>
            </p>
          </div>
        </div>

        {/* ② 完整解读 */}
        {result.description ? (
          <div className={styles.reading}>
            <p className={styles.readingTitle}>该人格的简单解读</p>
            <p className={styles.readingBody}>{result.description}</p>
          </div>
        ) : null}

        <div className={styles.foot}>
          <button type="button" className="btn btnSecondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
