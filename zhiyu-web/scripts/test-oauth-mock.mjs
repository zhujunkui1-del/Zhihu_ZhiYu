#!/usr/bin/env node
/**
 * 知乎 OAuth 协议层 Mock 测试（不发真实网络请求）。
 *
 * 为什么必须 Mock：真实 OAuth 需要 App ID/Key 与公网 HTTPS 回调，
 * 两者都要等赛事页面与部署。但**协议层逻辑（协议偏差、state 生命周期、
 * uid 精度、成功判定）现在就能验证**，而且这些正是最容易写错的地方。
 *
 * 用法：node --env-file=.env scripts/test-oauth-mock.mjs
 *      （不依赖数据库；纯协议层）
 */
import {
  buildAuthorizeUrl,
  extractCode,
  exchangeToken,
  fetchProfile,
  isConfigured,
  newSessionToken,
  newState,
  parseLosslessUid,
  validateConfig,
  readConfigFromEnv,
  ZhihuOAuthError,
} from "../lib/auth/zhihu-oauth.ts";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

/** 造一个假的 fetch：记录请求，返回预设响应 */
function mockFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { impl, calls };
}

const CFG = {
  appId: "app_abc123",
  appKey: "key_0123456789abcdef",
  redirectUri: "https://zhiyu.example.com/api/auth/zhihu/callback",
};

console.log("知乎 OAuth 协议层 Mock 测试");
console.log("=".repeat(80));

/* ── ① 配置与误配检测 ──────────────────────────────────────────────────── */
rec("配置齐备时 isConfigured 为真", isConfigured(CFG));
rec("缺 redirectUri 时 isConfigured 为假",
  !isConfigured({ ...CFG, redirectUri: "" }));

let threw = "";
try {
  validateConfig({ ...CFG, appKey: "short" });
} catch (e) {
  threw = e.code;
}
rec("app_key 过短被拦下（防把 App ID 填成 App Key）", threw === "APP_KEY_REQUIRED", threw);

threw = "";
try {
  validateConfig({ ...CFG, appKey: CFG.appId });
} catch (e) {
  threw = e.code;
}
rec("app_key 与 app_id 相同被拦下", threw === "APP_KEY_REQUIRED", threw);

rec("readConfigFromEnv 不硬编码域名",
  readConfigFromEnv({}).redirectUri === "",
  "空环境读出空 redirectUri");

/* ── ② 授权 URL ────────────────────────────────────────────────────────── */
const url = new URL(buildAuthorizeUrl(CFG, "STATE123"));
rec("授权 URL 指向 openapi.zhihu.com/authorize",
  url.origin + url.pathname === "https://openapi.zhihu.com/authorize", url.origin + url.pathname);
rec("授权 URL 用 app_id（不是 client_id）且带 response_type=code",
  url.searchParams.get("app_id") === CFG.appId &&
    url.searchParams.get("response_type") === "code",
  `app_id=${url.searchParams.get("app_id")} response_type=${url.searchParams.get("response_type")}`);
rec("授权 URL 带 state 且 redirect_uri 被编码",
  url.searchParams.get("state") === "STATE123" &&
    url.searchParams.get("redirect_uri") === CFG.redirectUri,
  `state=${url.searchParams.get("state")}`);

/* ── ③ 回调取码：authorization_code 为主路径 ───────────────────────────── */
rec("回调取 authorization_code（实测主路径）",
  extractCode(new URLSearchParams("authorization_code=AC1&state=s")) === "AC1");
rec("回调兼容 code 字段",
  extractCode(new URLSearchParams("code=C2&state=s")) === "C2");
rec("两者同时出现时优先 authorization_code",
  extractCode(new URLSearchParams("authorization_code=AC1&code=C2")) === "AC1");
rec("都没有时返回 null", extractCode(new URLSearchParams("state=s")) === null);

/* ── ④ 换 token：表单字段与成功判定 ────────────────────────────────────── */
{
  const { impl, calls } = mockFetch(() => ({
    body: { access_token: "TOK_1", token_type: "Bearer", expires_in: 3600 },
  }));
  const t = await exchangeToken({ ...CFG, fetchImpl: impl }, "CODE_X");
  const body = new URLSearchParams(String(calls[0].init.body));

  rec("token 请求打到 openapi.zhihu.com/access_token",
    calls[0].url === "https://openapi.zhihu.com/access_token", calls[0].url);
  rec("token 请求是 form-urlencoded POST",
    calls[0].init.method === "POST" &&
      calls[0].init.headers["Content-Type"] === "application/x-www-form-urlencoded",
    `${calls[0].init.method} ${calls[0].init.headers["Content-Type"]}`);
  rec("表单字段用 code（不是 authorization_code）",
    body.get("code") === "CODE_X" && !body.has("authorization_code"),
    `code=${body.get("code")}`);
  rec("表单带 app_id / app_key / grant_type / redirect_uri",
    body.get("app_id") === CFG.appId &&
      body.get("app_key") === CFG.appKey &&
      body.get("grant_type") === "authorization_code" &&
      body.get("redirect_uri") === CFG.redirectUri,
    `grant_type=${body.get("grant_type")}`);
  rec("token 解析正确", t.accessToken === "TOK_1" && t.expiresIn === 3600,
    `${t.accessToken} expiresIn=${t.expiresIn}`);
}

/* 关键：code:20000 表示成功，不能当失败 */
{
  const { impl } = mockFetch(() => ({
    body: { code: 20000, access_token: "TOK_2", expires_in: 7200 },
  }));
  let ok = true;
  let detail = "";
  try {
    const t = await exchangeToken({ ...CFG, fetchImpl: impl }, "C");
    detail = `access_token=${t.accessToken}`;
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  rec("业务字段 code=20000 时仍判定为成功（实测偏差）", ok, detail);
}

/* 嵌套 data 包装也要能取到 */
{
  const { impl } = mockFetch(() => ({ body: { data: { access_token: "TOK_3", expires_in: 60 } } }));
  const t = await exchangeToken({ ...CFG, fetchImpl: impl }, "C");
  rec("嵌套 data.access_token 也能取到", t.accessToken === "TOK_3", t.accessToken);
}

/* 没有 access_token → 报错 */
{
  const { impl } = mockFetch(() => ({ status: 400, body: { code: 40001, error: "bad code" } }));
  let code = "";
  try {
    await exchangeToken({ ...CFG, fetchImpl: impl }, "C");
  } catch (e) {
    code = e.code;
  }
  rec("没有 access_token 时报 TOKEN_EXCHANGE_FAILED", code === "TOKEN_EXCHANGE_FAILED", code);
}

/* ── ⑤ 基础信息：字段名、uid 精度、空串归一 ───────────────────────────── */
{
  const raw = `{
    "uid": 904491330657081871,
    "hash_id": "abc123",
    "fullname": "林悦",
    "headline": "慢热但真诚",
    "description": "喜欢长文阅读",
    "avatar_path": "https://picx.zhimg.com/a.jpg",
    "email": "",
    "phone_no": ""
  }`;
  const { impl, calls } = mockFetch(() => ({ body: raw }));
  const p = await fetchProfile({ ...CFG, fetchImpl: impl }, "TOK");

  rec("基础信息请求带 Bearer access_token",
    calls[0].init.headers.Authorization === "Bearer TOK",
    calls[0].init.headers.Authorization);
  rec("基础信息请求**不**带 Access Secret / X-OAuth-Token",
    !calls[0].init.headers["X-OAuth-Token"] && !calls[0].init.headers.Authorization.includes("Secret"),
    "仅 Bearer");

  /* 这是本次最重要的断言：uid 不能被 JSON.parse 舍入 */
  rec("uid 无损解析（18~19 位数字不被舍入）",
    p.uid === "904491330657081871",
    `原始 904491330657081871 → 解析出 ${p.uid}（若丢精度会是 904491330657081900）`);
  rec("头像取 avatar_path 字段",
    p.avatarPath === "https://picx.zhimg.com/a.jpg", String(p.avatarPath));
  rec("空字符串 email / phone_no 归一为 null（视为无权限）",
    p.email === null && p.phoneNo === null,
    `email=${p.email} phoneNo=${p.phoneNo}`);
  rec("昵称与简介读取正确", p.fullname === "林悦" && p.headline === "慢热但真诚",
    `${p.fullname} / ${p.headline}`);
  rec("hash_id 读取正确", p.hashId === "abc123", String(p.hashId));
}

/* 用户不存在：HTTP 200 但不是成功 */
{
  const { impl } = mockFetch(() => ({ body: { code: 404, data: "User don't exist" } }));
  let code = "";
  try {
    await fetchProfile({ ...CFG, fetchImpl: impl }, "TOK");
  } catch (e) {
    code = e.code;
  }
  rec("HTTP 200 + code=404 判为失败（不能只看状态码）",
    code === "PROFILE_INVALID", code);
}

/* uid 为 0 但有昵称 → 仍可用 */
{
  const { impl } = mockFetch(() => ({ body: { uid: 0, fullname: "某人" } }));
  const p = await fetchProfile({ ...CFG, fetchImpl: impl }, "TOK");
  rec("uid 为 0 但有昵称时不误判失败", p.fullname === "某人", p.fullname);
}

/* ── ⑥ parseLosslessUid 单元行为 ───────────────────────────────────────── */
{
  const cases = [
    ["904491330657081871", "19 位"],
    ["1234567890123456789", "19 位（超 double 精度）"],
    ["969570047710216200", "18 位"],
  ];
  const allOk = cases.every(([n]) => {
    const parsed = parseLosslessUid(`{"uid": ${n}}`);
    return parsed.uid === n;
  });
  rec("parseLosslessUid 对多组大整数都无损", allOk,
    cases.map(([n, d]) => `${d}:${parseLosslessUid(`{"uid": ${n}}`).uid === n ? "OK" : "丢"} `).join(""));

  /* 不能误伤普通数字：只对 uid / id 且位数达阈值时才保护。
     短 uid(123) 保持 number 是**正确行为** —— 它本来就不会丢精度，
     转成字符串反而改变了调用方拿到的东西。 */
  const other = parseLosslessUid('{"uid": 123, "ts": 1757000000000, "count": 42}');
  rec("短 uid 与无关数值字段保持原类型",
    other.uid === 123 && other.ts === 1757000000000 && other.count === 42,
    JSON.stringify(other));

  /* 普通 id 字段同样保护 */
  const idCase = parseLosslessUid('{"id": 904491330657081871}');
  rec("id 字段同样无损保护", idCase.id === "904491330657081871", String(idCase.id));
}

/* ── ⑦ 随机量强度 ──────────────────────────────────────────────────────── */
{
  const states = new Set(Array.from({ length: 200 }, () => newState()));
  const tokens = new Set(Array.from({ length: 200 }, () => newSessionToken()));
  const s = newState();
  rec("state 不可预测且不重复（200 个无碰撞）", states.size === 200, `${states.size}/200`);
  rec("会话 token 不重复（200 个无碰撞）", tokens.size === 200, `${tokens.size}/200`);
  rec("state 长度足够（≥32 字符 base64url）", s.length >= 32, `${s.length} 字符：${s.slice(0, 16)}…`);
  rec("state 是 URL 安全字符", /^[A-Za-z0-9_-]+$/.test(s), s.slice(0, 20));
}

/* ── ⑧ 错误里不泄漏 app_key ────────────────────────────────────────────── */
{
  const { impl } = mockFetch(() => ({ status: 401, body: { code: 401, error: "invalid app_key" } }));
  let msg = "";
  try {
    await exchangeToken({ ...CFG, fetchImpl: impl }, "C");
  } catch (e) {
    msg = e.message;
  }
  rec("错误信息中不含 app_key 明文",
    !msg.includes(CFG.appKey) && !msg.includes("key_0123456789"),
    msg.slice(0, 80));
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
