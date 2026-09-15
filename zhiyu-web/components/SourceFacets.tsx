"use client";

import { VALUE_LABEL, VALUE_KEYS } from "@/lib/persona/fusion";
import { BEHAVIOR_LABEL, behaviorPercent, behaviorPercentText, type BehaviorFacet } from "@/lib/persona/behavior";
import { toDisplayPercent, toDisplayPercentText } from "@/lib/score";
import styles from "./SourceFacets.module.css";

/**
 * 「每个数据源各自的人格解析」展示块。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「你把之前对知乎、微信等注入的数据分别进行简单介绍解析的模块搞丢了。
 *     网站应该在获取到某个源数据后的第一时间就可以解析出用户在微信或是 QQ
 *     或是知乎或是 SBTI 等等的人格特征，然后在『我的人格』页中展示出来。」
 *   「现在，马上把 SBTI 的结果也列为人格数据里面，也要进行蒸馏。」
 *
 * 确实丢过：早先只有"整源蒸馏"一步，分源解析既没做也没展示。
 * 现在每个源都有一份 facet（六维 + 结论 + 依据条数），在这里逐源列出，
 * **SBTI 也在其中**（用户明确要求它算人格数据并参与蒸馏）。
 *
 * ⚠️ 但 SBTI 是**本人自报**，其余是观察到的行为 —— 卡片上照实打标
 * （自评 / 观察），块首也说明"综合画像里可能含自评成分"。
 * 让自评参与，但不让自评冒充观察结论。
 */

const SOURCE_NAME: Record<string, string> = {
  zhihu: "知乎",
  wechat: "微信",
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
  sbti: "SBTI",
  profile: "已有六维",
};

/**
 * 本组件拿到的 facet 视图。
 *
 * 自成一型（而不是直接复用 `fusion.SourceFacet`）是因为这里多了一个
 * `selfReport`：它由 `source-facets.ts` 按源的**性质**判定后注入，
 * 组件只负责显示，不该自己去猜哪个源是自评。
 */
export interface FacetView {
  source: string;
  label: string;
  summary: string;
  itemCount: number;
  values: Record<string, number>;
  /** 该源只有标题、没有正文（依赖文本长度的维度因此缺失） */
  titleOnly: boolean;
  /** 缺维的人话原因（解析层给出，组件照原样念） */
  partialReason: string | null;
  /** 该源是**本人自评**（SBTI），不是观察数据 */
  selfReport: boolean;
  /**
   * 这份解析被数据体检判定"没有区分度"（各维落在同一档），
   * 因此**没有计入**综合画像 —— 界面要标出来，否则用户会以为它参与了。
   */
  skippedFromFusion?: boolean;
}

export default function SourceFacets({
  facets,
  /** 每个源解析出的兴趣方向（可选） */
  interests,
  /** 每个源的**可数行为变量**（有它就用它画条，比价值观六维实在得多） */
  behavior,
}: {
  facets: FacetView[];
  interests?: Record<string, string[]>;
  behavior?: BehaviorFacet[];
}) {
  if (facets.length === 0) {
    return (
      <p className={styles.empty}>
        还没有可分源解析的数据。注入任意一个数据源（知乎 / 微信 / QQ / 飞书 / 钉钉），
        或完成一次 SBTI 自评，这里就会按源分别给出解析结果。
      </p>
    );
  }

  const hasSelfReport = facets.some((f) => f.selfReport);

  return (
    <div className={styles.wrap} data-source-facets="1">
      <p className={styles.lead}>
        每个数据源<b>单独</b>解析出来的特征。上方「综合画像」是这些源融合后的结论 ——
        两者看的是同一批数据，但角度不同。
        {hasSelfReport ? (
          <span className={styles.selfNote} data-facet-self-note="1">
            其中 <b>SBTI 是本人自报</b>（你眼中的自己），其余是观察到的行为；
            融合结论里因此含自评成分，已逐源标注。
          </span>
        ) : null}
      </p>

      <div className={styles.grid}>
        {facets.map((f) => {
          const name = SOURCE_NAME[f.source] ?? f.label;
          const dims = VALUE_KEYS.filter((k) => typeof f.values[k] === "number");
          const top = (interests?.[f.source] ?? []).slice(0, 4);
          /**
           * 优先画**行为变量**（这个源里数出来的：主动发起率/回应速度/活跃天…），
           * 没有再退回价值观六维。SBTI 没有行为数据，所以它照旧画六维自评。
           */
          const b = behavior?.find((x) => x.source === f.source);
          const behaviorRows = b
            ? (Object.keys(BEHAVIOR_LABEL) as (keyof typeof BEHAVIOR_LABEL)[])
                .filter((k) => typeof b.variables[k] === "number")
                .map((k) => ({
                  key: k as string,
                  label: BEHAVIOR_LABEL[k],
                  pct: behaviorPercent(b.variables[k]) ?? 0,
                  text: behaviorPercentText(b.variables[k]),
                  how: b.evidence[k] ?? "",
                }))
            : [];

          return (
            <article key={f.source} className={styles.card} data-facet-source={f.source}>
              <header className={styles.head}>
                <h4 className={styles.name}>{name}</h4>
                <span
                  className={f.selfReport ? styles.tagSelf : styles.tagObserved}
                  data-facet-kind={f.selfReport ? "self-report" : "observed"}
                >
                  {f.selfReport ? "本人自评" : "观察数据"}
                </span>
                <span className={styles.count}>
                  {/* 问卷的"依据"是维度，不是内容条数 —— 写"15 条依据"会让人
                      以为有 15 条内容。措辞按源的性质区分。 */}
                  {f.itemCount > 0
                    ? f.selfReport
                      ? `${f.itemCount} 个维度`
                      : `${f.itemCount} 条依据`
                    : "无逐条依据"}
                </span>
                {/* 这份解析被体检判定"没有区分度"（每题都答了同一档）→ 未计入综合画像 */}
                {f.skippedFromFusion ? (
                  <span className={styles.count} data-facet-skipped="1">
                    · 未计入综合画像
                  </span>
                ) : null}
              </header>

              <p className={styles.summary}>{f.summary}</p>

              {/* 优先画**行为变量**（这个源里直接数出来的），没有才退回价值观六维。
                  六维靠文本形态反推，实测在真实数据上常常一根都算不出来；
                  行为变量是数出来的，几乎每个源都能给出几条。 */}
              {behaviorRows.length ? (
                <div className={styles.dims} data-facet-behavior="1">
                  {behaviorRows.map((r) => (
                    <div key={r.key} className={styles.dimRow}>
                      <span className={styles.dimLabel}>{r.label}</span>
                      <span className="track">
                        <i className="trackFill" style={{ width: `${r.pct}%` }} />
                      </span>
                      <span className={`num ${styles.dimVal}`}>{r.text}</span>
                    </div>
                  ))}
                </div>
              ) : dims.length ? (
                <div className={styles.dims}>
                  {dims.map((k) => (
                    <div key={k} className={styles.dimRow}>
                      <span className={styles.dimLabel}>{VALUE_LABEL[k] ?? k}</span>
                      <span className="track">
                        <i
                          className="trackFill"
                          style={{ width: `${toDisplayPercent(f.values[k]) ?? 0}%` }}
                        />
                      </span>
                      <span className={`num ${styles.dimVal}`}>
                        {toDisplayPercentText(f.values[k])}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* 事实行：不转百分比，直接给数字（转了就贴边，实测"互动平衡"是 94%） */}
              {b?.facts.length ? (
                <p className={styles.topics}>
                  {b.facts.map((x) => (
                    <span key={x.key} className={styles.topic}>
                      {x.label} {x.display}
                    </span>
                  ))}
                </p>
              ) : null}

              {/* 一个能解释的都没有时，才说这一句（不解释"我们做不到什么"） */}
              {!behaviorRows.length && !dims.length && !b?.facts.length ? (
                <p className={styles.noDim}>这个源还不足以推断维度。</p>
              ) : null}

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

              {/* ⚠️ 这里以前有一行「未覆盖：…（该源只提供标题、没有正文，表达密度…）」。
                  用户明确要求删掉，理由成立：
                    · 那是**讲自己做不到什么**的文字，用户不看，还降低产品观感；
                    · 缺维本来就该由"算不出来就不画那根条"来表达，不需要解释；
                    · 原因（partialReason）仍留在数据层，诊断脚本与解析层照旧用它。 */}
            </article>
          );
        })}
      </div>
    </div>
  );
}
