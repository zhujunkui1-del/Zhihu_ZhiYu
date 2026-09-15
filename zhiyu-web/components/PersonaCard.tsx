"use client";

import PersonaRadar from "@/components/PersonaRadar";
import { toDisplayPercent, toDisplayPercentText } from "@/lib/score";
import { zhihuAbsoluteUrl, zhihuProfileUrl } from "@/lib/zhihu/links";
import {
  SOURCE_LABEL,
  SOURCE_SUB,
  VALUE_LABEL,
  EVIDENCE_SOURCE_LABEL,
  type PersonaCardData,
} from "@/lib/persona-card";
import styles from "./PersonaCard.module.css";

/**
 * 人格卡内容（纯展示，无副作用）。
 *
 * 抽出来是为了让**弹窗**与**人格页**显示同一份东西：
 * 需求要求首页/发现页「在原界面就地以弹窗打开对方的人格卡」，
 * 如果弹窗另写一套，两处迟早会显示不一致（数字、字段、文案都会飘）。
 */

function TagRow({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className={styles.traitRow}>
      <span className={styles.traitLabel}>{title}</span>
      {items.length ? (
        <span className={styles.tagWrap}>
          {items.map((t) => (
            <span key={t} className={styles.tag}>
              {t}
            </span>
          ))}
        </span>
      ) : (
        <span className={styles.traitEmpty}>{empty}</span>
      )}
    </div>
  );
}

export default function PersonaCard({
  data,
  /** 打开弹窗时给出紧凑版：不显示"六源明细"之外的大段留白 */
  compact = false,
}: {
  data: PersonaCardData;
  compact?: boolean;
}) {
  const radarAxes = data.axes.map((a) => ({ label: a.label, value: a.value }));
  const hasAxes = data.axes.some((a) => a.value != null);
  const valueEntries = Object.entries(data.traits.values);
  const evidenceBySource = data.evidence.reduce<Record<string, typeof data.evidence>>(
    (acc, e) => {
      (acc[e.source] ??= []).push(e);
      return acc;
    },
    {},
  );

  return (
    <div className={styles.card} data-persona-card={data.id}>
      {/* 身份行 */}
      <div className={styles.head}>
        {data.identity.avatarUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className={styles.avatar} src={data.identity.avatarUrl} alt="" />
        ) : (
          <span className={styles.avatarFallback} aria-hidden="true" />
        )}
        <div className={styles.headText}>
          {/**
           * 昵称：有知乎 url_token 时点它直接打开 TA 的知乎主页
           * （`https://www.zhihu.com/people/<url_token>`）。
           * 没有 token 就保持纯文本 —— 不给一个点进去 404 的链接。
           */}
          {zhihuProfileUrl(data.zhihuUrlToken) ? (
            <h3 className={styles.name}>
              <a
                /* 昵称链接外观**不做下划线**（看起来仍是标题），
                   只加一个很轻的 ↗ 提示可以点 */
                style={{ color: "inherit", textDecoration: "none" }}
                href={zhihuProfileUrl(data.zhihuUrlToken) as string}
                target="_blank"
                rel="noreferrer noopener"
                data-zhihu-profile={data.zhihuUrlToken}
                title="打开 TA 的知乎主页"
              >
                {data.displayName}
                <span className="meta" style={{ marginLeft: 6, fontSize: 12 }}>
                  ↗
                </span>
              </a>
            </h3>
          ) : (
            <h3 className={styles.name}>{data.displayName}</h3>
          )}
          <p className={styles.metaLine}>
            {[
              data.region.province && data.region.city
                ? `${data.region.province} · ${data.region.city}`
                : data.region.province,
              data.identity.headline,
            ]
              .filter(Boolean)
              .join("　·　") || "暂无公开资料"}
          </p>
          <p className={styles.statLine}>
            {/* 完整度收进 [1,99]：它是四类来源覆盖率的加权推断，
                0% / 100% 都是绝对结论，而旁边的 "x/6"、"x/4" 已经给足了精确信息 */}
            人格完整度 <b data-card-completeness="1">{toDisplayPercentText(data.completeness / 100)}</b>
            <span className={styles.dot}>·</span>
            已注入数据源 <b>{data.sources.filter((s) => s.injected).length}/6</b>
            <span className={styles.dot}>·</span>
            已覆盖来源类别 <b>{data.coveredCategories}/4</b>
          </p>
        </div>
      </div>

      {data.bio ? <p className={styles.bio}>{data.bio}</p> : null}

      {/* 六源注入状态 */}
      <p className={styles.eyebrow}>六源注入状态</p>
      <ul className={styles.srcList}>
        {data.sources.map((s) => (
          <li key={s.type} className={s.injected ? styles.srcOn : styles.srcOff}>
            <span className={styles.srcName}>
              {SOURCE_LABEL[s.type] ?? s.label}
              <small>{SOURCE_SUB[s.type] ?? ""}</small>
            </span>
            <span className={styles.srcState}>{s.injected ? "已注入" : "未注入"}</span>
          </li>
        ))}
      </ul>

      {/* 五维画像 */}
      <p className={styles.eyebrow}>
        综合画像 · 融合特征
        {data.axesSource === "observed" ? (
          /* SBTI 已参与融合（产品要求），所以这里要区分"纯观察"与"掺了自评"。
             笼统写"非本人自评"在掺了自评之后就是假话。 */
          <span className={styles.sourceNote} data-axes-source="observed">
            {data.axesIncludesSelfReport
              ? "由公开内容观察推断（含 SBTI 自评折算）"
              : "由公开内容观察推断（非本人自评）"}
          </span>
        ) : data.axesSource === "self-report" ? (
          <span className={styles.sourceNote} data-axes-source="self-report">
            来自本人 SBTI 自评（暂无观察数据）
          </span>
        ) : null}
      </p>
      <div className={compact ? styles.fusionCompact : styles.fusion}>
        <PersonaRadar axes={radarAxes} emptyTip="等待蒸馏" />
        <div className={styles.fusionSide}>
          {data.sbti?.type ? (
            <div className={styles.typeBadge}>
              <span className={styles.typeName}>{data.sbti.typeTitle ?? data.sbti.type}</span>
              {typeof data.sbti.similarity === "number" && data.sbti.similarity > 0 ? (
                <span className="meta">
                  匹配度 {toDisplayPercentText(data.sbti.similarity)}
                </span>
              ) : null}
            </div>
          ) : (
            <p className={styles.hint}>
              {hasAxes
                ? "五维来自已注入的数据源。"
                : "还没有可用的五维数据 —— 这个人格还没有蒸馏过。"}
            </p>
          )}

          <div className={styles.axisList}>
            {data.axes.map((a) => (
              <div key={a.key} className={styles.axisRow}>
                <span className={styles.axisLabel}>{a.label}</span>
                <span className="track">
                  <i
                    className="trackFill"
                    style={{ width: `${toDisplayPercent(a.value) ?? 0}%` }}
                  />
                </span>
                <span className={`num ${styles.axisVal}`}>
                  {toDisplayPercentText(a.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 结构化特征 */}
      <p className={styles.eyebrow}>结构化特征</p>
      <div className={styles.traits}>
        <TagRow title="兴趣" items={data.traits.interests} empty="未提取到" />
        <TagRow title="常聊话题" items={data.traits.topics} empty="未提取到" />
        <TagRow
          title="表达习惯"
          items={data.traits.communicationStyle}
          empty="未提取到"
        />
        <TagRow title="思维方式" items={data.traits.thinkingStyle} empty="未提取到" />
        <TagRow title="社交风格" items={data.traits.socialStyle} empty="未提取到" />
      </div>

      {valueEntries.length ? (
        <>
          <p className={styles.eyebrow}>价值观六维</p>
          <div className={styles.valueGrid}>
            {valueEntries.map(([k, v]) => (
              <div key={k} className={styles.valueRow}>
                <span className={styles.valueLabel}>{VALUE_LABEL[k] ?? k}</span>
                <span className="track">
                  <i className="trackFill" style={{ width: `${toDisplayPercent(v) ?? 0}%` }} />
                </span>
                <span className={`num ${styles.valueVal}`}>{toDisplayPercentText(v)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* 证据：每条结论凭什么 */}
      <p className={styles.eyebrow}>
        结论溯源
        <span className={styles.eyebrowNote}>
          共 {data.evidence.length} 条证据 · 凭什么这么判断
        </span>
      </p>
      {data.evidence.length === 0 ? (
        <p className={styles.hint}>
          还没有任何证据 —— 这个人格尚未注入数据源，因此没有可展示的溯源。
        </p>
      ) : (
        <div className={styles.evidence}>
          {Object.entries(evidenceBySource).map(([source, list]) => (
            <div key={source} className={styles.evGroup} data-evidence-source={source}>
              <p className={styles.evGroupHead}>
                {EVIDENCE_SOURCE_LABEL[source] ?? source}
                <span className={styles.evCount}>{list.length}</span>
              </p>
              <ul className={styles.evList}>
                {list.slice(0, compact ? 12 : 40).map((e) => (
                  <li key={e.id} className={styles.evItem}>
                    <span className={styles.evTrait}>{e.trait}</span>
                    <span className={styles.evNote}>{e.note ?? "(无说明)"}</span>
                    {/**
                     * ⚠️ 链接必须过 `zhihuAbsoluteUrl`：库里存的是**相对路径**
                     * （`/pins/1533…`），直接塞进 href 会变成
                     * `https://www.zhiyuapp.site/pins/…`（实测打不开）。
                     * 取不到合法地址时**不渲染链接**，不给坏链。
                     */}
                    {zhihuAbsoluteUrl(e.url) ? (
                      <a
                        className={styles.evLink}
                        href={zhihuAbsoluteUrl(e.url) as string}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        原文 ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
