"use client";

import {
  VALUE_LABEL,
  VALUE_KEYS,
  type SourceFacet,
} from "@/lib/persona/fusion";
import styles from "./SourceFacets.module.css";

/**
 * 「每个数据源各自的人格解析」展示块。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「你把之前对知乎、微信等注入的数据分别进行简单介绍解析的模块搞丢了。
 *     网站应该在获取到某个源数据后的第一时间就可以解析出用户在微信或是 QQ
 *     或是知乎或是 SBTI 等等的人格特征，然后在『我的人格』页中展示出来。」
 *
 * 确实丢过：早先只有"整源蒸馏"一步，分源解析既没做也没展示。
 * 现在每个源都有一份 facet（六维 + 结论 + 依据条数），在这里逐源列出。
 *
 * 与「综合画像」的关系要讲清楚，所以块首有一句话说明：
 *   下面是**分源**看；上面那块是**融合**后的结论。
 */

const SOURCE_NAME: Record<string, string> = {
  zhihu: "知乎",
  wechat: "微信",
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
  profile: "已有六维",
};

export default function SourceFacets({
  facets,
  /** 每个源解析出的兴趣方向（可选） */
  interests,
}: {
  facets: SourceFacet[];
  interests?: Record<string, string[]>;
}) {
  if (facets.length === 0) {
    return (
      <p className={styles.empty}>
        还没有可分源解析的数据。注入任意一个数据源（知乎 / 微信 / QQ / 飞书 / 钉钉）后，
        这里会按源分别给出解析结果。
      </p>
    );
  }

  return (
    <div className={styles.wrap} data-source-facets="1">
      <p className={styles.lead}>
        每个数据源<b>单独</b>解析出来的特征。上方「综合画像」是这些源融合后的结论 ——
        两者看的是同一批数据，但角度不同。
      </p>

      <div className={styles.grid}>
        {facets.map((f) => {
          const name = SOURCE_NAME[f.source] ?? f.label;
          const dims = VALUE_KEYS.filter((k) => typeof f.values[k] === "number");
          const top = (interests?.[f.source] ?? []).slice(0, 4);

          return (
            <article key={f.source} className={styles.card} data-facet-source={f.source}>
              <header className={styles.head}>
                <h4 className={styles.name}>{name}</h4>
                <span className={styles.count}>
                  {f.itemCount > 0 ? `${f.itemCount} 条依据` : "无逐条依据"}
                </span>
              </header>

              <p className={styles.summary}>{f.summary}</p>

              {/* 该源的六维（只画算得出来的那些，缺的不编） */}
              {dims.length ? (
                <div className={styles.dims}>
                  {dims.map((k) => (
                    <div key={k} className={styles.dimRow}>
                      <span className={styles.dimLabel}>{VALUE_LABEL[k] ?? k}</span>
                      <span className="track">
                        <i
                          className="trackFill"
                          style={{ width: `${Math.round((f.values[k] ?? 0) * 100)}%` }}
                        />
                      </span>
                      <span className={`num ${styles.dimVal}`}>
                        {Math.round((f.values[k] ?? 0) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className={styles.noDim}>这个源还不足以推断维度。</p>
              )}

              {top.length ? (
                <p className={styles.topics}>
                  关注方向：
                  {top.map((t) => (
                    <span key={t} className={styles.topic}>
                      {t}
                    </span>
                  ))}
                </p>
              ) : null}

              {/* 哪些维度这个源给不出，如实说明（不让人以为漏了） */}
              {dims.length < VALUE_KEYS.length ? (
                <p className={styles.missing}>
                  未覆盖：
                  {VALUE_KEYS.filter((k) => typeof f.values[k] !== "number")
                    .map((k) => VALUE_LABEL[k] ?? k)
                    .join("、")}
                  {/* 说清"为什么给不出"。否则用户看到缺维会以为是 bug
                      —— 实际是数据源本身只给标题（如知乎开放平台），
                      依赖文本长度的维度无从计算。 */}
                  {f.titleOnly
                    ? "（该源只提供标题、没有正文，表达密度 / 长文比例 / 稳定输出需要正文才能算）"
                    : ""}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
