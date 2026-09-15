#!/usr/bin/env node
/* 产物目录：固定指向**仓库根**的 RECON/（该目录被 .gitignore 忽略，只放本地截图与抓取物）。
   本脚本在 zhiyu-web/scripts/recon/ 下，所以从 import.meta.url 推仓库根 —— 与运行时的 cwd 无关。 */
import __path from "node:path";
import { fileURLToPath as __furl } from "node:url";
const RECON_DIR = __path.resolve(__path.dirname(__furl(import.meta.url)), "../../..", "RECON");
/**
 * 验证「旧前端 → 手绘纸感主题」改造结果。
 *
 * 检查项：
 *   1. 无 console 错误 / 无 page error
 *   2. 无资源 404（主题层、头像插画、纹理、木牌）
 *   3. 主题确实生效：计算样式里 --bg / --accent / --fg 等于新 token
 *   4. 旧蓝色 #0d64fd / #eef3fc 不再作为实际渲染色出现
 *   5. 侧栏品牌位不再残留 webp logo 占位
 *   6. 木牌插画、角色头像插画真实加载
 *   7. 逐页截图
 */
import fs from "node:fs";
import path from "node:path";
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = "http://127.0.0.1:4188/";
const OUT = path.join(RECON_DIR, "reskin-verify");
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  "zhiyu-login.html",
  "zhiyu-home.html",
  "zhiyu-find.html",
  "zhiyu-persona.html",
  "zhiyu-agent-match.html",
  "zhiyu-notify.html",
  "zhiyu-settings.html",
];

/* 新 token 期望值（小写、去空格后比较） */
const EXPECT = {
  "--bg": "#f8f0df",
  "--accent": "#e2664f",   /* 暖珊瑚主色（蓝色只留给知乎品牌入口） */
  "--fg": "#381508",
  "--muted": "#8a6047",
};
/* 旧调色板：不应再出现在任何已解析的计算值里 */
const FORBIDDEN = ["#0d64fd", "#eef3fc", "#16263f", "#5d6c88", "#d7e1f1"];
/* 暖化后的主色 RGB（珊瑚）与知乎品牌蓝 RGB */
const WARM_RGB = "226,102,79";
const ZHIHU_RGB = "0,132,255";

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const rows = [];
const failures = [];

for (const file of PAGES) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const pageErrors = [];
  const failed = [];

  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on("requestfailed", (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  await page.goto(BASE + file, { waitUntil: "load" });
  // 等头像运行时（MutationObserver + rAF）跑完
  await page.waitForTimeout(700);

  // 页面自带「滚动显现」动画（.reveal 初始 opacity:0，由 IntersectionObserver 触发）。
  // 不滚动就截图会把未进入视口的区块拍成空白——这里完整滚到底并留足触发时间，
  // 顺便也算验证了该交互在新主题下依然工作。
  // 注意：必须【停留】足够时间让 IntersectionObserver 回调跑完，不能滚完立刻归零。
  const revealInfo = await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.5);
    const max = document.documentElement.scrollHeight;
    for (let y = 0; y <= max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 140));
    }
    window.scrollTo(0, max);
    await new Promise((r) => setTimeout(r, 500));
    const all = [...document.querySelectorAll(".reveal")];
    const hidden = all.filter((e) => getComputedStyle(e).opacity === "0");
    return {
      total: all.length,
      stillHidden: hidden.length,
      hiddenSel: hidden.map(
        (e) => e.tagName.toLowerCase() + "." + String(e.className).replace("reveal", "").trim().split(/\s+/)[0],
      ),
    };
  });
  // 回到顶部再截图，保留正常的"页面首屏"观感
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);

  const probe = await page.evaluate(({ expect, forbidden }) => {
    const cs = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const k of Object.keys(expect)) tokens[k] = cs.getPropertyValue(k).trim().toLowerCase();

    const bodyCS = getComputedStyle(document.body);
    const bodyBg = bodyCS.backgroundColor;

    // 主题层是否真的被加载并生效
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href"));

    // 是否还有旧的 webp logo 节点
    const oldLogos = document.querySelectorAll('img[src^="data:image/webp"]').length;

    // 头像插画：统计有多少个已上色 + 实际加载成功的图片资源
    const avatars = [...document.querySelectorAll("[data-avatar]")];
    const avatarNames = {};
    avatars.forEach((a) => {
      const n = a.getAttribute("data-avatar");
      avatarNames[n] = (avatarNames[n] || 0) + 1;
    });
    const avatarsWithBg = avatars.filter((a) => {
      const bg = getComputedStyle(a).backgroundImage;
      return bg && bg.includes("/assets/characters/");
    }).length;

    // 木牌插画
    const signboard = document.querySelector('.side-story img');
    const signboardOk = signboard
      ? signboard.complete && signboard.naturalWidth > 0
      : null;

    // 真正要检查的是【实际渲染出来的颜色】，而不是 :root 里的旧定义
    // （旧 token 定义必须留在页面自带 <style> 里，我们只在上层覆盖它）
    const toHex = (v) => {
      const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v || "");
      if (!m) return v;
      return (
        "#" +
        [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("")
      );
    };
    const renderedColors = new Set();
    for (const el of document.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      for (const prop of ["color", "backgroundColor", "borderTopColor", "borderLeftColor", "outlineColor"]) {
        const v = s[prop];
        if (!v || v === "rgba(0, 0, 0, 0)" || v === "transparent") continue;
        renderedColors.add(toHex(v));
      }
    }
    const allRendered = [...renderedColors].join(" ");
    const leaks = forbidden.filter((c) => allRendered.includes(c));

    // 主要板块是否存在（功能未被破坏的粗检）
    const structure = {
      sidebar: !!document.querySelector(".sidebar"),
      navItems: document.querySelectorAll(".nav-item").length,
      panels: document.querySelectorAll(".panel, .card, .persona-card, .acard, .n-card, .s-card, .src-card").length,
      modals: document.querySelectorAll(".modal").length,
      radar: document.querySelectorAll(".modal-radar, .radar-wrap, .pr-shell").length,
      sideStory: !!document.querySelector(".side-story"),
    };

    /* ── 本轮修复项断言 ─────────────────────────────────────────────── */

    // 品牌 logo：illustration 位图（双气泡 + 刘看山），必须真的加载成功
    // 注意：OAuth 浮层里的 logo 在浮层未打开时宽高为 0，属正常，断言时排除隐藏元素。
    const brandLogos = [...document.querySelectorAll(".brand-logo")];
    const brandLogoState = brandLogos.map((i) => {
      const r = i.getBoundingClientRect();
      const src = i.getAttribute("src") || "";
      return {
        src,
        isBitmap: src.startsWith("./assets/logo/logo-"),
        loaded: i.complete && i.naturalWidth > 0,
        naturalW: i.naturalWidth,
        hasSrcset: !!i.getAttribute("srcset"),
        w: Math.round(r.width),
        visible: r.width > 1 && r.height > 1,
      };
    });

    // favicon 也应指向 logo 位图档
    const faviconHref = document.querySelector('link[rel="icon"]')?.getAttribute("href") || "";

    // 2) 知乎授权入口必须是知乎品牌蓝 + 白字（品牌色不可改）
    const oauth = document.getElementById("oauth-trigger");
    const oauthState = oauth
      ? (() => {
          const cs = getComputedStyle(oauth);
          return {
            bgImage: cs.backgroundImage,
            color: cs.color,
            hasZhihuBlue: cs.backgroundImage.includes("0, 132, 255") || cs.backgroundColor.includes("0, 132, 255"),
            colorIsWhite: /rgb\(255,\s*255,\s*255\)/.test(cs.color),
          };
        })()
      : null;

    // 3) 暖化抽查：主按钮 / 选中导航 / 进度条 / 雷达图 / 通知未读标记
    const warmSample = {};
    const grab = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    warmSample.primaryBtn = grab(".btn-primary", "backgroundImage");
    warmSample.activeNav = grab(".nav-item.active", "backgroundImage");
    warmSample.track = grab(".track i", "backgroundImage");
    warmSample.radar = grab(".modal-radar .mval", "stroke") || grab(".pr-shell .pr-val", "stroke");
    warmSample.unreadDot = grab(".unread-dot, .kdot", "backgroundColor");

    // 4) 蒸馏面板：被加了边框的列表容器必须同时有内边距（否则文字挤出边框）
    const boxed = [".run-req", ".stage-list"]
      .map((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          sel,
          borderW: parseFloat(cs.borderTopWidth) || 0,
          padTop: parseFloat(cs.paddingTop) || 0,
          padBottom: parseFloat(cs.paddingBottom) || 0,
        };
      })
      .filter(Boolean);

    /* 5) 相遇雷达（仅发现页）：组件就位、切换器存在、无重叠。
       重叠检查用真实包围盒，因为标签宽度随文字变化，光看布局参数不够。 */
    let radarState = null;
    if (document.querySelector('[data-view-seg="search"]')) {
      const seg = document.querySelector('[data-view-seg="search"]');
      const radarBtn = seg.querySelector('button[data-view="radar"]');
      let nodes = [];
      if (radarBtn) {
        radarBtn.click();
        const stage = document.getElementById("radar-search");
        nodes = stage ? [...stage.querySelectorAll(".radar-node")] : [];
      }
      const boxes = nodes.map((n) => {
        const a = n.querySelector(".radar-avatar").getBoundingClientRect();
        const c = n.querySelector(".radar-card").getBoundingClientRect();
        return {
          left: Math.min(a.left, c.left), right: Math.max(a.right, c.right),
          top: Math.min(a.top, c.top), bottom: Math.max(a.bottom, c.bottom),
        };
      });
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const ox = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left);
          const oy = Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top);
          if (ox > 1 && oy > 1) overlaps += 1;
        }
      }
      radarState = {
        segExists: true,
        componentLoaded: typeof window.ZhiyuRadar === "object",
        nodes: nodes.length,
        overlaps,
        avatarsOk: nodes.every((n) => {
          const i = n.querySelector(".radar-avatar img");
          return i && i.complete && i.naturalWidth > 0;
        }),
        hasMe: !!document.querySelector("#radar-search .radar-me"),
        hasTools: !!document.querySelector("#radar-search .radar-tools"),
      };
      // 切回卡片，避免影响后续断言
      const gridBtn = seg.querySelector('button[data-view="grid"]');
      if (gridBtn) gridBtn.click();
    }

    /* 6) 设置页：每行的控件应与该行「标题行」中线齐平。
       踩过的坑：.s-row 两列各自居中于整行，而左列含标题 + 多行说明，
       控件因此比标题低 27px（26px 开关）/ 11px（44px 按钮），看着像错位。 */
    let alignState = null;
    if (document.querySelector(".s-row .s-ctl")) {
      const rows = [...document.querySelectorAll(".s-row")]
        .map((row) => {
          const h3 = row.querySelector(".s-body h3");
          const ctl = row.querySelector(".s-ctl");
          if (!h3 || !ctl) return null;
          const target = ctl.querySelector(".switch, .btn");
          if (!target) return null;
          const hr = h3.getBoundingClientRect();
          const tr = target.getBoundingClientRect();
          return {
            title: h3.textContent.trim().slice(0, 16),
            delta: Math.round(tr.top + tr.height / 2 - (hr.top + hr.height / 2)),
          };
        })
        .filter(Boolean);
      alignState = {
        rows: rows.length,
        worst: rows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0),
        detail: rows.map((r) => `${r.title}=${r.delta}`).join(" "),
      };
    }

    return {
      tokens, bodyBg, links, oldLogos, avatarTotal: avatars.length, avatarsWithBg,
      avatarNames, signboardOk, leaks, structure,
      bodyBgImage: bodyCS.backgroundImage.includes("paper.png"),
      brandLogoState, faviconHref, oauthState, warmSample, boxed, radarState, alignState,
    };
  }, { expect: EXPECT, forbidden: FORBIDDEN });

  const problems = [];
  for (const [k, want] of Object.entries(EXPECT)) {
    const got = (probe.tokens[k] || "").replace(/\s+/g, "");
    if (got !== want) problems.push(`token ${k} = ${got || "(空)"}，期望 ${want}`);
  }
  if (!probe.links.some((h) => h && h.includes("zhiyu-theme.css"))) problems.push("主题层未被加载");
  if (!probe.bodyBgImage) problems.push("纸纹背景未生效");
  if (probe.oldLogos > 0) problems.push(`仍残留 ${probe.oldLogos} 个旧 webp logo`);
  if (probe.leaks.length) problems.push(`页面残留旧色值字面量: ${probe.leaks.join(",")}`);
  if (probe.signboardOk === false) problems.push("木牌插画加载失败");

  // 品牌 logo：可见的那些必须真的加载成功，且用的是多档位图 + srcset
  const visibleLogos = probe.brandLogoState.filter((l) => l.visible);
  if (!visibleLogos.length) {
    problems.push("未找到可见的品牌 logo");
  }
  const badLogo = visibleLogos.find((l) => !l.loaded || l.naturalW < 32 || l.w < 8);
  if (badLogo) problems.push(`品牌 logo 未正常加载: ${JSON.stringify(badLogo)}`);
  const notBitmap = visibleLogos.find((l) => !l.isBitmap);
  if (notBitmap) problems.push(`品牌 logo 未指向位图档: ${notBitmap.src}`);
  const noSrcset = visibleLogos.find((l) => !l.hasSrcset);
  if (noSrcset) problems.push(`品牌 logo 缺少 srcset（高 DPI 会糊）: ${noSrcset.src}`);

  // favicon 必须指向 logo 位图档
  if (!probe.faviconHref.includes("assets/logo/logo-")) {
    problems.push(`favicon 未指向 logo 位图档: ${probe.faviconHref}`);
  }

  // 相遇雷达（仅发现页）
  if (probe.radarState) {
    const r = probe.radarState;
    if (!r.componentLoaded) problems.push("相遇雷达组件未加载（window.ZhiyuRadar 缺失）");
    if (r.nodes < 1) problems.push("相遇雷达没有渲染任何节点");
    if (r.overlaps > 0) problems.push(`相遇雷达存在 ${r.overlaps} 组节点重叠`);
    if (!r.avatarsOk) problems.push("相遇雷达有头像未加载");
    if (!r.hasMe) problems.push("相遇雷达缺少中心「我」");
    if (!r.hasTools) problems.push("相遇雷达缺少缩放/平移控件");
  }

  // 设置页：行控件与标题行中线对齐（容差 3px）
  if (probe.alignState) {
    if (probe.alignState.worst > 3) {
      problems.push(
        `设置页行控件与标题未对齐，最大偏差 ${probe.alignState.worst}px（阈值 3px）→ ${probe.alignState.detail}`,
      );
    }
  }

  // 知乎授权入口：必须仍是知乎品牌蓝 + 白字
  if (probe.oauthState) {
    if (!probe.oauthState.hasZhihuBlue) problems.push(`知乎登录按钮丢失品牌蓝: ${probe.oauthState.bgImage}`);
    if (!probe.oauthState.colorIsWhite) problems.push(`知乎登录按钮文字非白色: ${probe.oauthState.color}`);
  }

  // 暖化：主按钮 / 选中导航 / 进度条 / 雷达图 / 未读标记不得再是冷蓝
  for (const [k, v] of Object.entries(probe.warmSample)) {
    if (!v) continue;
    if (v.includes("52, 140, 255") || v.includes("52,140,255")) {
      problems.push(`暖化未覆盖 ${k}: 仍是冷蓝 ${v.slice(0, 60)}`);
    }
  }

  // 加了边框的列表容器必须同时有内边距，否则文字挤出边框
  for (const b of probe.boxed) {
    if (b.borderW > 0 && (b.padTop < 6 || b.padBottom < 6)) {
      problems.push(`${b.sel} 有边框但内边距不足（上 ${b.padTop} / 下 ${b.padBottom}），内容会压线`);
    }
  }

  if (revealInfo.total > 0 && revealInfo.stillHidden > 0) {
    problems.push(
      `滚动显现未触发：${revealInfo.stillHidden}/${revealInfo.total} 仍不可见 → ${revealInfo.hiddenSel.join(", ")}`,
    );
  }
  if (consoleErrors.length) problems.push(`console 错误 ${consoleErrors.length} 条`);
  if (pageErrors.length) problems.push(`page error ${pageErrors.length} 条`);
  if (failed.length) problems.push(`资源加载失败 ${failed.length} 条`);

  await page.screenshot({ path: path.join(OUT, file.replace(".html", ".png")), fullPage: true });
  await page.close();

  rows.push({ file, problems, probe, revealInfo, consoleErrors, pageErrors, failed });
  if (problems.length) failures.push({ file, problems, consoleErrors, pageErrors, failed });
}

await browser.close();

/* ── 报告 ─────────────────────────────────────────────────────────────── */
console.log("改造验证报告");
console.log("=".repeat(78));
for (const r of rows) {
  const p = r.probe;
  console.log(`\n${r.file}`);
  console.log(`  主题: bg=${p.tokens["--bg"]} accent=${p.tokens["--accent"]} fg=${p.tokens["--fg"]}  纸纹=${p.bodyBgImage ? "有" : "无"}`);
  console.log(`  侧栏: ${p.structure.sidebar ? "有" : "无"}  导航项=${p.structure.navItems}  卡片=${p.structure.panels}  弹窗=${p.structure.modals}  雷达容器=${p.structure.radar}  木牌=${p.structure.sideStory ? "有" : "无"}`);
  console.log(`  头像: ${p.avatarsWithBg}/${p.avatarTotal} 已上色  ${JSON.stringify(p.avatarNames)}`);
  if (p.brandLogoState.length) {
    console.log(`  Logo: ${p.brandLogoState.map((l) => `${l.src.split("/").pop()}=${!l.visible ? "隐藏" : l.loaded ? "OK" : "破图"}(w${l.w})`).join(" ")}`);
  }
  if (p.oauthState) {
    console.log(`  知乎登录: 品牌蓝=${p.oauthState.hasZhihuBlue ? "是" : "否"} 白字=${p.oauthState.colorIsWhite ? "是" : "否"}`);
  }
  console.log(`  暖化抽查: ${Object.entries(p.warmSample).filter(([, v]) => v).map(([k, v]) => `${k}=${String(v).includes("226, 102, 79") ? "暖" : "其他"}`).join(" ")}`);
  if (p.boxed.length) {
    console.log(`  列表盒内边距: ${p.boxed.map((b) => `${b.sel}(框${b.borderW}/上${b.padTop}/下${b.padBottom})`).join(" ")}`);
  }
  if (p.radarState) {
    const r = p.radarState;
    console.log(`  相遇雷达: ${r.nodes} 节点 / 重叠 ${r.overlaps} 组 / 头像${r.avatarsOk ? "OK" : "异常"} / 中心我=${r.hasMe} / 控件=${r.hasTools}`);
  }
  if (p.alignState) {
    console.log(`  行控件对齐: ${p.alignState.rows} 行，最大偏差 ${p.alignState.worst}px`);
  }
  if (r.revealInfo.total > 0) {
    console.log(`  滚动显现: ${r.revealInfo.total - r.revealInfo.stillHidden}/${r.revealInfo.total} 已显现`);
  }
  console.log(`  报错: console=${r.consoleErrors.length} page=${r.pageErrors.length} 资源失败=${r.failed.length}`);
  if (r.problems.length) {
    console.log(`  ✗ ${r.problems.length} 个问题:`);
    for (const x of r.problems) console.log(`      - ${x}`);
    for (const x of r.consoleErrors.slice(0, 3)) console.log(`      console: ${x.slice(0, 160)}`);
    for (const x of r.pageErrors.slice(0, 3)) console.log(`      pageerror: ${x.slice(0, 160)}`);
    for (const x of r.failed.slice(0, 5)) console.log(`      resource: ${x.slice(0, 160)}`);
  } else {
    console.log("  ✓ 通过");
  }
}

console.log("\n" + "=".repeat(78));
console.log(failures.length ? `${failures.length}/${rows.length} 个页面存在问题` : `全部 ${rows.length} 个页面通过`);
process.exit(failures.length ? 1 : 0);
