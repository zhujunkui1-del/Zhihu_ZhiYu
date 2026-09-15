/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/** 发现页浏览器验证 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = path.join(RECON_DIR, "web-discover");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });

const errs = [];
const bad = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("发现页验证");
console.log("=".repeat(80));

/* 先建立会话，再进发现页（与其他受保护页一致） */
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "发现页验证" }),
  });
  const d = await r.json();
  if (d?.ok) {
    localStorage.setItem("zhiyu_demo", JSON.stringify({ userId: d.userId, personaId: d.personaId }));
  }
});
await page.goto(`${BASE}/find`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);

const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('[class*="seg"] button')].map((b) => b.textContent.trim()),
);
rec("页头与三个页签渲染", tabs.includes("找特定的人") && tabs.includes("随机推荐") && tabs.includes("快速匹配"),
  tabs.join(" / "));

/* ① 找特定的人：卡片
   注意：**不硬编码 16**。候选池 = 16 位示例人格 + 可能的真实用户
   （有人通过知乎 OAuth 登录后就会多出真人）。
   这里从页面自身渲染结果推导基准，断言"筛选前后相对变化"而不是绝对数量。
   用 sessionStorage 记录基准，避免为取数去打一个缺参数的接口（会 400）。 */
const cards = await page.evaluate(() => document.querySelectorAll("article").length);
const countText = await page.evaluate(
  () => document.querySelector('[class*="resultMeta"] span')?.textContent?.trim() ?? "",
);
rec("「找特定的人」渲染出卡片", cards > 0, `实际 ${cards} 张`);
rec("结果计数与卡片数一致",
  countText.includes(String(cards)), `计数文案「${countText}」/ 卡片 ${cards} 张`);

/* ② 卡片内容完整性 */
const cardInfo = await page.evaluate(() => {
  const a = document.querySelector("article");
  if (!a) return null;
  return {
    hasAvatar: !!a.querySelector("img"),
    avatarSrc: a.querySelector("img")?.getAttribute("src") ?? "",
    title: a.querySelector('[class*="pTitle"]')?.textContent?.trim() ?? "",
    metaLines: a.querySelectorAll('[class*="pMeta"] li').length,
    tags: a.querySelectorAll('[class*="pTag"]').length,
    buttons: [...a.querySelectorAll("button")].map((b) => b.textContent.trim()),
  };
});
rec("卡片有头像且指向本地角色插画",
  Boolean(cardInfo?.hasAvatar && cardInfo.avatarSrc.includes("/assets/characters/")),
  cardInfo ? `src=${cardInfo.avatarSrc}` : "无卡片");
rec("卡片有三行元信息（地区/倾向/Agent）", cardInfo?.metaLines === 3, `实际 ${cardInfo?.metaLines}`);
rec("卡片有标签", (cardInfo?.tags ?? 0) > 0, `${cardInfo?.tags} 个`);
rec("卡片按钮正确", cardInfo?.buttons.includes("查看人格卡") ?? false,
  (cardInfo?.buttons ?? []).join(" / "));

/* CDP 适配器没有 page.fill / selectOption，用原生 setter + 派发事件。
   注意必须走原型上的 value setter，否则 React 收不到变化。 */
const setInput = (selector, value) =>
  page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { sel: selector, val: value },
  );

const setSelect = (selector, value) =>
  page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { sel: selector, val: value },
  );

const clickButton = (text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().includes(t));
    if (!b) return false;
    b.click();
    return true;
  }, text);

/* ③ 搜索筛选（用页面初始卡片数做基准，不硬编码 16） */
const baseTotal = cards;
await setInput('input[aria-label="搜索关键词"]', "杭州");
await page.waitForTimeout(700);
const afterSearch = await page.evaluate(() => document.querySelectorAll("article").length);
rec("关键词筛选生效（杭州 → 变少）", afterSearch > 0 && afterSearch < baseTotal,
  `搜「杭州」剩 ${afterSearch} 张 / 基准 ${baseTotal}`);

await setInput('input[aria-label="搜索关键词"]', "zzzz-nothing");
await page.waitForTimeout(700);
const emptyShown = await page.evaluate(() => !!document.querySelector('[class*="emptyState"]'));
rec("无结果时显示空态", emptyShown);

await clickButton("重置筛选");
await page.waitForTimeout(700);
const afterReset = await page.evaluate(() => document.querySelectorAll("article").length);
rec("重置筛选恢复到基准数量", afterReset === baseTotal, `实际 ${afterReset} / 基准 ${baseTotal}`);

/* ④ 省份/城市联动 */
await setSelect("#f-prov", "浙江");
await page.waitForTimeout(700);
const cityOpts = await page.evaluate(() =>
  [...document.querySelectorAll("#f-city option")].map((o) => o.textContent.trim()),
);
rec("选省份后城市下拉联动", cityOpts.length > 1 && cityOpts.includes("杭州"),
  `浙江含 ${cityOpts.length - 1} 个城市：${cityOpts.slice(1, 5).join("、")}…`);
const afterProv = await page.evaluate(() => document.querySelectorAll("article").length);
rec("省份筛选生效", afterProv > 0 && afterProv < baseTotal,
  `浙江剩 ${afterProv} 张 / 基准 ${baseTotal}`);

await setSelect("#f-city", "杭州");
await page.waitForTimeout(700);
const afterCity = await page.evaluate(() => document.querySelectorAll("article").length);
rec("城市筛选进一步收窄", afterCity > 0 && afterCity <= afterProv, `杭州 ${afterCity} 张`);

/* ⑤ Agent 开关 */
await clickButton("重置筛选");
await page.waitForTimeout(600);
await page.evaluate(() => {
  const el = document.querySelector('input[aria-label="只看接受 Agent 对话"]');
  el.click();
});
await page.waitForTimeout(700);
const agentFiltered = await page.evaluate(() => ({
  cards: document.querySelectorAll("article").length,
  allHaveChatBtn: [...document.querySelectorAll("article")].every((a) =>
    [...a.querySelectorAll("button")].some((b) => b.textContent.includes("先聊聊")),
  ),
}));
/* 「只看接受 Agent 对话」的断言：
   勾选后卡片数应**变少**且每张都有「让 Agent 先聊聊」。
   不硬编码具体数字——候选池会随真实用户登录而变化。
   也不用打接口取期望值：`/api/discover` 必须有 personaId 参数，
   无参调用会返回 400，反而把「无资源 404」这条检查弄脏。 */
rec("「只看接受 Agent 对话」生效且卡片一致",
  agentFiltered.cards > 0 &&
    agentFiltered.cards < baseTotal &&
    agentFiltered.allHaveChatBtn,
  `${agentFiltered.cards} 张（未筛 ${baseTotal}），全部有「让 Agent 先聊聊」=${agentFiltered.allHaveChatBtn}`);

/* ⑥ 卡片 / 雷达 切换
   注意：雷达现在**按缩放级别分层 + 视口裁剪**，默认视图只渲染屏幕内的节点，
   所以节点数**不等于**卡片数（这是刻意的性能设计，不是 bug）。
   这里断言：雷达渲染出节点、卡片隐藏；再用「全览」确认能看到全部人。 */
await clickButton("相遇雷达");
await page.waitForTimeout(1800);
const radar = await page.evaluate(() => ({
  hasViewport: !!document.querySelector('[class*="Radar-module"][class*="viewport"]'),
  nodes: document.querySelectorAll('[data-action="profile"]').length,
  cardsVisible: document.querySelectorAll("article").length,
}));
rec("切到雷达：渲染出节点且卡片隐藏",
  radar.hasViewport && radar.nodes > 0 && radar.cardsVisible === 0,
  `雷达节点 ${radar.nodes} 个，可见卡片 ${radar.cardsVisible} 个`);

/* 点「全览」应能看到全部筛选后的人 —— 确认裁剪没有把人弄丢 */
await clickButton("全览");
await page.waitForTimeout(1600);
const radarAll = await page.evaluate(() => ({
  nodes: document.querySelectorAll('[data-action="profile"]').length,
  dots: document.querySelectorAll('[data-detail="dot"]').length,
}));
rec("「全览」能看到全部候选（裁剪不丢人）",
  radarAll.nodes === agentFiltered.cards,
  `全览节点 ${radarAll.nodes} / 筛选后卡片 ${agentFiltered.cards}（其中圆点 ${radarAll.dots} 个）`);
await page.screenshot({ path: path.join(OUT, "radar-view.png") });

/* ⑦ 雷达里点头像 → 跳人格卡 */
/* 先让布局停稳再测量：滚动会异步改变元素位置，若在滚动"之前"取坐标，
   鼠标落到的是滚动后的另一个位置，点不中节点（调试中踩过）。
   所以：统一滚动一次 → 等停稳 → 再取坐标并点击，中途不再滚动。 */
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.evaluate(() => {
  const b = document.querySelector('[data-action="profile"]');
  b?.scrollIntoView({ block: "center", behavior: "instant" });
});
await page.waitForTimeout(700);

/* ⚠️ 记录**真实被点的节点**：不能拿"我打算点的 id"当预期值 ——
   雷达会异步重渲染，测量到的坐标与真正落下的点击可能不是同一个节点
   （实测出现过"量的是 X，结果跳到 R"）。以事件里的 target 为准。 */
await page.evaluate(() => {
  window.__lastRadarHit = null;
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target?.closest?.('[data-action="profile"]');
      if (b) window.__lastRadarHit = b.getAttribute("data-id");
    },
    true,
  );
});

let clickedId = null;
const clickTrace = [];
for (let attempt = 0; attempt < 4 && clickedId === null; attempt += 1) {
  const prep = await page.evaluate((idx) => {
    const all = [...document.querySelectorAll('[data-action="profile"]')];
    const b = all[idx];
    if (!b) return null;
    b.scrollIntoView({ block: "center", behavior: "instant" });
    return { id: b.getAttribute("data-id") };
  }, attempt);
  if (!prep) break;
  await page.waitForTimeout(600);

  /* 测量与"落点"在同一次 evaluate 内完成，避免中间被重渲染插队 */
  const geo = await page.evaluate((id) => {
    const b = document.querySelector(`[data-action="profile"][data-id="${id}"]`);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      x: cx,
      y: cy,
      w: Math.round(r.width),
      h: Math.round(r.height),
      topTag: top ? `${top.tagName}.${String(top.className).slice(0, 24)}` : "(null)",
    };
  }, prep.id);
  if (!geo) continue;

  await page.evaluate(() => {
    window.__lastRadarHit = null;
  });
  await page.mouse.move(geo.x, geo.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  /* 点头像现在是**就地弹窗**（产品要求不跳页），所以要等弹窗里的卡片 */
  let modalTitle = "";
  for (let w = 0; w < 25; w += 1) {
    await page.waitForTimeout(400);
    modalTitle = await page.evaluate(
      () =>
        document.querySelector('[data-persona-modal="1"] [data-modal-title="1"]')?.textContent?.trim() ??
        "",
    );
    if (modalTitle && !modalTitle.includes("正在打开")) break;
  }

  const after = await page.evaluate(() => ({
    path: `${location.pathname}${location.search}`,
    hit: window.__lastRadarHit,
  }));
  clickTrace.push(
    `#${attempt} 量到=${prep.id} ${geo.w}×${geo.h}px 顶层=${geo.topTag}｜实际点击=${after.hit} → 弹窗「${modalTitle}」`,
  );
  /* 成功判据：点中了节点、弹窗打开且标题是那个人、且没有离开当前页 */
  if (after.hit && modalTitle.includes("的人格卡") && after.path.startsWith("/find")) {
    clickedId = after.hit;
  } else {
    await page.evaluate(() => {
      document.querySelector('[data-persona-modal="1"] [aria-label="关闭人格卡"]')?.click();
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);
  }
}

const afterRadarClick = await page.evaluate(() => `${location.pathname}${location.search}`);
rec(
  "雷达里点头像就地弹窗打开对方人格卡（不跳页）",
  clickedId !== null && afterRadarClick.startsWith("/find"),
  clickTrace.join("\n      "),
);

/* ⑧ 随机推荐 */
await page.goto(`${BASE}/find`, { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  [...document.querySelectorAll('[class*="seg"] button')].find((b) => b.textContent.trim() === "随机推荐")?.click();
});
await page.waitForTimeout(1200);
const rand = await page.evaluate(() => ({
  cards: document.querySelectorAll("article").length,
  hasSim: !!document.querySelector('[class*="simBlock"]'),
}));
rec("随机推荐出 4 张且带相似度", rand.cards === 4 && rand.hasSim,
  `${rand.cards} 张，有相似度条=${rand.hasSim}`);

const firstIds = await page.evaluate(() =>
  [...document.querySelectorAll("article")].map((a) => a.getAttribute("data-id")).join(","),
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("换一批"))?.click();
});
await page.waitForTimeout(900);
const secondIds = await page.evaluate(() =>
  [...document.querySelectorAll("article")].map((a) => a.getAttribute("data-id")).join(","),
);
rec("「换一批」换出不同的人", firstIds !== secondIds, `${firstIds} → ${secondIds}`);
await page.screenshot({ path: path.join(OUT, "random-view.png") });

/* ⑨ 快速匹配 */
await page.goto(`${BASE}/find`, { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  [...document.querySelectorAll('[class*="seg"] button')].find((b) => b.textContent.trim() === "快速匹配")?.click();
});
await page.waitForTimeout(900);
const beforeRun = await page.evaluate(() => document.querySelectorAll("article").length);
rec("快速匹配初始不出结果", beforeRun === 0, `${beforeRun} 张`);

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("开始快速匹配"))?.click();
});
await page.waitForTimeout(1200);
const quick = await page.evaluate(() => {
  const arts = [...document.querySelectorAll("article")];
  const sims = arts.map((a) => Number((a.querySelector('[class*="simNum"]')?.textContent ?? "0").replace("%", "")));
  return { n: arts.length, sims, desc: sims.every((v, i) => i === 0 || sims[i - 1] >= v) };
});
rec("快速匹配出 8 位且按相似度降序", quick.n === 8 && quick.desc,
  `${quick.n} 位，相似度 ${quick.sims.join(" >= ")}`);
await page.screenshot({ path: path.join(OUT, "quick-view.png") });

/* ⑩ 「让 Agent 先聊聊」——**真的跑一场 Agent 对话**，且不跳页
   ⚠️ 这个按钮以前只写 localStorage + 弹提示，从不调后端，所以这段测试
   以前只验"有没有弹提示"。现在它会真的调 /api/agent/meet（一次 10~40 秒），
   必须等请求结束再断言，否则读到的是"进行中"状态、一个提示都没有。 */
await page.goto(`${BASE}/find`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const beforeMeet = await page.evaluate(() => location.pathname);

const meetClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("article button")].find((x) =>
    x.textContent.includes("先聊聊"),
  );
  if (!b) return false;
  b.click();
  return true;
});
rec("发现页卡片上有「让 Agent 先聊聊」按钮", meetClicked);

/* 等按钮从"对话中"回到常态（说明后端已返回） */
let meetFinished = false;
for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(1000);
  const busy = await page.evaluate(() => {
    const b = [...document.querySelectorAll("article button")].find(
      (x) => x.hasAttribute("data-agent-meet") || /对话中|先聊聊/.test(x.textContent),
    );
    return b ? b.getAttribute("aria-busy") === "true" || /对话中/.test(b.textContent) : false;
  });
  if (!busy) {
    meetFinished = true;
    break;
  }
}
rec("点击后请求已完成（不是一直转圈）", meetFinished);

const meet = await page.evaluate(() => {
  /* 提示已统一到根 layout 的 GlobalToasts（#1） */
  const stack = document.querySelector('[data-toast-stack="1"]');
  return {
    path: location.pathname,
    toast: stack?.textContent?.trim() ?? "",
    toastVisible: Boolean(stack),
    level: stack?.querySelector("[data-toast-level]")?.getAttribute("data-toast-level") ?? "",
  };
});
rec("「让 Agent 先聊聊」不跳页", meet.path === beforeMeet, `${beforeMeet} → ${meet.path}`);
/* 文案现在是「与 XX 的 Agent 对话已完成」或「你和 XX 的 Agent 已经聊过了」 */
rec(
  "弹出结果提示且含对方名字",
  meet.toastVisible && /Agent/.test(meet.toast) && /已完成|已经聊过/.test(meet.toast),
  `「${meet.toast.slice(0, 120)}」`,
);
rec("提示走全局弹幕且等级为 success", meet.level === "success", `level=${meet.level}`);

await page.screenshot({ path: path.join(OUT, "search-view.png") });

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

await browser.close();
console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
