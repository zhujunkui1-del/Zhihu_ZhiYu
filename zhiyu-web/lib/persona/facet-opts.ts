/**
 * 分源解析口径的**唯一事实来源**。
 *
 * ── 为什么必须收敛到一张表 ────────────────────────────────────────────────
 * `facetFromContents(source, label, contents, opts)` 的行为完全取决于 opts：
 *   · `profile: "im"` —— 聊天/文档口径（只算量得准的三维）
 *   · `noHeat`        —— 该源没有互动量，社交连接强度**留空**而不是按 0 算
 *   · `titleOnly`     —— 该源只有标题没有正文，依赖文本长度的三维留空
 *
 * 而算 facet 的地方**有六个**（导入、飞书/钉钉同步、知乎同步、蒸馏、两个离线脚本）。
 * 之前每个调用点自己传 opts，蒸馏路径（`lib/persona/distill.ts`）就忘了传，
 * 于是同一批微信聊天在导入时算出「创造表达/稳定安全/独立自主」，
 * 一进蒸馏被重算成「社交连接 1%」+「（只有标题、无正文）」——
 * 用户看到的正是这个（实测：201 条聊天被判定成"只有标题"）。
 *
 * 收敛成一张表之后，"两条路径口径不一致"这类 bug 在结构上不可能再发生；
 * `scripts/test-facet-opts.mjs` 会直接断言两条路径算出的 facet 逐字段相等。
 */

export interface FacetOptions {
  /** 只有标题、没有正文（知乎开放平台只返回标题） */
  titleOnly?: boolean;
  /** 没有互动量这类连接强度信号（私域聊天 / 工作文档） */
  noHeat?: boolean;
  /** 内容形态：长文（默认）| 聊天与文档 */
  profile?: "long-form" | "im";
}

/**
 * 该用哪套口径。
 *
 * 依据是**这个源的数据长什么样**，不是"它属于哪个平台"：
 *   · zhihu        —— 开放平台 contents 只给标题 + 点赞数 → titleOnly
 *   · wechat / qq  —— 私聊导出：短文本、无互动量 → im + noHeat
 *   · feishu / dingtalk —— 消息与文档：同上（钉钉还没有历史消息接口，只有文档）
 *   · sbti         —— 问卷，没有内容可解析，**不走这条路径**
 *                     （它由 `facetFromSbti` 从 `personality.sbti` 现算）
 *   · 其它/未知    —— 保守用默认长文口径，但**不假装有互动量**
 */
export function facetOptionsFor(source: string): FacetOptions {
  switch (source) {
    case "zhihu":
      return { titleOnly: true };
    case "wechat":
    case "qq":
    case "feishu":
    case "dingtalk":
      return { noHeat: true, profile: "im" };
    default:
      /* 未知来源：宁可少算几维，也不要拿"量不到"当"量出来很低" */
      return { noHeat: true };
  }
}

/** sbti 的 facet 不走内容解析（由问卷维度现算），这里显式排除，避免调用方猜 */
export function isContentFacetSource(source: string): boolean {
  return source !== "sbti" && source !== "profile" && source !== "distill";
}

/**
 * 重算**存量证据**时用的口径：正文有没有，交给数据自己判。
 *
 * 为什么不能沿用 `facetOptionsFor`：那张表写的是**写入时的契约**
 * （应用内知乎同步只拿到标题 → titleOnly），但库里同一张 `facets:zhihu`
 * 可能来自两条路径：
 *   · 应用内同步 —— note 是标题
 *   · `backfill-real-zhihu.mjs` —— note 是 `title + text` 完整正文
 * 如果重算时一律强加 `titleOnly`，那 26 位回填过的真实创作者会**凭空丢掉
 * 学习成长/创造表达/稳定安全 三维**（实测 dry-run：5 维 → 2 维），
 * 明明库里有正文却算不出来，等于把已有信息扔掉。
 *
 * `facetFromContents` 里本来就有数据驱动的兜底（短内容占比 ≥0.8 → 判定只拿到标题），
 * 所以这里把 `titleOnly` 去掉、其余（noHeat / profile）保留即可。
 */
export function facetOptionsForStored(source: string): FacetOptions {
  return { noHeat: facetOptionsFor(source).noHeat, profile: facetOptionsFor(source).profile };
}
