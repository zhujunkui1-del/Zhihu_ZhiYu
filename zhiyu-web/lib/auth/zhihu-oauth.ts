/**
 * 知乎 OAuth 协议层（纯函数，不碰数据库与 cookie）。
 *
 * 协议依据（本地官方文档，两份互相补充）：
 *   · `开源项目/zhihu-cli-skill-0.7.2-…/references/hackathon-oauth.md`（黑客松专用，较新）
 *   · 同目录 `oauth.md`（通用 OAuth，含 2077 项目 2026-05-14 的线上实测偏差）
 *
 * 两份文档存在两处冲突，本文件的取舍都写在对应位置，不默默选一边。
 */

/** 授权页 */
const AUTHORIZE_URL = "https://openapi.zhihu.com/authorize";
/** 换取 token */
const TOKEN_URL = "https://openapi.zhihu.com/access_token";
/** 授权用户基础信息 */
const USER_URL = "https://openapi.zhihu.com/user";

export interface ZhihuOAuthConfig {
  appId: string;
  /** 后端密钥；绝不进浏览器、URL、日志 */
  appKey: string;
  /** 必须与赛事页面登记值逐字一致，且为公网 HTTPS */
  redirectUri: string;
  /** 开放平台 Access Secret：仅在读创作/关注/收藏时需要；基础信息接口不需要 */
  accessSecret?: string;
  /** 测试注入点：覆盖 fetch，用于 Mock 测试 */
  fetchImpl?: typeof fetch;
}

export type ZhihuOAuthErrorCode =
  | "APP_ID_REQUIRED"
  | "APP_KEY_REQUIRED"
  | "REDIRECT_URI_REQUIRED"
  | "STATE_MISSING"
  | "STATE_MISMATCH"
  | "STATE_EXPIRED"
  | "STATE_CONSUMED"
  | "CODE_MISSING"
  | "TOKEN_EXCHANGE_FAILED"
  | "PROFILE_FAILED"
  | "PROFILE_INVALID";

export class ZhihuOAuthError extends Error {
  code: ZhihuOAuthErrorCode;
  constructor(code: ZhihuOAuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ZhihuOAuthError";
  }
}

/**
 * 从环境变量读配置。
 *
 * 变量名以 `.env.example` 已声明者为准（ZHIHU_APP_ID / ZHIHU_OAUTH_APP_KEY /
 * ZHIHU_ACCESS_SECRET），回调地址用 ZHIHU_OAUTH_REDIRECT_URI。
 * **不硬编码域名** —— 域名未定前保持为空，`isConfigured()` 会返回 false。
 */
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ZhihuOAuthConfig {
  return {
    appId: (env.ZHIHU_APP_ID ?? "").trim(),
    appKey: (env.ZHIHU_OAUTH_APP_KEY ?? "").trim(),
    redirectUri: (env.ZHIHU_OAUTH_REDIRECT_URI ?? "").trim(),
    accessSecret: (env.ZHIHU_ACCESS_SECRET ?? "").trim() || undefined,
  };
}

/** 配置是否齐备；不齐时按钮应回退到演示登录而不是抛错 */
export function isConfigured(cfg: ZhihuOAuthConfig): boolean {
  return Boolean(cfg.appId && cfg.appKey && cfg.redirectUri);
}

/**
 * 校验配置，并在常见误配时给出**具体**提示。
 *
 * 官方参考实现专门做了这两项检测，说明是高频错误：
 *   · app_key 过短 → 很可能把 app_id 填进了 app_key
 *   · app_key 与 app_id 完全相同 → 同上
 */
export function validateConfig(cfg: ZhihuOAuthConfig): void {
  if (!cfg.appId) throw new ZhihuOAuthError("APP_ID_REQUIRED", "未配置 ZHIHU_APP_ID");
  if (!cfg.appKey) throw new ZhihuOAuthError("APP_KEY_REQUIRED", "未配置 ZHIHU_OAUTH_APP_KEY");
  if (!cfg.redirectUri) {
    throw new ZhihuOAuthError("REDIRECT_URI_REQUIRED", "未配置 ZHIHU_OAUTH_REDIRECT_URI");
  }
  if (cfg.appKey.length <= 8) {
    throw new ZhihuOAuthError(
      "APP_KEY_REQUIRED",
      "ZHIHU_OAUTH_APP_KEY 过短，请确认没有把 App ID 填成 App Key",
    );
  }
  if (cfg.appKey === cfg.appId) {
    throw new ZhihuOAuthError(
      "APP_KEY_REQUIRED",
      "ZHIHU_OAUTH_APP_KEY 与 App ID 相同，两者不是同一个值",
    );
  }
}

/** 生成不可预测的 state（24 字节 base64url） */
export function newState(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** 生成随机会话标识（32 字节 base64url，比 state 更长） */
export function newSessionToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 构造授权 URL。
 *
 * 参数名用 `app_id`（不是标准 OAuth 的 client_id），
 * 回调参数名用 `response_type=code`。
 */
export function buildAuthorizeUrl(
  cfg: Pick<ZhihuOAuthConfig, "appId" | "redirectUri">,
  state: string,
): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("app_id", cfg.appId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", state);
  return u.toString();
}

/**
 * 从回调 query 里取授权码。
 *
 * 实测偏差：回调参数是 **`authorization_code`**，不是旧文档写的 `code`。
 * 为兼容协议修订，两个都接受，以 `authorization_code` 为主路径。
 */
export function extractCode(params: URLSearchParams): string | null {
  const code = params.get("authorization_code") ?? params.get("code");
  return code && code.trim() ? code.trim() : null;
}

export interface TokenResult {
  accessToken: string;
  tokenType: string;
  /** 秒；未知时为 null */
  expiresIn: number | null;
}

/**
 * 用授权码换 access token。
 *
 * 注意两点：
 *   1. 表单字段用 **`code`**（虽然回调参数叫 authorization_code）
 *   2. 成功判定看 `access_token` 是否存在 —— 业务字段 `code: 20000` 表示成功，
 *      **不能把非零 code 当失败**（实测偏差第 4 条）
 */
export async function exchangeToken(cfg: ZhihuOAuthConfig, code: string): Promise<TokenResult> {
  validateConfig(cfg);
  const doFetch = cfg.fetchImpl ?? fetch;

  const form = new URLSearchParams({
    app_id: cfg.appId,
    app_key: cfg.appKey,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code,
  });

  const resp = await doFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  const payload = (await safeJson(resp)) as Record<string, unknown> | null;
  const token = pickString(payload, ["access_token", "data.access_token", "Data.access_token"]);
  if (!token) {
    throw new ZhihuOAuthError(
      "TOKEN_EXCHANGE_FAILED",
      `换取 access_token 失败（HTTP ${resp.status}）${describePayload(payload)}`,
    );
  }
  const expiresRaw = pickNumber(payload, ["expires_in", "data.expires_in", "Data.expires_in"]);
  return {
    accessToken: token,
    tokenType: pickString(payload, ["token_type"]) ?? "Bearer",
    expiresIn: expiresRaw,
  };
}

export interface ZhihuProfile {
  /** 无损字符串化的数字 uid */
  uid: string;
  hashId: string | null;
  fullname: string;
  headline: string | null;
  description: string | null;
  /** 注意字段名是 avatar_path，不是 avatar_url */
  avatarPath: string | null;
  email: string | null;
  phoneNo: string | null;
  raw: unknown;
}

/**
 * 读取授权用户基础信息。
 *
 * 只带 `Authorization: Bearer <access_token>`；
 * **不需要 Access Secret、X-OAuth-Token 或时间戳**（那是创作/关注/收藏接口才要）。
 *
 * 关键：`uid` 必须**无损解析**。它是 18~19 位十进制数，超过 JS 安全整数范围，
 * 直接 JSON.parse 会静默舍入（实测 904491330657081871 → 904491330657081900）。
 * 所以这里先用文本预处理把数字型 uid 包成字符串，再 JSON.parse。
 */
export async function fetchProfile(
  cfg: ZhihuOAuthConfig,
  accessToken: string,
): Promise<ZhihuProfile> {
  const doFetch = cfg.fetchImpl ?? fetch;
  const resp = await doFetch(USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  /* 不能只凭 HTTP 200 判成功：用户不存在时是 200 + {code:404,...}。
     所以先取文本、做无损预处理，再判断有没有有效用户标识。 */
  const text = await resp.text();
  const payload = parseLosslessUid(text) as Record<string, unknown> | null;

  const src = (payload?.data ?? payload?.Data ?? payload?.user ?? payload) as Record<
    string,
    unknown
  > | null;

  const uidRaw = src?.uid ?? src?.id;
  const uid = uidRaw == null ? "" : String(uidRaw);
  const fullname = pickString(src, ["fullname", "name", "Fullname"]) ?? "";

  if (!uid && !fullname) {
    throw new ZhihuOAuthError(
      "PROFILE_INVALID",
      `基础信息响应里没有有效的用户标识（HTTP ${resp.status}）${describePayload(payload)}`,
    );
  }

  return {
    uid,
    hashId: pickString(src, ["hash_id", "hashId"]) ?? null,
    fullname,
    headline: pickString(src, ["headline"]) ?? null,
    description: pickString(src, ["description", "bio"]) ?? null,
    /* 空字符串视为"无权限或未授权"，统一归一成 null */
    avatarPath: normalizeEmpty(pickString(src, ["avatar_path", "avatar_url", "avatarUrl"])),
    email: normalizeEmpty(pickString(src, ["email"])),
    phoneNo: normalizeEmpty(pickString(src, ["phone_no", "phone"])),
    raw: payload,
  };
}

/** 空字符串 → null（文档明确：无权限时返回空串，而不是缺字段） */
function normalizeEmpty(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null;
}

/**
 * 把 JSON 文本里 `"uid": 数字` 形式的超大整数转成字符串后再 parse。
 *
 * 为什么走文本预处理而不是直接 JSON.parse：
 * JSON.parse 对超过 Number.MAX_SAFE_INTEGER（9007199254740991，16 位）的
 * 整数会静默舍入，拿到的值不同且**不会有任何报错**。
 *
 * 阈值取 15 位而不是 16 位：15 位也可能逼近上限（999999999999999 已接近），
 * 而对 uid / id 来说"变成字符串"完全无害（我们本来就按字符串存），
 * 所以宁可多保护一点。只针对 uid / id 两个字段，不碰其他数字。
 */
export function parseLosslessUid(text: string): unknown {
  const patched = text.replace(
    /"(uid|id)"\s*:\s*(-?\d{15,})/g,
    (_m, key: string, num: string) => `"${key}":"${num}"`,
  );
  try {
    return JSON.parse(patched);
  } catch {
    return null;
  }
}

async function safeJson(resp: Response): Promise<unknown> {
  try {
    return JSON.parse(await resp.text());
  } catch {
    return null;
  }
}

/** 支持 "a.b" 形式的浅层路径取值 */
function pickString(obj: Record<string, unknown> | null, paths: string[]): string | null {
  for (const p of paths) {
    const v = pick(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(obj: Record<string, unknown> | null, paths: string[]): number | null {
  for (const p of paths) {
    const v = pick(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function pick(obj: Record<string, unknown> | null, path: string): unknown {
  if (!obj) return undefined;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else return undefined;
  }
  return cur;
}

/** 出错时给出可诊断但不泄密的摘要（不含 token / app_key） */
function describePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const o = payload as Record<string, unknown>;
  const bits: string[] = [];
  if (o.code !== undefined) bits.push(`code=${String(o.code)}`);
  if (o.data !== undefined && typeof o.data === "string") bits.push(`data=${o.data.slice(0, 80)}`);
  if (o.error !== undefined) bits.push(`error=${String(o.error).slice(0, 80)}`);
  return bits.length ? `：${bits.join(" ")}` : "";
}
