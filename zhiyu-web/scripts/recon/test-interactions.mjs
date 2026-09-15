#!/usr/bin/env node
/**
 * 功能回归测试：证明"只换皮、没动功能"。
 *
 * 用 page.evaluate 驱动页面内交互（该浏览器封装未暴露 page.click/$$eval）。
 * 覆盖：发现页三维筛选与级联 / 随机推荐 / 快速匹配 / 人格卡弹窗 + 雷达图 /
 *       Agent 匹配对话与报告弹窗 / 通知三分类 / 设置四区与 BYOK 表单。
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = "http://127.0.0.1:4188/";
const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

const results = [];
const record = (area, name, ok, detail = "") => results.push({ area, name, ok: !!ok, detail });

async function open(file) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + file, { waitUntil: "load" });
  await page.waitForTimeout(500);
  return { page, errors };
}

const sleep = (ms) => `await new Promise(r=>setTimeout(r,${ms}))`;

/* ══════════════════════ 发现页 ══════════════════════ */
{
  const { page, errors } = await open("zhiyu-find.html");

  const data = await page.evaluate(async () => {
    const out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    // ── 三页签 ──
    out.tabs = {};
    for (const [tab, panel] of [["random", "#tab-random"], ["quick", "#tab-quick"], ["search", "#tab-search"]]) {
      document.querySelector('[data-tab="' + tab + '"]').click();
      await wait(220);
      const el = document.querySelector(panel);
      const others = [...document.querySelectorAll(".tab-panel")].filter((p) => p !== el && !p.hidden);
      out.tabs[tab] = !el.hidden && others.length === 0;
    }

    // ── 初始结果数 ──
    out.initialCards = document.querySelectorAll("#search-results .persona-card").length;

    // ── 省 → 市级联 ──
    const prov = document.getElementById("filter-prov");
    const city = document.getElementById("filter-city");
    out.cityDisabledBefore = city.disabled;
    prov.value = "浙江";
    prov.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(250);
    out.cityDisabledAfter = city.disabled;
    out.cityOptions = city.options.length;
    out.zhejiangCards = document.querySelectorAll("#search-results .persona-card").length;
    out.zhejiangCount = document.getElementById("result-count").textContent;

    // ── 城市二级筛选 ──
    city.value = "杭州";
    city.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(250);
    out.hangzhouCards = document.querySelectorAll("#search-results .persona-card").length;

    // ── 重置 ──
    document.getElementById("reset-filters").click();
    await wait(250);
    out.afterResetCards = document.querySelectorAll("#search-results .persona-card").length;
    out.afterResetProv = document.getElementById("filter-prov").value;
    out.afterResetCityDisabled = document.getElementById("filter-city").disabled;

    // ── 关键词搜索 ──
    document.getElementById("search-q").value = "深圳";
    document.getElementById("search-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait(250);
    out.searchCards = document.querySelectorAll("#search-results .persona-card").length;

    // ── 只看接受 Agent 对话 ──
    document.getElementById("reset-filters").click();
    await wait(220);
    const cb = document.getElementById("filter-agent");
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(250);
    out.agentOnlyCards = document.querySelectorAll("#search-results .persona-card").length;

    // ── 随机换一批 ──
    document.querySelector('[data-tab="random"]').click();
    await wait(200);
    document.getElementById("reroll-btn").click();
    await wait(300);
    out.randomFirst = document.querySelectorAll("#random-results .persona-card").length;
    document.getElementById("reroll-btn").click();
    await wait(300);
    out.randomSecond = document.querySelectorAll("#random-results .persona-card").length;

    // ── 快速匹配 ──
    document.querySelector('[data-tab="quick"]').click();
    await wait(200);
    document.getElementById("quick-run").click();
    await wait(1500);
    out.quickHidden = document.getElementById("quick-result").hidden;
    out.quickCards = document.querySelectorAll("#quick-results .persona-card").length;
    out.quickSims = [...document.querySelectorAll("#quick-results .sim-top .num")].map((e) => e.textContent);

    // ── 人格卡弹窗 + 雷达图 ──
    document.querySelector('[data-tab="search"]').click();
    await wait(220);
    document.querySelector("#search-results .persona-card [data-action='profile']").click();
    await wait(450);
    const modal = document.getElementById("persona-modal");
    const svg = document.querySelector("#modal-radar svg");
    const poly = document.querySelector("#modal-radar .mval");
    out.modalOpen = modal.classList.contains("open");
    out.radarHasSvg = !!svg;
    out.radarViewBox = svg ? svg.getAttribute("viewBox") : null;
    out.radarRings = document.querySelectorAll("#modal-radar .mgrid, #modal-radar .mgrid2").length;
    out.radarDots = document.querySelectorAll("#modal-radar .mdot").length;
    out.radarAxes = document.querySelectorAll("#modal-radar .maxis").length;
    out.radarNames = [...document.querySelectorAll("#modal-radar text.mname")].map((t) => t.textContent);
    // polygon 的 points 是 "x,y x,y ..." 形式，5 个顶点 = 10 个数字
    out.radarPoints = poly ? poly.getAttribute("points").trim().split(/\s+/).length : 0;
    out.radarVertices = out.radarPoints / 2;
    out.radarStroke = poly ? getComputedStyle(poly).stroke : "";
    out.radarFill = poly ? getComputedStyle(poly).fill : "";
    out.modalSim = document.getElementById("modal-sim").textContent;
    out.modalCity = document.getElementById("modal-city").textContent;
    out.modalType = document.getElementById("modal-type").textContent;

    // 雷达图容器是否用了新主题的环状底衬
    out.radarBackdrop = getComputedStyle(document.querySelector("#modal-radar"), "::before").backgroundImage.includes("rings.png");

    // ── 关闭弹窗 ──
    document.querySelector("#persona-modal [data-close]").click();
    await wait(250);
    out.modalClosed = !document.getElementById("persona-modal").classList.contains("open");

    // ── 让 Agent 先聊聊 ──
    const chatBtn = document.querySelector("#search-results .persona-card [data-action='chat']");
    if (chatBtn) {
      chatBtn.click();
      await wait(350);
      const toast = document.getElementById("toast");
      out.chatToast = toast.textContent;
      out.chatToastShown = toast.classList.contains("show");
    } else {
      out.chatToast = "(无可用按钮)";
      out.chatToastShown = false;
    }
    return out;
  });

  record("发现页", "三页签切换（找特定的人/随机/快速匹配）",
    Object.values(data.tabs).every(Boolean), JSON.stringify(data.tabs));
  record("发现页", "搜索结果初始渲染 16 位候选", data.initialCards === 16, `${data.initialCards} 张卡`);
  record("发现页", "选省份后启用城市级联",
    data.cityDisabledBefore === true && data.cityDisabledAfter === false && data.cityOptions > 5,
    `disabled ${data.cityDisabledBefore}→${data.cityDisabledAfter}，${data.cityOptions} 个城市`);
  record("发现页", "省份筛选生效（浙江 → 2 位：杭州 ×2）",
    data.zhejiangCards === 2, `${data.zhejiangCards} 张卡，计数文案「${data.zhejiangCount}」`);
  record("发现页", "城市二级筛选生效（杭州 → 2 位）",
    data.hangzhouCards === 2, `${data.hangzhouCards} 张卡`);
  record("发现页", "重置筛选恢复全部 16 位",
    data.afterResetCards === 16 && data.afterResetProv === "" && data.afterResetCityDisabled === true,
    `${data.afterResetCards} 张卡，省份「${data.afterResetProv}」，城市禁用=${data.afterResetCityDisabled}`);
  record("发现页", "关键词搜索生效（深圳 → 2 位）",
    data.searchCards === 2, `${data.searchCards} 张卡`);
  record("发现页", "「只看接受 Agent 对话」筛选生效",
    data.agentOnlyCards === 11, `${data.agentOnlyCards} 张卡（示例数据中 11 位接受）`);
  record("发现页", "随机推荐渲染 8 位且可换一批",
    data.randomFirst === 8 && data.randomSecond === 8, `${data.randomFirst} / ${data.randomSecond}`);
  record("发现页", "快速匹配出结果（Top 10）",
    data.quickHidden === false && data.quickCards === 10, `${data.quickCards} 张卡，hidden=${data.quickHidden}`);
  {
    const sims = data.quickSims.map((s) => parseInt(s, 10));
    record("发现页", "快速匹配结果按相似度降序",
      sims.length === 10 && sims.every((v, i) => i === 0 || sims[i - 1] >= v), data.quickSims.join(" ≥ "));
  }
  record("发现页", "点击「查看人格卡」打开弹窗", data.modalOpen, `open=${data.modalOpen}`);
  record("发现页", "雷达图 SVG 结构完整（4 环 + 5 轴 + 5 顶点 + 5 标签）",
    data.radarHasSvg && data.radarRings === 4 && data.radarAxes === 5 && data.radarDots === 5 && data.radarVertices === 5,
    JSON.stringify({ viewBox: data.radarViewBox, rings: data.radarRings, axes: data.radarAxes, dots: data.radarDots, vertices: data.radarVertices }));
  record("发现页", "雷达图 5 个维度标签正确",
    data.radarNames.join("/") === "深度思考偏好/表达外放度/兴趣广度/成长体验取向/外向程度",
    data.radarNames.join(" / "));
  record("发现页", "雷达图套用暖珊瑚主色（#e2664f）",
    data.radarStroke.replace(/\s/g, "") === "rgb(226,102,79)",
    `stroke=${data.radarStroke}  fill=${data.radarFill}`);
  record("发现页", "雷达图带手绘环状底衬",
    data.radarBackdrop === true, `::before 引用 rings.png = ${data.radarBackdrop}`);
  record("发现页", "弹窗数据填充正常（相似度 / 所在地 / 人格倾向）",
    data.modalSim.includes("%") && data.modalCity.length > 0 && data.modalType.length > 0,
    `sim=${data.modalSim}  city=${data.modalCity}  type=${data.modalType}`);
  record("发现页", "弹窗可关闭", data.modalClosed);
  record("发现页", "「让 Agent 先聊聊」触发提示",
    data.chatToastShown && data.chatToast.length > 0, `toast=「${data.chatToast}」`);
  record("发现页", "全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ══════════════════════ 人格页 ══════════════════════ */
{
  const { page, errors } = await open("zhiyu-persona.html");

  const data = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};

    out.tabs = {};
    for (const id of ["tab-card", "tab-sources", "tab-distill", "tab-card"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.click();
      await wait(250);
      out.tabs[id] = [...document.querySelectorAll(".tab-panel")].filter((p) => !p.hidden).length;
    }

    const svg = document.querySelector(".pr-shell svg");
    const poly = document.querySelector(".pr-shell .pr-val");
    out.radarHasSvg = !!svg;
    out.radarDims = document.querySelectorAll(".pr-shell text.pr-name").length;
    out.radarRings = document.querySelectorAll(".pr-shell .pr-ring, .pr-shell .pr-ring2").length;
    out.radarAxes = document.querySelectorAll(".pr-shell .pr-axis").length;
    // 该演示人格尚无特征数据时走空态：只画网格/轴/标签，不画数据多边形（正确行为）
    out.radarHasData = !!poly;
    out.radarStroke = poly ? getComputedStyle(poly).stroke : "";
    const ring2 = document.querySelector(".pr-shell .pr-ring2");
    out.radarRing2Stroke = ring2 ? getComputedStyle(ring2).stroke : "";
    out.radarRing2Dash = ring2 ? getComputedStyle(ring2).strokeDasharray : "";
    out.radarBackdrop = getComputedStyle(document.querySelector(".pr-shell"), "::before")
      .backgroundImage.includes("rings.png");

    out.sourceCards = document.querySelectorAll(".src-card, .src").length;
    out.sourceBadges = document.querySelectorAll("[id^='badge-']").length;
    out.stages = document.querySelectorAll(".stage-list li, .stage-ic").length;
    out.agentFig = !!document.querySelector(".agent-fig");

    /* 合并「人格卡·综合画像」到六源面板后的回归点：
       #ov-title 必须存在（paintOverview 直接写它，缺了会抛错并中断整页 JS） */
    out.ovTitleExists = !!document.getElementById("ov-title");
    out.ovActionsExists = !!document.getElementById("ov-actions");
    out.ovButtonText = (document.getElementById("ov-actions") || {}).textContent?.trim() || "";
    out.gridMerged = !!document.querySelector(".card-grid.is-merged");
    out.ovTitleHidden = (() => {
      const t = document.getElementById("ov-title");
      return t ? t.getBoundingClientRect().height <= 1 : null;
    })();

    /* 品牌 logo 必须真的加载成功（SVG XML 非法会显示破图） */
    out.brandLogos = [...document.querySelectorAll(".brand-logo")]
      .filter((i) => i.getBoundingClientRect().width > 1)
      .map((i) => ({ src: i.getAttribute("src"), loaded: i.complete && i.naturalWidth > 0 }));

    /* 加了边框的列表容器必须同时有内边距 */
    out.boxed = [".run-req", ".stage-list"].map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { sel, borderW: parseFloat(cs.borderTopWidth) || 0, padTop: parseFloat(cs.paddingTop) || 0, padBottom: parseFloat(cs.paddingBottom) || 0 };
    }).filter(Boolean);
    return out;
  });

  record("人格页", "四个页签可切换且仅一个面板可见",
    Object.values(data.tabs).length >= 3 && Object.values(data.tabs).every((v) => v === 1),
    JSON.stringify(data.tabs));
  record("人格页", "人格雷达图渲染完整（4 环 + 5 轴 + 5 维标签）",
    data.radarHasSvg && data.radarDims === 5 && data.radarRings === 4 && data.radarAxes === 5,
    JSON.stringify({ dims: data.radarDims, rings: data.radarRings, axes: data.radarAxes, 有数据面: data.radarHasData }));
  record("人格页", "人格雷达图套用新主题（虚线外环 + 主题描边）",
    data.radarRing2Stroke.replace(/\s/g, "") === "rgba(83,42,23,0.52)" &&
      (data.radarRing2Dash || "").replace(/\s/g, "") === "5px,4px" &&
      (!data.radarHasData || data.radarStroke.replace(/\s/g, "") === "rgb(226,102,79)"),
    `ring2=${data.radarRing2Stroke} dash=${data.radarRing2Dash}${data.radarHasData ? " val=" + data.radarStroke : " （空态，无数据面）"}`);
  record("人格页", "人格雷达图带手绘环状底衬", data.radarBackdrop === true, `rings.png=${data.radarBackdrop}`);
  record("人格页", "六源注入卡片与状态标记存在",
    (data.sourceCards + data.sourceBadges) >= 6, `卡片 ${data.sourceCards} + 标记 ${data.sourceBadges}`);
  record("人格页", "蒸馏流程步骤存在", data.stages >= 3, `${data.stages} 个步骤`);
  record("人格页", "Agent 状态动画图保留", data.agentFig === true);

  // 本轮修复的回归保护
  record("人格页", "三个页签均可切换（含 Agent 蒸馏）",
    Object.keys(data.tabs).length === 3 && Object.values(data.tabs).every((v) => v === 1),
    `覆盖页签：${Object.keys(data.tabs).join(" / ")}`);
  record("人格页", "综合画像已并入六源面板（#ov-title 保留 + 按钮可见）",
    data.gridMerged && data.ovTitleExists && data.ovActionsExists && data.ovTitleHidden === true && data.ovButtonText.length > 0,
    `合并=${data.gridMerged} ov-title=${data.ovTitleExists}(隐藏=${data.ovTitleHidden}) 按钮=「${data.ovButtonText}」`);
  record("人格页", "品牌 logo 正常加载（非破图）",
    data.brandLogos.length > 0 && data.brandLogos.every((l) => l.loaded),
    data.brandLogos.map((l) => `${l.src.split("/").pop()}=${l.loaded ? "OK" : "破图"}`).join(" "));
  record("人格页", "蒸馏面板列表盒有边框也有内边距（文字不压线）",
    data.boxed.every((b) => b.borderW === 0 || (b.padTop >= 6 && b.padBottom >= 6)),
    data.boxed.map((b) => `${b.sel}(框${b.borderW}/上${b.padTop}/下${b.padBottom})`).join(" "));
  record("人格页", "全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ══════════════════════ Agent 匹配页 ══════════════════════ */
{
  const { page, errors } = await open("zhiyu-agent-match.html");

  const data = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};

    out.tabs = {};
    for (const id of ["tab-running", "tab-reports", "tab-running"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.click();
      await wait(250);
      out.tabs[id] = [...document.querySelectorAll(".tab-panel")].filter((p) => !p.hidden).length;
    }

    out.runningItems = document.querySelectorAll("#run-list > *").length;
    out.countRunning = document.getElementById("cnt-running") ? document.getElementById("cnt-running").textContent : "";
    out.countReports = document.getElementById("cnt-reports") ? document.getElementById("cnt-reports").textContent : "";

    // 对话弹窗
    const chatBtn = document.querySelector("#run-list button");
    if (chatBtn) {
      chatBtn.click();
      await wait(450);
      const m = document.getElementById("chat-modal");
      out.chatOpen = m ? m.classList.contains("open") : null;
      out.chatMsgs = document.querySelectorAll("#chat-feed > *").length;
      out.chatTitle = document.getElementById("chat-title") ? document.getElementById("chat-title").textContent : "";
      document.querySelectorAll("#chat-modal [data-close]").forEach((b) => b.click());
      await wait(250);
    }

    // 报告弹窗
    const repTab = document.getElementById("tab-reports");
    repTab.click();
    await wait(280);
    out.reportItems = document.querySelectorAll("#rep-list > *").length;
    const repBtn = document.querySelector("#rep-list button");
    if (repBtn) {
      repBtn.click();
      await wait(450);
      const m = document.getElementById("rep-modal");
      out.repOpen = m ? m.classList.contains("open") : null;
      out.repHasRadar = !!document.querySelector(".radar-wrap svg");
      out.repDims = document.querySelectorAll("#rep-dims > *").length;
      out.repScore = document.getElementById("rep-score") ? document.getElementById("rep-score").textContent : "";
      // 该雷达用内联属性绘制，不用 class：数据面是最后一个 polygon，顶点是 circle
      const polys = [...document.querySelectorAll(".radar-wrap svg polygon")];
      const dataPoly = polys[polys.length - 1];
      out.repRadarGrids = polys.filter((p) => getComputedStyle(p).fill === "none").length;
      out.repRadarFill = dataPoly ? getComputedStyle(dataPoly).fill : "";
      out.repRadarStroke = dataPoly ? getComputedStyle(dataPoly).stroke : "";
      out.repRadarDots = document.querySelectorAll(".radar-wrap svg circle").length;
      out.repRadarAxes = document.querySelectorAll(".radar-wrap svg line").length;
    }
    return out;
  });

  record("Agent 匹配页", "两页签可切换且仅一个面板可见",
    Object.values(data.tabs).length >= 2 && Object.values(data.tabs).every((v) => v === 1),
    JSON.stringify(data.tabs));
  record("Agent 匹配页", "认识中列表与计数渲染",
    data.runningItems > 0, `${data.runningItems} 项，计数「${data.countRunning}」`);
  record("Agent 匹配页", "对话弹窗打开并渲染对话流",
    data.chatOpen === true && data.chatMsgs > 0,
    `open=${data.chatOpen} 消息 ${data.chatMsgs} 条，标题「${data.chatTitle}」`);
  record("Agent 匹配页", "匹配报告列表渲染",
    data.reportItems > 0, `${data.reportItems} 份，计数「${data.countReports}」`);
  record("Agent 匹配页", "报告弹窗 + 五维雷达 / 维度列表",
    data.repOpen === true && (data.repHasRadar || data.repDims >= 5),
    JSON.stringify({ open: data.repOpen, radar: data.repHasRadar, 网格: data.repRadarGrids, 轴: data.repRadarAxes, 顶点: data.repRadarDots, 维度条: data.repDims, score: data.repScore }));
  record("Agent 匹配页", "报告雷达图套用暖珊瑚主色（填充 + 描边 + 顶点）",
    data.repHasRadar &&
      data.repRadarFill.replace(/\s/g, "") === "rgb(226,102,79)" &&
      data.repRadarStroke.replace(/\s/g, "") === "rgb(226,102,79)" &&
      data.repRadarDots === 5,
    `fill=${data.repRadarFill} stroke=${data.repRadarStroke} 顶点=${data.repRadarDots}`);
  record("Agent 匹配页", "全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ══════════════════════ 通知页 ══════════════════════ */
{
  const { page, errors } = await open("zhiyu-notify.html");

  const data = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};

    // 页签容器 #notify-tabs 下的按钮用 data-tab 标识（all / done / report），无 id
    const tabs = [...document.querySelectorAll("#notify-tabs button[data-tab]")];
    out.tabIds = tabs.map((b) => b.getAttribute("data-tab"));
    out.perTab = {};
    for (const b of tabs) {
      b.click();
      await wait(240);
      const key = b.getAttribute("data-tab");
      const visible = document.querySelectorAll("#n-list > *:not([hidden])").length;
      const activeCount = tabs.filter((x) => x.classList.contains("active")).length;
      out.perTab[key] = { visible, activeCount };
    }
    // 回到「全部」
    if (tabs[0]) { tabs[0].click(); await wait(240); }

    out.unreadBefore = document.getElementById("head-unread-t").textContent;
    document.getElementById("mark-all").click();
    await wait(320);
    out.unreadAfter = document.getElementById("head-unread-t").textContent;

    const item = document.querySelector("#n-list > *");
    if (item) {
      item.click();
      await wait(450);
      const m = document.querySelector(".modal.open");
      out.modalOpen = !!m;
      out.modalId = m ? m.id : null;
      out.modalHasSvg = !!(m && m.querySelector("svg"));
    }
    return out;
  });

  record("通知页", "三分类页签存在且可切换（全部/对话完成/发来的报告）",
    data.tabIds.length === 3 &&
      data.tabIds.join(",") === "all,done,report" &&
      Object.values(data.perTab).every((v) => v.activeCount === 1),
    `页签=${data.tabIds.join("/")}  各页可见条数=${JSON.stringify(Object.fromEntries(Object.entries(data.perTab).map(([k, v]) => [k, v.visible])))}`);
  record("通知页", "「全部标为已读」生效",
    data.unreadBefore !== data.unreadAfter,
    `未读计数「${data.unreadBefore}」→「${data.unreadAfter}」`);
  record("通知页", "通知项可打开对应弹窗",
    data.modalOpen, `open=${data.modalOpen} id=${data.modalId} 含SVG=${data.modalHasSvg}`);
  record("通知页", "全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ══════════════════════ 设置页 ══════════════════════ */
{
  const { page, errors } = await open("zhiyu-settings.html");

  const data = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};

    out.sectionHeadings = [...document.querySelectorAll("h2, .sec-top, .panel-eyebrow")]
      .map((e) => e.textContent.trim()).filter((t) => t.length > 0).slice(0, 12);

    const switches = [...document.querySelectorAll(".switch input")];
    out.switchCount = switches.length;
    if (switches.length) {
      const first = switches[0];
      out.switchBefore = first.checked;
      first.click();
      await wait(160);
      out.switchAfter = first.checked;
      first.click();
      await wait(160);
      out.switchRestored = first.checked;
    }

    out.providerChips = document.querySelectorAll("#ai-providers .ai-chip, #ai-providers > *").length;
    out.providerNames = [...document.querySelectorAll("#ai-providers .ai-chip, #ai-providers > *")]
      .map((e) => e.textContent.trim()).slice(0, 14);

    const chips = [...document.querySelectorAll("#ai-providers .ai-chip, #ai-providers > *")];
    const target = chips.find((c) => c.textContent.includes("DeepSeek")) || chips[1];
    if (target) {
      target.click();
      await wait(280);
      const v = (id) => (document.getElementById(id) || {}).value || "";
      out.presetName = v("ai-name");
      out.presetBase = v("ai-base");
    }

    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) {
      logoutBtn.click();
      await wait(320);
      const m = document.getElementById("logout-modal");
      out.logoutOpen = m ? m.classList.contains("open") : null;
    }
    return out;
  });

  record("设置页", "四个分区标题存在",
    data.sectionHeadings.length >= 4,
    data.sectionHeadings.slice(0, 6).join(" / "));
  record("设置页", "沟通偏好开关可切换并复位",
    data.switchCount >= 3 && data.switchBefore !== data.switchAfter && data.switchRestored === data.switchBefore,
    `${data.switchCount} 个开关，${data.switchBefore}→${data.switchAfter}→${data.switchRestored}`);
  record("设置页", "BYOK 预设供应商列表（12 个）",
    data.providerChips >= 12, `${data.providerChips} 个：${data.providerNames.slice(0, 8).join(",")}…`);
  record("设置页", "选预设自动填入名称与 BaseURL",
    (data.presetName || "").length > 0 && (data.presetBase || "").startsWith("http"),
    `name=「${data.presetName}」 base=「${data.presetBase}」`);
  record("设置页", "退出登录二次确认弹窗",
    data.logoutOpen === true, `open=${data.logoutOpen}`);
  record("设置页", "全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ══════════════════════ 登录页 ══════════════════════ */
{
  const { page, errors } = await open("zhiyu-login.html");

  const data = await page.evaluate(() => {
    const btn = document.getElementById("oauth-trigger");
    const cs = btn ? getComputedStyle(btn) : null;
    return {
      btnExists: !!btn,
      btnText: btn ? btn.textContent.trim() : "",
      bgImage: cs ? cs.backgroundImage : "",
      bgColor: cs ? cs.backgroundColor : "",
      color: cs ? cs.color : "",
      hasZhihuBlue: cs ? cs.backgroundImage.includes("0, 132, 255") || cs.backgroundColor.includes("0, 132, 255") : false,
      colorIsWhite: cs ? /rgb\(255,\s*255,\s*255\)/.test(cs.color) : false,
      logos: [...document.querySelectorAll(".brand-logo")]
        .filter((i) => i.getBoundingClientRect().width > 1)
        .map((i) => ({ src: i.getAttribute("src"), loaded: i.complete && i.naturalWidth > 0 })),
    };
  });

  record("登录页", "知乎登录按钮使用知乎品牌蓝 + 白字",
    data.btnExists && data.hasZhihuBlue && data.colorIsWhite,
    `按钮=「${data.btnText}」 品牌蓝=${data.hasZhihuBlue} 白字=${data.colorIsWhite}`);
  record("登录页", "品牌 logo 正常加载（非破图）",
    data.logos.length > 0 && data.logos.every((l) => l.loaded),
    data.logos.map((l) => `${l.src.split("/").pop()}=${l.loaded ? "OK" : "破图"}`).join(" "));
  record("登录页", "全程无 JS 报错", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.close();
}

/* ══════════════════════ 汇总 ══════════════════════ */
await browser.close();

const byArea = {};
for (const r of results) (byArea[r.area] ||= []).push(r);

let pass = 0;
let fail = 0;
console.log("功能回归测试报告（视觉改造后）");
console.log("=".repeat(84));
for (const [area, list] of Object.entries(byArea)) {
  console.log(`\n【${area}】`);
  for (const r of list) {
    if (r.ok) pass += 1; else fail += 1;
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
}
console.log("\n" + "=".repeat(84));
console.log(`合计 ${results.length} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
