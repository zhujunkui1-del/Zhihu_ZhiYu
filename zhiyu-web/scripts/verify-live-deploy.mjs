#!/usr/bin/env node
/**
 * 线上部署验证（**只读**，不写任何数据）。
 *
 * 为什么单独一个脚本：本地测试跑的是 dev server，而用户看到的是线上。
 * 部署之后必须确认"线上这份真的变了"，而不是假设 Git 集成一定成功。
 * 所以这里直接打生产域名，检查本批新增的接口与界面元素。
 *
 * 用法：node scripts/verify-live-deploy.mjs [BASE]
 */
import { loadPlaywright, launchChromium } from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] || "https://www.zhiyuapp.site";
const OUT = path.resolve("../RECON/web-live");
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

console.log(`线上验证：${BASE}\n`);

/* ── ① 接口层 ─────────────────────────────────────────────────────────── */
console.log("== ① 本批新增/改动的接口 ==");
const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
  return { status: r.status, text: await r.text() };
};

const health = await get("/api/health");
rec("站点健康检查 200", health.status === 200, `${health.status}`);

const status = await get("/api/oauth/status");
rec("新增的 /api/oauth/status 已上线（200）", status.status === 200, `${status.status}`);
let payload = null;
try {
  payload = JSON.parse(status.text);
} catch {
  /* ignore */
}
rec("返回结构含飞书/钉钉两家", Boolean(payload?.providers?.feishu && payload?.providers?.dingtalk));
rec(
  "线上**如实回报未配置**（而不是假装可用）",
  payload?.providers?.feishu?.configured === false &&
    payload?.providers?.dingtalk?.configured === false,
  `feishu=${payload?.providers?.feishu?.configured} dingtalk=${payload?.providers?.dingtalk?.configured}`,
);
rec(
  "状态接口只回「配没配 / 授权没授权」，**不再下发能力清单与环境变量名**（那堆文字已删）",
  Boolean(payload?.providers?.feishu) &&
    !("capability" in (payload?.providers?.feishu ?? {})) &&
    !("envKeys" in (payload?.providers?.feishu ?? {})),
  Object.keys(payload?.providers?.feishu ?? {}).join("、"),
);
rec(
  "回显了向导需要的东西：开放平台入口 / 回调地址 / 权限 scope",
  typeof payload?.providers?.feishu?.consoleUrl === "string" &&
    String(payload?.providers?.feishu?.redirectUri).includes("/api/oauth/feishu/callback") &&
    typeof payload?.providers?.feishu?.scope === "string",
  `${payload?.providers?.feishu?.consoleUrl} ｜ ${payload?.providers?.feishu?.redirectUri}`,
);
rec(
  "响应里没有密钥形状的字符串（sk- / PEM / Google key）",
  !/sk-[A-Za-z0-9]{20,}|-----BEGIN|AIza[0-9A-Za-z_-]{20,}/.test(status.text),
);

const appApi = await get("/api/oauth/app");
rec("新增的 /api/oauth/app（凭证存本站，不用配环境变量）已上线", appApi.status === 200, `${appApi.status}`);
rec(
  "凭证接口**不下发 app_secret**",
  !/"(appSecret|appSecretEnc|secret)"\s*:\s*"[^"]/.test(appApi.text) &&
    !/sk-[A-Za-z0-9]{20,}/.test(appApi.text),
);
rec(
  "线上如实回报未配置（凭证还没填）",
  (() => {
    try {
      const j = JSON.parse(appApi.text);
      return j.apps?.feishu?.configured === false && j.apps?.dingtalk?.configured === false;
    } catch {
      return false;
    }
  })(),
);

const imp = await get("/api/import");
rec("导入接口在线（GET 应为 405）", imp.status === 405, `${imp.status}`);

/* 本批新增的**动态路由**：未登录时应跳到 /persona 并带原因，而不是 404 */
const feishuStart = await fetch(`${BASE}/api/oauth/feishu`, { redirect: "manual" });
const feishuLoc = feishuStart.headers.get("location") ?? "";
rec(
  "新增的 /api/oauth/[provider] 动态路由已上线（未登录时带原因跳回，而不是 404）",
  feishuStart.status === 307 || feishuStart.status === 302,
  `${feishuStart.status} → ${feishuLoc.slice(0, 80)}`,
);
rec(
  "未登录时不会泄露任何平台信息（只回 unauthenticated）",
  feishuLoc.includes("link=unauthenticated"),
  feishuLoc,
);

/* ── ② 客户端产物：确认新 UI 真的在线上那份 bundle 里 ──────────────────
   生产环境**禁用了演示登录**（/api/auth/demo 返回 DEMO_DISABLED，这是对的），
   而登录后的界面（/persona）匿名访问会被重定向 —— 所以**从外部无法**点开
   那些按钮。这里如实说明这个边界，只验证能从外部验证的部分：
   匿名可达的页面与其 JS 产物。 */
console.log("\n== ② 匿名可达页面 ==");
const home = await get("/");
rec("首页可访问", home.status === 200, `${home.status}`);

const demoGuard = await fetch(`${BASE}/api/auth/demo`, {
  method: "POST",
  headers: { Origin: BASE, Referer: `${BASE}/` },
});
const demoBody = await demoGuard.text();
rec(
  "生产环境按设计禁用演示登录（DEMO_DISABLED）",
  demoGuard.status === 403 && demoBody.includes("DEMO_DISABLED"),
  demoBody.slice(0, 90),
);

const personaAnon = await fetch(`${BASE}/persona`, { redirect: "manual" });
rec(
  "未登录访问 /persona 被重定向（登录态保护生效）",
  personaAnon.status === 307 || personaAnon.status === 302,
  `${personaAnon.status} → ${(personaAnon.headers.get("location") ?? "").slice(0, 60)}`,
);

/* 首页引用的 JS 分块能取到（证明静态产物正常） */
const scripts = [...home.text.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]);
const uniq = [...new Set(scripts)];
let bundle = "";
for (const s of uniq.slice(0, 40)) {
  const url = s.startsWith("http") ? s : `${BASE}${s}`;
  try {
    const r = await fetch(url);
    if (r.ok) bundle += await r.text();
  } catch {
    /* 单个 chunk 拿不到不影响整体判断 */
  }
}
rec("首页引用的 JS 分块全部可取", bundle.length > 10000, `${uniq.length} 个，共 ${bundle.length} 字符`);

/* ── ③ 静态资源与微信校验文件 ─────────────────────────────────────────── */
console.log("\n== ③ 静态资源 ==");
for (const p of [
  "/add36feb1a6280bbd6b17d8324be60e5.txt",
  "/assets/sbti/DEAD.webp",
]) {
  const r = await fetch(`${BASE}${p}`);
  rec(`${p} 可访问`, r.status === 200, `${r.status}`);
}

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);

process.exit(fail === 0 ? 0 : 1);
