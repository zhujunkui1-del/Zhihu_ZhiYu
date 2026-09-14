#!/usr/bin/env node
/**
 * 侧栏用户身份（#8 需求）验证。
 *
 * 需求：侧栏「设置」上方显示用户知乎头像 + 名称（圆形头像 + 名称，无交互）；
 * 抓不到则用 assets/characters 随机图 + 随机用户名 zhiyu000000。
 *
 * 所以这里要验五件事：
 *   ① 位置在「设置」上面（不是下面、不是别处）
 *   ② 头像是圆形、图片真的加载成功（naturalWidth > 0，不是裂图）
 *   ③ 名称非空且渲染出来了
 *   ④ **无交互** —— 没有 hover 指针、不是链接/按钮
 *   ⑤ 兜底时名字形如 zhiyu + 6 位、头像来自 /assets/characters/
 * 另外验证兜底是**稳定的**（刷新两次拿到同一个名字/头像）。
 *
 * 用法：node scripts/verify-sidebar-user.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const OUT = path.resolve("../RECON/web-sidebar");
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message || e)));
page.on("console", (m) => {
  if (m.type() === "error") errs.push(m.text());
});
const bad = [];
page.on("response", (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
});

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

/** 读侧栏用户块 */
const readUser = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-side-user="1"]');
    if (!el) return null;
    const img = el.querySelector("img");
    const nameEl = el.querySelector("span:last-of-type");
    const r = el.getBoundingClientRect();
    const settingsLink = [...document.querySelectorAll("a")].find((a) =>
      a.getAttribute("href") === "/settings",
    );
    const sr = settingsLink?.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      name: nameEl?.textContent?.trim() ?? "",
      imgSrc: img?.getAttribute("src") ?? "",
      naturalWidth: img?.naturalWidth ?? 0,
      naturalHeight: img?.naturalHeight ?? 0,
      complete: img?.complete ?? false,
      radius: img ? getComputedStyle(img.parentElement).borderRadius : "",
      cursor: cs.cursor,
      pointerEvents: cs.pointerEvents,
      tag: el.tagName,
      links: el.querySelectorAll("a").length,
      buttons: el.querySelectorAll("button").length,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      settingsTop: sr ? Math.round(sr.top) : null,
    };
  });

/* ── 建立会话并打开首页 ─────────────────────────────────────────────── */
console.log("\n== 打开首页 ==");
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(1500);
const loginOk = await page.evaluate(async () => {
  const r = await fetch("/api/auth/demo", { method: "POST" });
  return r.ok || r.status === 403;
});
rec("演示登录可用", loginOk);

await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2600);

const u = await readUser();
rec("侧栏有用户身份块", Boolean(u), u ? `${u.tag}` : "未找到 [data-side-user]");

if (!u) {
  console.log("\n无法继续，退出。");
  await browser.close();
  process.exit(1);
}

console.log("\n== 位置与外观 ==");
rec(
  "在「设置」上方",
  u.settingsTop !== null && u.bottom <= u.settingsTop + 2,
  `用户块 bottom=${u.bottom}，设置 top=${u.settingsTop}`,
);
rec("头像是圆形", /50%|9999px|999px/.test(u.radius), `border-radius=${u.radius}`);
rec(
  "头像图片真的加载出来了",
  u.complete && u.naturalWidth > 0,
  `naturalWidth=${u.naturalWidth} src=${u.imgSrc}`,
);
rec("名称非空", u.name.length > 0, `name="${u.name}"`);

console.log("\n== 无交互 ==");
rec("不是链接也不是按钮", u.links === 0 && u.buttons === 0, `links=${u.links} buttons=${u.buttons}`);
rec("没有手型光标（不暗示可点）", u.cursor !== "pointer", `cursor=${u.cursor}`);

console.log("\n== 兜底数据形态 ==");
const isGenerated = u.imgSrc.startsWith("/assets/characters/");
rec(
  "已授权用户显示知乎头像（pic*.zhimg.com）",
  u.imgSrc.includes("zhimg.com") || isGenerated,
  isGenerated
    ? `（本次是兜底：${u.imgSrc}）`
    : `知乎头像：${u.imgSrc.slice(0, 70)}`,
);
if (isGenerated) {
  rec("兜底头像来自 assets/characters", true, u.imgSrc);
  rec(
    "兜底用户名形如 zhiyu + 6 位字母数字",
    /^zhiyu[a-z0-9]{6}$/.test(u.name),
    `name="${u.name}"`,
  );
} else {
  rec(
    "知乎授权用户显示真实名称（不是 zhiyu 随机名）",
    !/^zhiyu[a-z0-9]{6}$/.test(u.name),
    `name="${u.name}"`,
  );
}

/* ── 稳定性：兜底不能每次刷新都换人 ─────────────────────────────────── */
console.log("\n== 兜底稳定性（重新加载两次应一致）==");
const first = { name: u.name, src: u.imgSrc };
/* 注意：本项目的 playwright 包装器没有 page.reload，用 goto 同一地址重载 */
await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2400);
const u2 = await readUser();
rec(
  "重新加载后名称与头像不变（同一人不换脸）",
  u2 && u2.name === first.name && u2.imgSrc === first.src,
  u2
    ? `${first.name}/${first.src.split("/").pop()} → ${u2.name}/${u2.imgSrc.split("/").pop()}`
    : "读取失败",
);

/* ── 别的页面也有 ───────────────────────────────────────────────────── */
console.log("\n== 其他页面同样显示 ==");
await page.goto(`${BASE}/find`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2600);
const u3 = await readUser();
rec("发现页侧栏也有用户身份", Boolean(u3) && u3.name.length > 0, u3 ? u3.name : "未找到");

/* ── 窄屏（顶栏形态）不溢出 ─────────────────────────────────────────── */
/* 包装器没有 page.setViewportSize，单独开一个 390px 宽的页面来验窄屏 */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await mobile.waitForTimeout(2600);
const narrow = await mobile.evaluate(() => {
  const el = document.querySelector('[data-side-user="1"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    width: Math.round(r.width),
    name: el.querySelector("span:last-of-type")?.textContent?.trim() ?? "",
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
});
rec(
  "窄屏不产生横向溢出",
  narrow !== null && !narrow.overflowX,
  narrow ? `用户块宽 ${narrow.width}px，溢出=${narrow.overflowX}，名称=${narrow.name}` : "未找到",
);
await mobile.screenshot({ path: path.join(OUT, "sidebar-user-mobile.png") });
await mobile.close();

await page.goto(`${BASE}/home`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2400);
await page.screenshot({ path: path.join(OUT, "sidebar-user.png") });

rec("无 JS 报错", errs.length === 0, errs.slice(0, 3).join(" | "));
const img404 = bad.filter((b) => /\.(webp|png|jpg|jpeg)/.test(b));
rec("无头像/图片 404", img404.length === 0, [...new Set(img404)].slice(0, 3).join(" | ") || "无");

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
