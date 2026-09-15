#!/usr/bin/env node
/**
 * 雷达布局数学的纯逻辑验证（不依赖 DOM）。
 *
 * 为什么单独测：DOM 版验证只能覆盖当前渲染的那一组人，
 * 而「人数变化时是否仍零重叠」是布局算法本身的属性，
 * 用纯函数可以穷举 1~40 人，比开浏览器快几个数量级。
 */
import {
  computeLayout,
  ringsFor,
  computeView,
  computeDefaultView,
  zoomAt,
  detailLevel,
  visibleNodes,
  DETAIL_AVATAR_AT,
  DETAIL_FULL_AT,
  K_MIN,
  K_MAX,
  RADIUS_MIN,
} from "../../components/radar/layout.ts";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

/** 造 n 个人，相似度落在 69~88（与原型一致） */
function people(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `demo-${String(i + 1).padStart(2, "0")}`,
    title: `人物${i + 1}`,
    type: "探索者",
    sim: n === 1 ? 88 : Math.round(88 - (i * 19) / (n - 1)),
  }));
}

/** 节点占位半径的近似值（头像 84/2 + 间距 + 标签卡余量） */
const NODE_R = 96;

console.log("雷达布局数学验证");
console.log("=".repeat(80));

/* 1 任意人数都零重叠 */
const bad = [];
for (let n = 1; n <= 40; n += 1) {
  const L = computeLayout(people(n));
  if (!L) { bad.push(`${n} 人返回 null`); continue; }
  for (let i = 0; i < L.nodes.length; i += 1) {
    for (let j = i + 1; j < L.nodes.length; j += 1) {
      const a = L.nodes[i];
      const b = L.nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < NODE_R) bad.push(`${n} 人时 #${i}x#${j} 距离仅 ${Math.round(d)}px`);
    }
  }
}
rec("1~40 人布局零重叠（节点间距 >= 96px）", bad.length === 0,
  bad.length ? bad.slice(0, 4).join("; ") : "40 个规模全部通过");

/* 2 半径随名次单调递增 */
const L16 = computeLayout(people(16));
const radii = L16.nodes.map((n) => Math.hypot(n.x, n.y));
let mono = true;
for (let i = 1; i < radii.length; i += 1) if (radii[i] <= radii[i - 1]) mono = false;
rec("半径随名次严格单调递增", mono,
  `${Math.round(radii[0])}px -> ${Math.round(radii[radii.length - 1])}px`);

/* 3 内圈半径必须留出中心「我」的余量 */
rec("内圈半径留出中心「我」的余量", Math.abs(radii[0] - RADIUS_MIN) < 1 && RADIUS_MIN >= 200,
  `rank0 = ${Math.round(radii[0])}px（RADIUS_MIN=${RADIUS_MIN}），中心「我」视觉半径约 44px`);

/* 4 黄金角保证角度分散 */
const angles = L16.nodes.map((n) => ((n.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
const minGap = (() => {
  let m = Math.PI * 2;
  for (let i = 0; i < angles.length; i += 1) {
    for (let j = i + 1; j < angles.length; j += 1) {
      let d = Math.abs(angles[i] - angles[j]);
      if (d > Math.PI) d = Math.PI * 2 - d;
      m = Math.min(m, d);
    }
  }
  return (m * 180) / Math.PI;
})();
rec("黄金角布局角度分散（最小夹角 > 3 度）", minGap > 3, `最小夹角 ${minGap.toFixed(2)} 度`);

/* 5 标签朝向两侧都有人 */
const rightCount = L16.nodes.filter((n) => n.right).length;
rec("标签左右分布合理（两侧都有人）", rightCount > 0 && rightCount < 16,
  `右侧 ${rightCount} / 左侧 ${16 - rightCount}`);

/* 6 轨道环半径对齐真实名次位置 */
const rings = ringsFor(16, people(16).map((p) => p.sim));
let ringOk = rings.length >= 3;
for (let i = 1; i < rings.length; i += 1) {
  if (rings[i].r <= rings[i - 1].r) ringOk = false;
  if (rings[i].sim >= rings[i - 1].sim) ringOk = false;
}
rec("轨道环半径递增、标注相似度递减", ringOk,
  rings.map((r) => `${Math.round(r.r)}px/${r.sim}%`).join(" -> "));

/* 7 空输入返回 null（由组件渲染空态） */
rec("空列表返回 null（走空态分支）",
  computeLayout([]) === null && computeLayout(null) === null);

/* 8 单人也能算出布局 */
const L1 = computeLayout(people(1));
rec("单人布局可用", !!L1 && L1.nodes.length === 1 && L1.rings.length > 0,
  L1 ? `${L1.nodes.length} 节点 / ${L1.rings.length} 环 / 画幅 ${L1.stageW}` : "null");

/* 9 画幅随人数增长 */
const w5 = computeLayout(people(5)).stageW;
const w16 = computeLayout(people(16)).stageW;
rec("画幅随人数增长", w16 > w5, `5 人 ${w5}px -> 16 人 ${w16}px`);

/* 10 缩放锚点：光标下的世界坐标保持不动 */
const vp = { x: 100, y: 50, k: 1 };
const before = { wx: (300 - vp.x) / vp.k, wy: (400 - vp.y) / vp.k };
const after = zoomAt(vp, 1.5, 300, 400);
const afterW = { wx: (300 - after.x) / after.k, wy: (400 - after.y) / after.k };
rec("缩放锚点不漂移（光标下的点保持不动）",
  Math.abs(before.wx - afterW.wx) < 0.001 && Math.abs(before.wy - afterW.wy) < 0.001,
  `world (${before.wx},${before.wy}) -> (${afterW.wx.toFixed(3)},${afterW.wy.toFixed(3)})`);

/* 11 缩放被夹在 K_MIN~K_MAX */
const zoomedOut = Array.from({ length: 40 }).reduce((v) => zoomAt(v, 1 / 1.3, 0, 0), { x: 0, y: 0, k: 1 });
const zoomedIn = Array.from({ length: 40 }).reduce((v) => zoomAt(v, 1.3, 0, 0), { x: 0, y: 0, k: 1 });
rec("缩放范围被夹在 K_MIN~K_MAX", zoomedOut.k === K_MIN && zoomedIn.k === K_MAX,
  `缩到 ${zoomedOut.k}（下限 ${K_MIN}）/ 放到 ${zoomedIn.k}（上限 ${K_MAX}）`);

/* 12 三种取景的缩放关系 */
const view = computeDefaultView(L16, 1084, 680);
const fit = computeView("fit", L16, 1084, 680);
const me = computeView("me", L16, 1084, 680);
rec("三种取景 k 值关系正确（全览 <= 默认 <= 聚焦我）",
  fit.k <= view.k + 0.001 && view.k <= me.k + 0.001,
  `全览 ${fit.k.toFixed(2)} / 默认 ${view.k.toFixed(2)} / 聚焦我 ${me.k.toFixed(2)}`);

/* 13 中心在取景后必须落在视口内 */
const meCentre = {
  x: view.x + L16.centre.x * view.k,
  y: view.y + L16.centre.y * view.k,
};
rec("默认取景后中心落在视口内",
  meCentre.x > 0 && meCentre.x < 1084 && meCentre.y > 0 && meCentre.y < 680,
  `中心屏幕坐标 (${Math.round(meCentre.x)}, ${Math.round(meCentre.y)})，视口 1084x680`);

/* ── 按缩放级别分层渲染（#4：人数变多时的性能兜底）────────────────────── */

/* 14 层级判定的边界 */
rec("缩放层级判定：远景→点 / 中景→头像 / 近景→完整",
  detailLevel(0.2) === "dot" &&
    detailLevel(DETAIL_AVATAR_AT - 0.01) === "dot" &&
    detailLevel(DETAIL_AVATAR_AT + 0.01) === "avatar" &&
    detailLevel(DETAIL_FULL_AT - 0.01) === "avatar" &&
    detailLevel(DETAIL_FULL_AT + 0.01) === "full" &&
    detailLevel(1.5) === "full",
  `dot<${DETAIL_AVATAR_AT} / avatar<${DETAIL_FULL_AT} / full≥${DETAIL_FULL_AT}`);

/* 15 默认取景应落在「头像」或「完整」，不能一进来就是点 */
{
  const k = computeDefaultView(L16, 1084, 680).k;
  const lv = detailLevel(k);
  rec("默认取景不会一进来就是远景圆点", lv !== "dot", `默认 k=${k.toFixed(2)} → ${lv}`);
}

/* 16 视口裁剪：结果是子集，且确实都在视口内 */
{
  const vw = 1084;
  const vh = 680;
  const fitView = computeView("fit", L16, vw, vh);
  const vis = visibleNodes(L16, fitView, vw, vh);
  rec("视口裁剪结果是全集的子集",
    vis.length <= L16.nodes.length &&
      vis.every((n) => L16.nodes.some((m) => m.person.id === n.person.id)),
    `可见 ${vis.length} / 全部 ${L16.nodes.length}`);

  /* 所有可见节点应真在视口内（含余量）。
     余量按**屏幕像素**给（默认视口短边的 12%），再换算成世界像素。 */
  const marginPx = Math.min(vw, vh) * 0.12;
  const inside = vis.every((n) => {
    const sx = (L16.centre.x + n.x) * fitView.k + fitView.x;
    const sy = (L16.centre.y + n.y) * fitView.k + fitView.y;
    return (
      sx > -marginPx - 1 &&
      sx < vw + marginPx + 1 &&
      sy > -marginPx - 1 &&
      sy < vh + marginPx + 1
    );
  });
  rec("裁剪后的节点确实都在视口范围内（含屏幕余量）", inside);
}

/* 17 数据规模变大时，**默认视图**仍显著降低渲染量
   （用 auto 而不是 fit —— fit 现在故意装下全部人，本就不该裁剪） */
{
  const BIG = computeLayout(people(120));
  const vw = 1013;
  const vh = 620;
  const v = computeView("auto", BIG, vw, vh);
  const vis = visibleNodes(BIG, v, vw, vh);
  rec("120 人时默认视图只渲染其中一部分（显著减少 DOM）",
    vis.length < BIG.nodes.length * 0.6,
    `渲染 ${vis.length} / 全部 ${BIG.nodes.length}（${Math.round((vis.length / BIG.nodes.length) * 100)}%）`);
}

/* 18 平移会把新区域节点带进来（裁剪不"丢人"） */
{
  const BIG = computeLayout(people(120));
  const vw = 1013;
  const vh = 620;
  const v0 = computeView("auto", BIG, vw, vh);
  const a = visibleNodes(BIG, v0, vw, vh).map((n) => n.person.id);
  const v1 = { ...v0, x: v0.x - BIG.stageW * v0.k * 0.35 };
  const b = visibleNodes(BIG, v1, vw, vh).map((n) => n.person.id);
  const movedIn = b.filter((id) => !a.includes(id));
  rec("平移到新区域后能看到之前被裁掉的节点（数据没丢）",
    movedIn.length > 0, `平移后新出现 ${movedIn.length} 个节点`);

  const all = visibleNodes(BIG, { ...v0, k: K_MIN, x: 0, y: 0 }, 4000, 4000);
  rec("视口足够大时能看到全部节点（全览不受裁剪影响）",
    all.length === BIG.nodes.length, `${all.length} / ${BIG.nodes.length}`);
}

/* 19 ★ 「全览」必须真的看得到全部人 ★
   这条踩了三次：
     ① 余量给固定 260 **世界**像素 → k=0.3 时屏幕上仅 78px，丢 8 人
     ② 余量改成固定 480 **屏幕**像素 → 裁剪失效，120 人全渲染
     ③ 余量改成画幅 5% → 裁剪对了，但 K_MIN=0.3 夹住了全览的 k，
        43 人需要 k≈0.16 才能装下 —— **全览名不副实**
   最终：余量 = 画幅 5%，K_MIN 降到 0.12。
   现在同时断言「全览能看全」与「远景仍能省 DOM」。 */
{
  const N = 43;
  const BIG = computeLayout(people(N));
  const vw = 1013;
  const vh = 620;
  const fitView = computeView("fit", BIG, vw, vh);
  const vis = visibleNodes(BIG, fitView, vw, vh);
  rec("全览能看到全部 43 人（K_MIN 不再夹住全览）",
    vis.length === BIG.nodes.length,
    `k=${fitView.k.toFixed(3)}，可见 ${vis.length} / ${N}`);

  /* 同时确认默认视图仍在裁剪（性能目的没丢） */
  const autoView = computeView("auto", BIG, vw, vh);
  const autoVis = visibleNodes(BIG, autoView, vw, vh);
  rec("默认视图仍会裁剪掉屏幕外节点（性能收益还在）",
    autoVis.length < BIG.nodes.length,
    `默认 k=${autoView.k.toFixed(2)}，渲染 ${autoVis.length} / ${N}`);
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
