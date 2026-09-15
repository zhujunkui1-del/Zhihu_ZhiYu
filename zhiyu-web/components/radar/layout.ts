/**
 * 相遇雷达的布局数学。
 *
 * 抽成纯函数模块（不依赖 React / DOM），因为这段逻辑是雷达最核心、
 * 也最容易写错的部分，独立出来才能直接测。
 *
 * 关键设计：**排序螺旋（向日葵 / phyllotaxis）布局**
 *   半径 = RADIUS_MIN + SPACING × √rank      rank 按相似度降序
 *   角度 = rank × 黄金角 ≈ 137.5°
 *
 * 为什么不用「相似度线性映射半径 + 碰撞推挤」：
 *   早期实现这么做，16 人时仍有 7 组重叠。根因是想同时满足
 *   「半径严格映射分数」与「零重叠」，在给定画幅下**不可兼得**
 *   （分数集中在 69~88 区间时所有人被塞进同一圈，
 *     推挤只能改角度不能改半径）。
 * 改为排序螺旋后：半径随名次单调递增（「越近越同频」仍严格成立），
 * 黄金角保证任意两人不重叠（实测 0 组）。代价是半径不再精确等于分数值，
 * 但视觉上读起来一样。
 */

/**
 * 内圈起始半径。
 *
 * 原型的 170 太近：中心「我」视觉半径约 44px（88px 头像 + 外圈彩弧），
 * 节点半宽约 60px（头像 42 + 间距 + 标签卡），两者相加约 104px 才不打架，
 * 而 170 在「聚焦我」取景下仍会让**排名第一的人压在中心「我」身上**。
 * 取 240 留出余量，顺带让内圈轨道环不与中心重叠。
 */
export const RADIUS_MIN = 240;
/** 螺旋间距常数：相邻两人中心距 ≈ SPACING·(√(n+1)−√n) */
export const SPACING = 235;
/** 黄金角 */
export const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * 缩放下限。
 *
 * ★ 为什么必须够小：决定「全览」能不能真的看全 ★
 * 全览时要 k=(视口−16)/画幅，而画幅随人数增长：
 *   16 人 → 画幅 ≈ 1330，视口 1000 时需 k≈0.74
 *   43 人 → 画幅 ≈ 3786，需 k≈0.25
 *   100 人 → 画幅 ≈ 5560，需 k≈0.17
 * 曾取 0.3，结果 43 人时全览被夹在 0.3，屏幕外还有 10 个人
 * ——**「全览」名不副实**。取 0.12 给到 150 人左右的余量。
 *
 * 降到这么小不会"看不清"：分层渲染会在 k<0.45 时自动切成圆点，
 * 那时本来就只该看分布，不该看细节。
 */
export const K_MIN = 0.12;
/** 放大上限：再大只是像素放大，看不出更多信息 */
export const K_MAX = 2.4;
/** 位移超过该值才认定为拖拽，否则视为点击 */
export const DRAG_THRESHOLD = 5;

export interface RadarPerson {
  id: string;
  /** 显示名 */
  title: string;
  /** 人格倾向标签，可空 */
  type?: string;
  /** 相似度（0-100） */
  sim?: number;
  /** 真实头像（如已授权的知乎头像）；为空则用本地角色插画兜底 */
  avatarUrl?: string | null;
}

export interface PlacedNode {
  person: RadarPerson;
  sim: number;
  rank: number;
  /** 极角（弧度） */
  angle: number;
  x: number;
  y: number;
  /** 标签在头像右侧还是左侧 */
  right: boolean;
  /** 是否相似度最高（画 ✓ 徽标） */
  isTop: boolean;
}

export interface Ring {
  r: number;
  sim: number;
  inner: boolean;
}

export interface DecorDot {
  x: number;
  y: number;
  r: number;
  fill: string;
  opacity: number;
}

export interface Layout {
  stageW: number;
  stageH: number;
  centre: { x: number; y: number };
  nodes: PlacedNode[];
  rings: Ring[];
  dots: DecorDot[];
  maxSim: number;
  minSim: number;
  /**
   * 这份布局里是否**真的算过**相似度。
   *
   * 调用方（`sim` 全为 0）表示"当前用户画像没就绪、算不出相似度"，
   * 此时环上的 `sim` 标注与节点的 `x%` 都是无意义的 0 ——
   * 界面应当整块不显示，而不是画满 0%。
   * （产品要求：界面上不出现 0% / 100% 这类绝对化数值。）
   */
  hasSim: boolean;
}

/** 排名 → 半径。单调递增，保证「排名越前离中心越近」。 */
export function rankRadius(rank: number): number {
  return RADIUS_MIN + SPACING * Math.sqrt(Math.max(0, rank));
}

/** n 个人所需画幅（最外圈半径 + 标签余量） */
export function stageSpan(n: number): number {
  return 2 * (rankRadius(Math.max(0, n - 1)) + 130);
}

/**
 * 坐标取整。
 *
 * 不能省：浮点数直接进 style 会导致 **hydration 不匹配** ——
 * 服务端渲染出 `left:"359.077px"`，客户端是 `left:359.0769...`，
 * React 会整树警告且拒绝修补。取整后两端一致。
 */
function px(n: number): number {
  return Math.round(n);
}

/**
 * 轨道环：按实际分布取 3~4 道，半径直接对齐到该排名的人所处位置，
 * 所以环上的相似度标注是有含义的参照线，不是装饰。
 */
export function ringsFor(count: number, sims: number[]): Ring[] {
  if (!count || !sims.length) return [];
  const lo = Math.min(...sims);
  const hi = Math.max(...sims);
  const steps = count >= 10 ? 3 : 2;
  const out: Ring[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const rank = Math.round((i / steps) * Math.max(0, count - 1));
    const t = count > 1 ? rank / (count - 1) : 0;
    out.push({
      r: rankRadius(rank),
      sim: Math.round(hi - t * (hi - lo)),
      inner: i === 0,
    });
  }
  return out;
}

/** 装饰点：参考图里的彩色小圆点，纯装饰。用固定种子保证每次刷新一致。 */
export function decorDots(maxR: number): DecorDot[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const colors = ["#e2664f", "#ffc94d", "#348cff", "#aaba70", "#c9b6a0"];
  const out: DecorDot[] = [];
  for (let i = 0; i < 16; i += 1) {
    const a = rnd() * Math.PI * 2;
    const r = RADIUS_MIN + rnd() * Math.max(40, maxR - RADIUS_MIN);
    out.push({
      // 相对中心的偏移量，由调用方加上 centre
      x: px(Math.cos(a) * r),
      y: px(Math.sin(a) * r),
      r: px(3 + rnd() * 5),
      fill: colors[Math.floor(rnd() * colors.length)],
      opacity: Math.round((0.4 + rnd() * 0.4) * 100) / 100,
    });
  }
  return out;
}

/** 把人物列表算成完整布局 */
export function computeLayout(people: RadarPerson[]): Layout | null {
  const list = (people || []).filter((p) => p && p.id);
  if (!list.length) return null;

  const sims = list.map((p) => (typeof p.sim === "number" ? p.sim : 0));
  const maxSim = Math.max(...sims);
  const minSim = Math.min(...sims);
  /* 全都 <= 0 ⇒ 没算过（0 是哨兵值，不是"0% 像"） */
  const hasSim = sims.some((s) => s > 0);

  /* 按相似度降序：排名越前 → 半径越小 → 越靠近中心的「我」 */
  const ranked = [...list].sort(
    (a, b) => (typeof b.sim === "number" ? b.sim : 0) - (typeof a.sim === "number" ? a.sim : 0),
  );

  const span = Math.max(720, Math.ceil(stageSpan(list.length)));
  const stageW = span;
  const stageH = span;
  const centre = { x: stageW / 2, y: stageH / 2 };

  const nodes: PlacedNode[] = ranked.map((p, rank) => {
    const r = rankRadius(rank);
    const a = rank * GOLDEN;
    return {
      person: p,
      sim: typeof p.sim === "number" ? p.sim : 0,
      rank,
      angle: a,
      x: px(Math.cos(a) * r),
      y: px(Math.sin(a) * r),
      right: Math.cos(a) >= 0,
      isTop: rank === 0,
    };
  });

  const maxR = rankRadius(Math.max(0, list.length - 1));
  return {
    stageW,
    stageH,
    centre,
    nodes,
    rings: ringsFor(list.length, sims),
    dots: decorDots(maxR),
    maxSim,
    minSim,
    hasSim,
  };
}

export interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * 默认取景：在「一次看到更多人」与「头像看得清」之间取平衡。
 *
 * 不用纯 fit-all —— 16 人时画幅约 1266px，缩到视口内只有 k≈0.36，
 * 头像 84px 变 30px、中心「我」88px 变 32px，整幅糊成一片点。
 * 也不直接聚焦中心 —— 那样一次只能看到附近几个人。
 *
 * 做法：算出 fit，但夹在 [K_DEFAULT_MIN, K_DEFAULT_MAX] 之间。
 * 于是人少时自然铺满，人多时停在一个仍然读得清的下限，
 * 剩下的靠拖拽 / 滚轮查看（这正是雷达支持拖动的原因）。
 */
export const K_DEFAULT_MIN = 0.5;
export const K_DEFAULT_MAX = 0.85;

export function computeDefaultView(layout: Layout, vw: number, vh: number): View {
  const fit = Math.min((vw - 16) / layout.stageW, (vh - 16) / layout.stageH);
  const k = Math.max(K_DEFAULT_MIN, Math.min(K_DEFAULT_MAX, fit));
  return {
    k,
    x: (vw - layout.stageW * k) / 2,
    y: (vh - layout.stageH * k) / 2,
  };
}

/**
 * 取景。三种：
 *  · mode="fit"  「全览」——把整幅缩进视口，用于纵览分布（会很小，但看得全）
 *  · mode="me"   「聚焦我」——以中心为准放大到标签可读
 *  · mode="auto" 默认——见 computeDefaultView
 *
 * 为什么三种都要：16 人按 ~170px 间距铺开需要 ~1400px 画幅，
 * 「全装下」与「看得清」在给定视口里不可兼得，所以都给，用户自选。
 *
 * 坐标基准：返回的 x/y 是**相对视口左上角**的平移量，
 * 因此只需要视口的宽高（clientWidth/clientHeight），
 * 不能代入视口在页面中的位置——否则雷达放在页面下方时中心会被推出视口。
 * 这是实际踩过的坑。
 */
export function computeView(
  mode: "fit" | "me" | "auto",
  layout: Layout,
  vw: number,
  vh: number,
): View {
  if (mode === "auto") return computeDefaultView(layout, vw, vh);

  if (mode === "fit") {
    const fit = Math.min((vw - 16) / layout.stageW, (vh - 16) / layout.stageH);
    const k = Math.max(K_MIN, Math.min(1.15, fit));
    return {
      k,
      x: (vw - layout.stageW * k) / 2,
      y: (vh - layout.stageH * k) / 2,
    };
  }

  const k = Math.max(0.5, Math.min(1.05, Math.min(vw, vh) / 860));
  return {
    k,
    x: vw / 2 - layout.centre.x * k,
    y: vh / 2 - layout.centre.y * k,
  };
}

/**
 * 以某点为锚缩放。保持锚点下的世界坐标不动：
 *   world = (screen - view) / k  →  新 view = screen - world · k'
 */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const next = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
  if (next === view.k) return view;
  const wx = (px - view.x) / view.k;
  const wy = (py - view.y) / view.k;
  return { k: next, x: px - wx * next, y: py - wy * next };
}

/* ── 按缩放级别分层渲染 ────────────────────────────────────────────────────
 *
 * 问题：候选池会随真实用户接入而变大（实测 16 → 43 人）。
 * 每个人都渲染「头像 + 名字 + 倾向 + 相似度」的话，DOM 节点数随人数线性增长，
 * 而缩到远景时这些细节**根本看不清**（k=0.3 时 84px 头像只剩 25px），
 * 等于花了渲染成本却看不到内容。
 *
 * 做法：按当前缩放 k 决定每个节点渲染到哪一层：
 *   · dot    —— 只画一个小圆（远景：看得见分布，认不出人）
 *   · avatar —— 头像（中景：认得出人，标签仍看不清）
 *   · full   —— 头像 + 名字 + 倾向 + 相似度（近景：完全可读）
 *
 * 这不是"限制人数"——**所有节点始终存在且可点**，只是细节按需渲染。
 * 所以「一次看到几十个人的位置关系」这个核心体验没有被牺牲。
 */

/** 低于此缩放 → 只画点 */
export const DETAIL_AVATAR_AT = 0.45;
/** 高于此缩放 → 画完整标签 */
export const DETAIL_FULL_AT = 0.72;

export type DetailLevel = "dot" | "avatar" | "full";

/** 当前缩放对应的渲染层级 */
export function detailLevel(k: number): DetailLevel {
  if (k < DETAIL_AVATAR_AT) return "dot";
  if (k < DETAIL_FULL_AT) return "avatar";
  return "full";
}

/**
 * 视口裁剪：只渲染落在视口内（含余量）的节点。
 *
 * 为什么要它：43 人铺开需要约 3800px 画幅，而视口通常只有 1000px，
 * 远景下大部分节点在屏幕外。给屏幕外的节点也渲染 DOM 是纯浪费。
 *
 * ★ 余量取「画幅的 5%」★
 * 试过两种固定值都失败：
 *   · 固定 260 **世界**像素 → k=0.3 时屏幕上只有 78px，全览丢 8 个人（35/43）
 *   · 固定 480 **屏幕**像素（≈2.5 屏）→ 裁剪几乎失效，120 人全渲染
 * 与画幅成比例才对：全览时视口≈画幅，5% 画幅在屏幕上是足够的安全边界；
 * 近景时画幅相对视口很小，5% 也不会大到让裁剪失效。
 *
 * 注意：**裁剪只影响渲染，不影响数据**。拖回来就能看到，不会"丢人"。
 */
export function visibleNodes(
  layout: Layout,
  view: View,
  vw: number,
  vh: number,
  marginPx?: number,
): PlacedNode[] {
  /* 默认余量 = 画幅的 5% */
  const margin = marginPx ?? layout.stageW * 0.05;

  /* 世界坐标下视口的可见范围：screen = world · k + view */
  const x0 = (0 - view.x) / view.k - margin;
  const x1 = (vw - view.x) / view.k + margin;
  const y0 = (0 - view.y) / view.k - margin;
  const y1 = (vh - view.y) / view.k + margin;

  const cx = layout.centre.x;
  const cy = layout.centre.y;
  return layout.nodes.filter((n) => {
    const wx = cx + n.x;
    const wy = cy + n.y;
    return wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1;
  });
}
