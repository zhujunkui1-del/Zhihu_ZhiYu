#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
// 登录页专项验证：结构完整、品牌资源、知乎蓝按钮、滚动进场、演示登录闭环
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const OUT = path.join(RECON_DIR, "web-login");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const errs = [];
const bad = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(900);

console.log("登录页验证");
console.log("=".repeat(78));

/* ① 六个区块都在 */
const sections = await page.evaluate(() =>
  ["login-hero", "concept", "how", "agent-chat", "quote", "cta-strip"].map((id) => ({
    id,
    ok: !!document.getElementById(id),
  })),
);
rec("六个区块齐全", sections.every((s) => s.ok),
  sections.map((s) => `${s.id}=${s.ok ? "有" : "缺"}`).join(" "));

/* ② 标题文案 */
const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? "");
rec("主标题正确", h1 === "在你认识一个人之前，让 Agent 先认识 TA。", `「${h1}」`);

/* ③ 品牌资源 */
const brand = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img[src*="/assets/"]')];
  const logo = imgs.find((i) => i.src.includes("/logo/"));
  const zhihu = imgs.find((i) => i.src.includes("zhihu-logo"));
  const chars = imgs.filter((i) => i.src.includes("/characters/"));
  return {
    logoOk: logo ? logo.complete && logo.naturalWidth > 0 : false,
    logoHasSrcset: logo ? !!logo.getAttribute("srcset") : false,
    zhihuOk: zhihu ? zhihu.complete && zhihu.naturalWidth > 0 : false,
    charCount: chars.length,
    charOk: chars.every((i) => i.complete && i.naturalWidth > 0),
  };
});
rec("logo 加载正常且带 srcset", brand.logoOk && brand.logoHasSrcset);
rec("知乎 logo 加载正常", brand.zhihuOk);
rec("角色插画加载正常", brand.charCount > 0 && brand.charOk, `${brand.charCount} 张`);

/* ④ 知乎授权按钮：必须是知乎品牌蓝 + 白字 */
const oauth = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("使用知乎账号登录"),
  );
  if (!btn) return null;
  const cs = getComputedStyle(btn);
  const r = btn.getBoundingClientRect();
  return {
    text: btn.textContent.trim(),
    color: cs.color,
    bgImage: cs.backgroundImage,
    border: cs.borderColor,
    width: Math.round(r.width),
    height: Math.round(r.height),
    glyphWhite: !!btn.querySelector('img[src*="zhihu-logo"]'),
  };
});
const isWhiteText = oauth && /rgb\(255,\s*255,\s*255\)/.test(oauth.color);
const isZhihuBlue = oauth && /0,\s*132,\s*255/.test(oauth.bgImage);
rec("登录按钮为知乎蓝底 + 白字", Boolean(isWhiteText && isZhihuBlue),
  oauth ? `color=${oauth.color} bg=${oauth.bgImage.slice(0, 60)}… 尺寸=${oauth.width}x${oauth.height} 白logo=${oauth.glyphWhite}` : "未找到按钮");

/* ⑤ 滚动进场：视口内的显现、视口外的仍隐藏，滚到后显现
   动画由 .revealBox 承担（.reveal 是布局中性壳 display: contents），
   所以量 .revealBox 的透明度。
   注意：IO 在 hydration 后约 350ms 就会把首屏元素显现，
   所以不能断言"初始 opacity=0"——那是错的预期。 */
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(1200);
const revealState = await page.evaluate(() => {
  const vh = window.innerHeight;
  const els = [...document.querySelectorAll(".revealBox")];
  const info = els.map((e) => {
    const r = e.getBoundingClientRect();
    return {
      inView: r.top < vh && r.bottom > 0,
      opacity: Number(getComputedStyle(e).opacity),
    };
  });
  return {
    total: info.length,
    inViewCount: info.filter((x) => x.inView).length,
    inViewAllShown: info.filter((x) => x.inView).every((x) => x.opacity > 0.9),
    belowFoldCount: info.filter((x) => !x.inView).length,
    belowFoldAllHidden: info.filter((x) => !x.inView).every((x) => x.opacity < 0.1),
  };
});
rec("进场动画：视口内的已显现、折叠线下的仍隐藏",
  revealState.inViewAllShown && revealState.belowFoldAllHidden && revealState.total > 0,
  `共 ${revealState.total} 个；视口内 ${revealState.inViewCount} 个全部显现=${revealState.inViewAllShown}；折叠线下 ${revealState.belowFoldCount} 个全部隐藏=${revealState.belowFoldAllHidden}`);

/* 逐屏下滚（模拟真实阅读），每屏都应触发对应的进场。
   注意不能直接 scrollIntoView 到底——那会跳过中间区块，
   它们从未进入视口，本就不该显现。 */
const steps = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const vh = window.innerHeight;
  const max = document.documentElement.scrollHeight - vh;
  const trace = [];
  for (let y = 0; y <= max; y += Math.round(vh * 0.6)) {
    window.scrollTo({ top: y, behavior: "instant" });
    await wait(320);
    const els = [...document.querySelectorAll(".revealBox")];
    trace.push({
      y,
      shown: els.filter((e) => Number(getComputedStyle(e).opacity) > 0.9).length,
      total: els.length,
    });
  }
  window.scrollTo({ top: max, behavior: "instant" });
  await wait(900);
  const els = [...document.querySelectorAll(".revealBox")];
  return {
    trace,
    finalShown: els.filter((e) => Number(getComputedStyle(e).opacity) > 0.9).length,
    total: els.length,
  };
});
rec("逐屏下滚后所有进场区块都已显现", steps.finalShown === steps.total,
  `滚动轨迹 ${steps.trace.map((t) => `${t.y}px:${t.shown}`).join(" → ")}；最终 ${steps.finalShown}/${steps.total}`);

/* 布局中性检查：Reveal 的壳必须不破坏父级 grid。
   这是实际踩过的坑——单层实现会让登录页两列 grid 退化成单列满宽。 */
const layout = await page.evaluate(() => {
  const grid = document.querySelector('[class*="loginInner"]');
  if (!grid) return null;
  const kids = [...grid.children];
  return {
    gridCols: getComputedStyle(grid).gridTemplateColumns,
    kidCount: kids.length,
    kidWidths: kids.map((k) => Math.round(k.getBoundingClientRect().width)),
    shellDisplay: kids.map((k) => getComputedStyle(k).display),
  };
});
rec("Reveal 壳不破坏父级 grid（两列仍成立）",
  Boolean(layout && layout.kidCount === 2 && layout.shellDisplay.every((d) => d === "contents")),
  layout
    ? `列=${layout.gridCols} 子元素=${layout.kidCount} 宽度=[${layout.kidWidths.join(", ")}] display=[${layout.shellDisplay.join(", ")}]`
    : "未找到容器");

/* ⑥ 五维报告条宽度 */
const bars = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="reportRow"]')];
  return rows.map((r) => {
    const fill = r.querySelector('[class*="trackFill"], .trackFill');
    return fill ? fill.style.width : null;
  });
});
rec("五维报告条渲染（91/84/88/79/94）",
  bars.length === 5 && bars.join(",") === "91%,84%,88%,79%,94%",
  bars.join(" "));

await page.screenshot({ path: path.join(OUT, "login-top.png") });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "login-hero.png") });
await page.evaluate(() => document.getElementById("how").scrollIntoView());
await page.waitForTimeout(1100);
await page.screenshot({ path: path.join(OUT, "login-how.png") });
await page.evaluate(() => document.getElementById("agent-chat").scrollIntoView());
await page.waitForTimeout(1100);
await page.screenshot({ path: path.join(OUT, "login-chat.png") });

/* ⑦ 演示登录闭环：真实点击 → 应落到 /home
   注意：页面有 scroll-behavior: smooth，scrollIntoView 会平滑滚动约 1s。
   必须在滚动**结束**后再取坐标，否则点在漂移途中的空位上。
   这里用 behavior:"instant" 彻底规避。 */
await page.evaluate(() => {
  try { localStorage.removeItem("zhiyu_demo"); } catch { /* ignore */ }
});
const btnBox = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("使用知乎账号登录"),
  );
  if (!btn) return null;
  btn.scrollIntoView({ block: "center", behavior: "instant" });
  const r = btn.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await page.waitForTimeout(500);
/* 取完坐标再复核一次：该点上命中的必须是按钮或其子元素 */
const hitCheck = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  const btn = el && el.closest ? el.closest("button") : null;
  return { hit: el ? `${el.tagName}.${String(el.className).split(/\s+/)[0]}` : "(null)", isButton: !!btn };
}, btnBox);
if (btnBox) {
  rec("点击坐标命中登录按钮", hitCheck.isButton, `命中 ${hitCheck.hit}`);

  /* 先问服务端 OAuth 配置状态 —— 登录按钮的行为取决于它：
       · 已配置 → 跳到知乎授权（最终落到 zhihu.com/signin 或 openapi.zhihu.com）
       · 未配置 → 非生产环境走演示登录，落 /home
     只断言"未配置"那一支会让配好 OAuth 后误报失败（实际踩到过）。 */
  const oauthOn = await page.evaluate(async () => {
    try {
      const r = await fetch("/api/auth/session").then((x) => x.json());
      return r?.oauthConfigured === true;
    } catch {
      return false;
    }
  });

  await page.mouse.move(btnBox.x, btnBox.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => ({
    path: location.pathname,
    host: location.host,
    href: location.href,
    stored: (() => { try { return localStorage.getItem("zhiyu_demo"); } catch { return null; } })(),
  }));

  if (oauthOn) {
    rec("已配置 OAuth → 点击登录跳转到知乎授权流程",
      /zhihu\.com/.test(after.host),
      `落点 ${after.host}${after.path}`);
    rec("（已配置 OAuth 时不写演示 localStorage，符合预期）",
      !after.stored, after.stored ? "仍写了演示数据" : "无演示数据 ✓");
  } else {
    rec("未配置 OAuth → 点击登录走演示登录，落 /home",
      after.path === "/home", `落点 ${after.path}`);
    rec("演示会话已写入 localStorage", Boolean(after.stored),
      after.stored ? after.stored.slice(0, 60) : "无");
  }
  await page.screenshot({ path: path.join(OUT, "after-login.png") });
} else {
  rec("真实点击登录", false, "未找到按钮");
}

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
rec("无资源 404", bad.length === 0, [...new Set(bad)].slice(0, 4).join(" | "));

await browser.close();
console.log("=".repeat(78));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
console.log(`截图 → RECON/web-login/`);
process.exit(fail ? 1 : 0);
