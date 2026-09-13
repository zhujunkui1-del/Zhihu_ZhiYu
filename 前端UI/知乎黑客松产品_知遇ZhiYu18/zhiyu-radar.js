/* ============================================================================
   知遇 ZhiYu · 相遇雷达（zhiyu-radar.js）
   ----------------------------------------------------------------------------
   以「我」为中心的可拖拽 / 可缩放关系雷达：
     · 中心是用户头像
     · 半径 = 相似度（越近越同频），外围虚线轨道环标注相似度区间
     · 每个人物在轨道上按角度均匀分布，避免重叠
     · 头像 + 名字 + 人格倾向标签，虚线连回中心
     · 点击头像打开对方人格卡（调用宿主页的 window.openProfile）

   设计取舍：
   · 用 DOM 排布头像与标签、用底层 SVG 画环与连线 —— 便于响应式与点击命中
   · 角度按人数均分而非按相似度排序，避免同档位的人叠在一起
   · 头像确定性映射：无知乎头像时按 id 稳定取本地角色插画，不会每次刷新换脸
   ========================================================================= */
(function () {
  "use strict";

  /* 本地角色插画（知乎头像抓不到时的兜底） */
  var AVATAR_POOL = [
    "linyue", "chenyu", "suqing", "limeng", "zhaoyi", "zhouming", "newfriend",
  ];
  var AVATAR_BASE = "./assets/characters/";

  /* 舞台几何 */
  /* 舞台几何：随人数在 render() 里重算，这里只是初值 */
  var STAGE = { w: 1320, h: 1320 };
  var CENTRE = { x: 660, y: 660 };
  var RADIUS_MIN = 170;

  /* 螺旋间距常数：相邻两人的中心距离 ≈ SPACING·(√(n+1)−√n)。
     取 235 时 16 人最外圈约 1130px，画幅约 1500px —— 配合「聚焦我 / 全览」
     两种取景使用。 */
  var SPACING = 235;
  var GOLDEN = Math.PI * (3 - Math.sqrt(5));   // 黄金角 ≈ 137.5°

  /* 排序螺旋（向日葵 / phyllotaxis）布局：
     把候选按相似度降序排名，排名越前半径越小 → 「越近越同频」严格成立，
     同时黄金角保证任意两人都不重叠、分布自然。
     早期版本用「相似度线性映射半径 + 松弛推挤」，在 16 人时仍有 7 组重叠，
     根因是想同时满足「半径严格映射分数」与「零重叠」，两者在给定画幅下不可兼得。
     改为排序螺旋后，半径只表达次序，视觉上读起来一样，但重叠彻底消除。 */
  function rankRadius(rank) {
    return RADIUS_MIN + SPACING * Math.sqrt(rank);
  }
  function layoutN(n) {
    var radius = rankRadius(n);
    return { radius: radius, span: 2 * (radius + 130) };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 确定性头像：同一 id 永远同一张 */
  function avatarFor(p) {
    if (p.avatarUrl) return { url: p.avatarUrl, local: false };
    var key = String(p.id || p.code || p.title || "");
    var h = 0;
    for (var i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 100000;
    return { url: AVATAR_BASE + AVATAR_POOL[h % AVATAR_POOL.length] + ".webp", local: true };
  }

  /* 轨道环：按实际分布取 3~4 道，标注该环附近的人大致处于什么相似度。
     半径直接对齐到该排名的人所处的位置，所以环是有含义的参照线。 */
  function ringsFor(count, sims) {
    if (!count) return [];
    var lo = Math.min.apply(null, sims);
    var hi = Math.max.apply(null, sims);
    var out = [];
    var steps = count >= 10 ? 3 : 2;
    for (var i = 0; i <= steps; i += 1) {
      var rank = Math.round((i / steps) * Math.max(0, count - 1));
      /* i=0 是最内圈（相似度最高） */
      var t = count > 1 ? rank / (count - 1) : 0;
      out.push({
        r: rankRadius(rank),
        sim: Math.round(hi - t * (hi - lo)),
        inner: i === 0,
      });
    }
    return out;
  }

  /* 装饰点：参考图里的彩色小圆点，纯装饰。半径上限跟随实际布局跨度 */
  function decorDots(maxR) {
    var seed = 7;
    function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
    var colors = ["#e2664f", "#ffc94d", "#348cff", "#aaba70", "#c9b6a0"];
    var out = [];
    for (var i = 0; i < 16; i += 1) {
      var a = rnd() * Math.PI * 2;
      var r = RADIUS_MIN + rnd() * Math.max(40, maxR - RADIUS_MIN);
      out.push({
        x: CENTRE.x + Math.cos(a) * r,
        y: CENTRE.y + Math.sin(a) * r,
        r: 3 + rnd() * 5,
        fill: colors[Math.floor(rnd() * colors.length)],
        opacity: 0.4 + rnd() * 0.4,
      });
    }
    return out;
  }

  /* ── 渲染 ─────────────────────────────────────────────────────────────── */
  function render(el, people, opts) {
    if (!el) return;
    opts = opts || {};

    var list = (people || []).filter(function (p) { return p && p.id; });
    if (!list.length) {
      el.innerHTML =
        '<div class="radar-empty"><div class="big">雷达上还没有人</div>' +
        "<p>试试清空筛选，或换一个关键词——也可能是 TA 还没有开放 Agent 对话。</p></div>";
      return;
    }

    var sims = list.map(function (p) { return typeof p.sim === "number" ? p.sim : 0; });
    var maxSim = Math.max.apply(null, sims);
    var rings = ringsFor(list.length, sims);

    /* 按相似度降序排名：排名越前 → 半径越小 → 越靠近中心的「我」 */
    var ranked = list.slice().sort(function (a, b) {
      return (typeof b.sim === "number" ? b.sim : 0) - (typeof a.sim === "number" ? a.sim : 0);
    });

    /* 舞台尺寸随人数增长（螺旋最外圈半径 + 标签余量） */
    var laid = layoutN(list.length);
    var stageW = Math.max(720, Math.ceil(laid.span));
    var stageH = stageW;
    var centre = { x: stageW / 2, y: stageH / 2 };
    CENTRE = centre;
    STAGE = { w: stageW, h: stageH };

    var viewport = document.createElement("div");
    viewport.className = "radar-viewport";
    var stage = document.createElement("div");
    stage.className = "radar-canvas";
    stage.style.width = STAGE.w + "px";
    stage.style.height = STAGE.h + "px";
    viewport.appendChild(stage);
    el.innerHTML = "";
    el.appendChild(viewport);

    /* 底层 SVG：轨道环 / 连线 / 装饰点 */
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "radar-svg");
    svg.setAttribute("viewBox", "0 0 " + STAGE.w + " " + STAGE.h);
    svg.setAttribute("aria-hidden", "true");

    function mk(tag, attrs) {
      var n = document.createElementNS(svgNS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }

    /* 径向渐变定义（连线用） */
    var defs = mk("defs", {});
    var grad = mk("linearGradient", { id: "zy-radar-line", x1: "0", y1: "0", x2: "1", y2: "1" });
    grad.appendChild(mk("stop", { offset: "0", "stop-color": "#e2664f", "stop-opacity": "0.55" }));
    grad.appendChild(mk("stop", { offset: "1", "stop-color": "#ffc94d", "stop-opacity": "0.5" }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    /* 轨道环 */
    rings.forEach(function (ring) {
      svg.appendChild(mk("circle", {
        cx: CENTRE.x, cy: CENTRE.y, r: ring.r,
        fill: "none",
        class: ring.inner ? "radar-ring-inner" : "radar-ring",
      }));
    });

    /* 装饰点：铺在最外圈之内 */
    decorDots(rankRadius(Math.max(0, list.length - 1))).forEach(function (d) {
      svg.appendChild(mk("circle", {
        cx: d.x.toFixed(1), cy: d.y.toFixed(1), r: d.r.toFixed(1),
        fill: d.fill, opacity: d.opacity, stroke: "none",
      }));
    });

    /* 人物位置：按排名铺在黄金角螺旋上 —— 零重叠，且越靠前离中心越近 */
    var nodes = ranked.map(function (p, rank) {
      var sim = typeof p.sim === "number" ? p.sim : 0;
      var r = rankRadius(rank);
      var a = rank * GOLDEN;
      return {
        p: p,
        sim: sim,
        rank: rank,
        target: r,
        angle: (a * 180) / Math.PI,
        x: CENTRE.x + Math.cos(a) * r,
        y: CENTRE.y + Math.sin(a) * r,
      };
    });

    /* 连线（从中心到每个人） */
    nodes.forEach(function (n) {
      svg.appendChild(mk("line", {
        x1: CENTRE.x, y1: CENTRE.y,
        x2: n.x.toFixed(1), y2: n.y.toFixed(1),
        class: "radar-link",
        "stroke-dasharray": "4 5",
      }));
    });
    stage.appendChild(svg);

    /* 轨道环上的相似度标签：放在左侧中部，避开右上角控件与其他节点。
       注意 CSS 里 y 轴向下，所以取 +sin 才是屏幕下方。 */
    rings.forEach(function (ring) {
      if (ring.inner) return;
      var a = (188 * Math.PI) / 180;
      var tag = document.createElement("div");
      tag.className = "radar-ring-tag";
      tag.style.left = (CENTRE.x + Math.cos(a) * ring.r) + "px";
      tag.style.top = (CENTRE.y + Math.sin(a) * ring.r) + "px";
      tag.textContent = "≈ " + ring.sim + "%";
      stage.appendChild(tag);
    });

    /* 中心「我」 */
    var me = document.createElement("div");
    me.className = "radar-me";
    me.style.left = CENTRE.x + "px";
    me.style.top = CENTRE.y + "px";
    me.innerHTML =
      '<span class="radar-me-ring" aria-hidden="true"></span>' +
      '<span class="radar-me-avatar"><img src="' + AVATAR_BASE + 'self.webp" alt="我"></span>' +
      '<span class="radar-me-label">我</span>';
    stage.appendChild(me);

    /* 人物节点：螺旋布局已保证互不重叠，直接落位即可。
       （早期版本这里要先离屏测量标签宽度再做碰撞松弛，改为螺旋后不再需要） */
    function nodeHtml(n) {
      var p = n.p;
      var av = avatarFor(p);
      var right = Math.cos((n.angle * Math.PI) / 180) >= 0;
      var isTop = n.rank === 0;
      return {
        right: right,
        html:
          '<button class="radar-avatar' + (isTop ? " is-top" : "") + '" type="button" ' +
          'data-action="profile" aria-label="查看 ' + esc(p.title) + ' 的人格卡">' +
          '<img src="' + av.url + '" alt="" loading="lazy">' +
          (isTop ? '<span class="radar-top-badge" title="当前相似度最高">✓</span>' : "") +
          "</button>" +
          '<span class="radar-card">' +
          '<b class="radar-name">' + esc(p.title) + "</b>" +
          '<span class="radar-sub"><em class="radar-type">' + esc(p.type || "") +
          '</em><em class="radar-sim">' + n.sim + "%</em></span>" +
          "</span>",
      };
    }

    /* 落位：螺旋布局保证互不重叠，直接创建节点 */
    nodes.forEach(function (n) {
      var built = nodeHtml(n);
      var node = document.createElement("div");
      node.className = "radar-node" + (built.right ? " side-right" : " side-left");
      node.style.left = n.x.toFixed(1) + "px";
      node.style.top = n.y.toFixed(1) + "px";
      node.setAttribute("data-id", n.p.id);
      node.innerHTML = built.html;
      stage.appendChild(node);
    });

    /* ── 拖拽 / 缩放 ─────────────────────────────────────────────────── */
    var view = { x: 0, y: 0, k: 1 };
    var K_MIN = 0.3;
    var K_MAX = 2.4;

    function applyView() {
      stage.style.transform =
        "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")";
    }

    function centreView(fitAll) {
      var vw = viewport.clientWidth || el.clientWidth || 900;
      var vh = viewport.clientHeight || 620;
      /* 两种取景：
         · 默认（fitAll=false）—— 以「我」为中心，取一个头像与标签看得清的缩放；
           关系雷达的价值在于看清「谁离我近」，所以默认聚焦中心而不是缩到全局。
         · 全览（fitAll=true）—— 把整幅缩进视口，用于纵览分布。
         16 人按 ~170px 间距铺开需要 ~1400px 画幅，不可能同时「全装下」与「看得清」，
         因此两个都提供，并把取景逻辑写在同一个函数里保持一致。 */
      if (fitAll) {
        var fit = Math.min((vw - 16) / STAGE.w, (vh - 16) / STAGE.h);
        view.k = Math.max(0.3, Math.min(1.15, fit));
        view.x = (vw - STAGE.w * view.k) / 2;
        view.y = (vh - STAGE.h * view.k) / 2;
      } else {
        view.k = Math.max(0.5, Math.min(1.05, Math.min(vw, vh) / 860));
        view.x = vw / 2 - CENTRE.x * view.k;
        view.y = vh / 2 - CENTRE.y * view.k;
      }
      applyView();
    }

    /* 首次取景：默认「全览」——用户诉求是一次看到更多人；
       拖动或点「聚焦我」即可放大到以自己为中心细看。 */
    requestAnimationFrame(function () { centreView(true); });

    /* 拖拽状态。
       踩过的三个坑：
       1) 不能用「最大位移」这种跨交互累积的变量判断"刚才是不是拖拽"——
          一次拖拽后它会永久大于阈值，之后所有点击都被吞掉。
       2) 不能用 pointerleave 结束拖拽——setPointerCapture 期间指针离开视口
          也会触发它，会把拖拽状态搞乱。只认 pointerup / pointercancel。
       3) ★ 不能在 pointerdown 就无条件 setPointerCapture ★
          指针一旦被捕获，后续 pointerup / click 的 target 会被**重定向到捕获元素**
          （也就是这个 viewport），于是点头像时 e.target 永远不是头像，
          人格卡就永远打不开。必须等位移超过阈值、确认是拖拽之后再捕获。 */
    var pressing = false;
    var captured = false;
    var dragDistance = 0;
    var downAt = { x: 0, y: 0 };
    var startView = { x: 0, y: 0 };
    var DRAG_THRESHOLD = 5;

    viewport.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pressing = true;
      captured = false;
      dragDistance = 0;                 /* 每次按下都重置，杜绝跨交互泄漏 */
      downAt.x = e.clientX;
      downAt.y = e.clientY;
      startView.x = view.x;
      startView.y = view.y;
      /* 注意：这里【不】设置 is-dragging，也【不】捕获指针 */
    });

    viewport.addEventListener("pointermove", function (e) {
      if (!pressing) return;
      var dx = e.clientX - downAt.x;
      var dy = e.clientY - downAt.y;
      var dist = Math.abs(dx) + Math.abs(dy);
      if (dist <= DRAG_THRESHOLD) return;      /* 未达阈值：保留点击语义，不移动 */
      if (!captured) {
        /* 确认是拖拽了，这时才捕获指针（避免拖出视口时丢事件） */
        captured = true;
        dragDistance = dist;
        viewport.classList.add("is-dragging");
        if (viewport.setPointerCapture) {
          try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
        }
      }
      dragDistance = Math.max(dragDistance, dist);
      view.x = startView.x + dx;
      view.y = startView.y + dy;
      applyView();
    });

    function endDrag(e) {
      if (!pressing) return;
      pressing = false;
      viewport.classList.remove("is-dragging");
      if (captured) {
        try { viewport.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
      captured = false;
    }
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    /* 滚轮缩放：以光标位置为锚点 */
    viewport.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var rect = viewport.getBoundingClientRect();
        var px = e.clientX - rect.left;
        var py = e.clientY - rect.top;
        var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        var next = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
        if (next === view.k) return;
        /* 保持锚点不动：world = (screen - view) / k */
        var wx = (px - view.x) / view.k;
        var wy = (py - view.y) / view.k;
        view.k = next;
        view.x = px - wx * view.k;
        view.y = py - wy * view.k;
        applyView();
      },
      { passive: false }
    );

    /* 点头像打开人格卡。
       因为拖拽确实会捕获指针（click.target 会变成 viewport），
       所以这里不能只靠 e.target：命中判定改用坐标反查 elementFromPoint，
       这样无论事件目标是头像本身还是被重定向来的 viewport 都能正确识别。 */
    viewport.addEventListener(
      "click",
      function (e) {
        var wasDrag = dragDistance > DRAG_THRESHOLD;
        dragDistance = 0;                 /* 本次交互结束，立刻归零 */
        if (wasDrag) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        /* 优先用事件目标；被指针捕获重定向时回退到坐标反查 */
        var hit = e.target && e.target.closest ? e.target.closest('[data-action="profile"]') : null;
        if (!hit && typeof document.elementFromPoint === "function") {
          var under = document.elementFromPoint(e.clientX, e.clientY);
          hit = under && under.closest ? under.closest('[data-action="profile"]') : null;
        }
        if (!hit) return;
        var host = hit.closest(".radar-node");
        var id = host ? host.getAttribute("data-id") : null;
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openProfile === "function") {
          window.openProfile(id);
        }
      },
      true
    );

    /* 右上角控件 */
    var tools = document.createElement("div");
    tools.className = "radar-tools";
    tools.innerHTML =
      '<button type="button" data-zoom="in" aria-label="放大">+</button>' +
      '<button type="button" data-zoom="out" aria-label="缩小">−</button>' +
      '<button type="button" data-zoom="fit" aria-label="全览" class="wide">全览</button>' +
      '<button type="button" data-zoom="me" aria-label="聚焦到我" class="wide">聚焦我</button>' +
      '<span class="radar-hint">拖动平移 · 滚轮缩放 · 点头像看人格卡</span>';
    el.appendChild(tools);

    tools.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-zoom]") : null;
      if (!b) return;
      var kind = b.getAttribute("data-zoom");
      if (kind === "fit") { centreView(true); return; }
      if (kind === "me") { centreView(false); return; }
      var rect = viewport.getBoundingClientRect();
      var cx = rect.width / 2;
      var cy = rect.height / 2;
      var factor = kind === "in" ? 1.18 : 1 / 1.18;
      var next = Math.max(K_MIN, Math.min(K_MAX, view.k * factor));
      if (next === view.k) return;
      var wx = (cx - view.x) / view.k;
      var wy = (cy - view.y) / view.k;
      view.k = next;
      view.x = cx - wx * view.k;
      view.y = cy - wy * view.k;
      applyView();
    });

    /* 数值统计条 */
    var stats = document.createElement("div");
    stats.className = "radar-stats";
    stats.innerHTML =
      '<span>雷达上 <b>' + nodes.length + "</b> 位</span>" +
      '<span>最近 <b>' + maxSim + "%</b></span>" +
      '<span>最远 <b>' + Math.min.apply(null, sims) + "%</b></span>";
    el.appendChild(stats);

    /* 视口尺寸变化时重新居中（仅首次之后的宽高变化） */
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (!viewport.clientWidth) return;
        if (!viewport.getAttribute("data-centred")) {
          viewport.setAttribute("data-centred", "1");
          centreView(true);
        }
      });
      ro.observe(viewport);
    }
  }

  window.ZhiyuRadar = { render: render };
})();
