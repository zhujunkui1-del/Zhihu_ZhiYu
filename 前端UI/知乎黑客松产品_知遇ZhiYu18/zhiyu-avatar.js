/* ============================================================================
   知遇 ZhiYu · 角色头像运行时（zhiyu-avatar.js）
   ----------------------------------------------------------------------------
   作用：把旧前端的文字首字头像（"01" / "知" / "我"）替换为新前端的手绘
        fox 角色插画，按人物编号稳定映射，避免随机导致同一人换头像。

   做法：不修改任何一页的业务 JS。用 MutationObserver 监听 DOM，凡是出现
        头像容器的位置就补一次插画（含 JS 动态渲染出的候选卡、对话气泡）。
        函数幂等：已标记 data-avatar 的元素直接跳过。

   映射依据是旧前端已存在的 data-id / code 编号（demo-01 … demo-06），
   因此无需改动数据结构。
   ========================================================================= */
(function () {
  "use strict";

  var BASE = "./assets/characters/";

  /* 编号 → 角色插画。self 是"我"，其余对应六位演示人格。 */
  var BY_CODE = {
    "00": "self",
    "01": "linyue",
    "02": "chenyu",
    "03": "suqing",
    "04": "limeng",
    "05": "zhaoyi",
    "06": "zhouming"
  };

  /* 文字特征 → 角色插画（编号缺失时兜底，保证头像不空） */
  var BY_TEXT = [
    [/^知$|^我$|^me$/i, "self"],
    [/^0*1$/, "linyue"],
    [/^0*2$/, "chenyu"],
    [/^0*3$/, "suqing"],
    [/^0*4$/, "limeng"],
    [/^0*5$/, "zhaoyi"],
    [/^0*6$/, "zhouming"]
  ];

  /* 需要被插画替换的头像容器 */
  var AVATAR_SELECTOR = [
    ".p-avatar",
    ".dc-ava",
    ".ava",
    ".modal-avatar",
    ".po-ava",
    ".zh-avatar",
    ".agent-avatar"
  ].join(",");

  function codeOf(el) {
    /* 1) 元素自身或其祖先上的 data-id（如 demo-03） */
    var node = el;
    for (var depth = 0; node && depth < 6; depth += 1) {
      var id = node.getAttribute && node.getAttribute("data-id");
      if (id) {
        var m = /(\d{1,2})\s*$/.exec(id);
        if (m) return m[1].length === 1 ? "0" + m[1] : m[1];
      }
      node = node.parentElement;
    }
    return null;
  }

  function resolve(el) {
    /* 1) 显式 data-avatar（由本脚本写入，幂等用） */
    var fixed = el.getAttribute("data-avatar");
    if (fixed) return fixed;

    /* 2) Agent 对话里的 A / B 是"我 / 对方"的占位，按角色而非散列分配 */
    if (el.classList.contains("agent-avatar")) {
      var who = (el.textContent || "").trim().toUpperCase();
      if (who === "A") return "self";
      if (who === "B") return "newfriend";
    }

    /* 3) 从编号推断 */
    var code = codeOf(el);
    if (code && BY_CODE[code]) return BY_CODE[code];

    /* 4) 从文字推断 */
    var text = (el.textContent || "").trim();
    for (var i = 0; i < BY_TEXT.length; i += 1) {
      if (BY_TEXT[i][0].test(text)) return BY_TEXT[i][1];
    }

    /* 5) 兜底：稳定散列到某个角色，保证观感统一但不闪烁 */
    var seed = 0;
    var key = text || el.className || "x";
    for (var j = 0; j < key.length; j += 1) seed = (seed * 31 + key.charCodeAt(j)) % 997;
    var pool = ["newfriend", "suqing", "zhouming", "chenyu", "linyue", "zhaoyi", "limeng"];
    return pool[seed % pool.length];
  }

  function paint(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute("data-avatar-painted") === "1") return;

    var name = resolve(el);
    el.setAttribute("data-avatar", name);
    el.setAttribute("data-avatar-painted", "1");
    el.style.backgroundImage = 'url("' + BASE + name + ".webp\")";
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.color = "transparent";
    /* 插画是彩色的，去掉旧的字首语义但保留无障碍名称 */
    if (!el.getAttribute("aria-label") && !el.getAttribute("aria-hidden")) {
      var label = (el.textContent || "").trim();
      if (label) el.setAttribute("aria-label", "头像 " + label);
    }
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(AVATAR_SELECTOR)) paint(root);
    if (!root.querySelectorAll) return;
    var list = root.querySelectorAll(AVATAR_SELECTOR);
    for (var i = 0; i < list.length; i += 1) paint(list[i]);
  }

  function start() {
    scan(document.body);

    /* innerHTML 重渲染会造出新节点，用 rAF 合并同一次渲染的多次变动 */
    var queued = false;
    var pending = [];
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j += 1) {
          if (added[j].nodeType === 1) pending.push(added[j]);
        }
      }
      if (queued || !pending.length) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        var batch = pending;
        pending = [];
        for (var k = 0; k < batch.length; k += 1) scan(batch[k]);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
