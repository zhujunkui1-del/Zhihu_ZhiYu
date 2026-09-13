/**
 * 知乎开放平台「用户数据 API」客户端。
 *
 * 用途：把用户授权的知乎公开数据转成知遇的人格输入（「知乎 · 公共表达」这一源）。
 *
 * 依据（三份官方材料，互相补充）：
 *   · `开源项目/zhihu-cli-skill-0.7.2-…/references/user-api.md` —— 五个接口与字段
 *   · 同目录 `oauth.md` —— 双凭证模型
 *   · `开源项目/zhihu-hackathon-skill_2026s2/…/assets/hello-world-oauth/lib/oauth.mjs`
 *     —— 官方参考实现里的请求头写法
 *
 * 两种身份（见 user-api.md「身份模型」）：
 *   ① 只带 Access Secret              → 该 Secret 所属账号本人的数据
 *   ② Access Secret + X-OAuth-Token   → 第三方应用中某位已授权用户的数据
 * 区别只在有没有 `X-OAuth-Token`，其余请求头一致。
 */

const BASE = "https://developer.zhihu.com";

/** 五个用户数据接口 */
export const USER_ENDPOINTS = [
  { id: "contents", label: "我的创作", path: "/api/v1/user/contents" },
  { id: "followees", label: "我的关注", path: "/api/v1/user/followees" },
  { id: "favlists", label: "收藏夹", path: "/api/v1/user/favlists" },
  { id: "favlist_contents", label: "收藏内容", path: "/api/v1/user/favlist_contents" },
  { id: "collections", label: "近期收藏", path: "/api/v1/user/collections" },
] as const;

export type UserEndpointId = (typeof USER_ENDPOINTS)[number]["id"];

export class ZhihuUserApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ZhihuUserApiError";
  }
}

export interface UserApiOptions {
  /** 开放平台 Access Secret（必填）。绝不写入日志或响应体。 */
  accessSecret: string;
  /** 代表某位已授权用户访问时传入其 OAuth access_token */
  oauthToken?: string | null;
  /** 测试注入点 */
  fetchImpl?: typeof fetch;
}

function headers(opts: UserApiOptions): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${opts.accessSecret}`,
    /* 秒级 Unix 时间戳，必填 */
    "X-Request-Timestamp": String(Math.floor(Date.now() / 1000)),
  };
  if (opts.oauthToken) h["X-OAuth-Token"] = opts.oauthToken;
  return h;
}

/**
 * 调一个用户数据接口。
 *
 * 统一返回 `{ ok, status, data, error }`，**不抛异常给上层**，
 * 因为「收藏夹为空」是正常结果而不是错误（官方明确说明）。
 */
export async function callUserEndpoint(
  id: UserEndpointId,
  query: Record<string, string | number> = {},
  opts: UserApiOptions,
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const def = USER_ENDPOINTS.find((e) => e.id === id);
  if (!def) return { ok: false, status: 0, data: null, error: `未知接口 ${id}` };

  const url = new URL(BASE + def.path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(url.toString(), {
      method: "GET",
      headers: {
        ...headers(opts),
        /* 文档：用户内容 / 用户关注 / 近期收藏明确要求 JSON；
           其余未声明，带上无害 */
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const text = await resp.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!resp.ok) {
      /* 不把 accessSecret 带进错误信息 */
      return { ok: false, status: resp.status, data, error: `HTTP ${resp.status}` };
    }
    /* 业务码为 0 表示成功；不把非零一律当失败，但要如实回报 */
    const code = (data as { Code?: number } | null)?.Code;
    if (typeof code === "number" && code !== 0) {
      return { ok: false, status: resp.status, data, error: `业务码 ${code}` };
    }
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
}

/** 从响应里取 Items 数组（官方结构是 { Data: { Items: [...] } }） */
export function itemsOf(data: unknown): Record<string, unknown>[] {
  const d = (data as { Data?: { Items?: unknown } } | null)?.Data;
  const items = d?.Items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

export interface ZhihuContentItem {
  contentType: string;
  title: string;
  summary: string;
  url: string;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
  createdAt: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function toContentItem(raw: Record<string, unknown>): ZhihuContentItem {
  return {
    contentType: str(raw.ContentType) || str(raw.Type),
    title: str(raw.Title),
    summary: str(raw.Summary),
    url: str(raw.Url),
    likeCount: num(raw.LikeCount),
    commentCount: num(raw.CommentCount),
    favoriteCount: num(raw.FavoriteCount),
    createdAt: num(raw.CreatedAt),
  };
}

/** 拉一批用户创作（默认按点赞数排序，更接近"这个人擅长什么"） */
export async function fetchContents(
  opts: UserApiOptions,
  limit = 20,
  sortField: "ts" | "like_count" = "like_count",
): Promise<ZhihuContentItem[]> {
  const r = await callUserEndpoint(
    "contents",
    { ContentType: "all", Offset: 0, Limit: Math.min(limit, 50), SortField: sortField, SortOrder: "desc" },
    opts,
  );
  if (!r.ok) throw new ZhihuUserApiError("CONTENTS_FAILED", r.error ?? "取创作失败", r.status);
  return itemsOf(r.data).map(toContentItem);
}

/** 关注的人（用于推断兴趣圈层） */
export async function fetchFollowees(opts: UserApiOptions, limit = 20) {
  const r = await callUserEndpoint("followees", { Offset: 0, Limit: Math.min(limit, 50) }, opts);
  if (!r.ok) throw new ZhihuUserApiError("FOLLOWEES_FAILED", r.error ?? "取关注失败", r.status);
  return itemsOf(r.data).map((x) => ({
    name: str(x.Name) || str(x.Fullname) || str(x.Title),
    headline: str(x.Headline),
    urlToken: str(x.UrlToken),
  }));
}

/** 收藏夹列表（第一条的 UrlToken 会用于取收藏内容） */
export async function fetchFavlists(opts: UserApiOptions, limit = 20) {
  const r = await callUserEndpoint("favlists", { Offset: 0, Limit: Math.min(limit, 50) }, opts);
  if (!r.ok) throw new ZhihuUserApiError("FAVLISTS_FAILED", r.error ?? "取收藏夹失败", r.status);
  return itemsOf(r.data).map((x) => ({
    title: str(x.Title),
    urlToken: str(x.UrlToken),
    itemCount: num(x.ItemCount),
  }));
}

/** 某个收藏夹里的内容 */
export async function fetchFavlistContents(
  opts: UserApiOptions,
  favlistUrlToken: string,
  limit = 20,
) {
  const r = await callUserEndpoint(
    "favlist_contents",
    { FavlistUrlToken: favlistUrlToken, Offset: 0, Limit: Math.min(limit, 50) },
    opts,
  );
  if (!r.ok) {
    throw new ZhihuUserApiError("FAVLIST_CONTENTS_FAILED", r.error ?? "取收藏内容失败", r.status);
  }
  return itemsOf(r.data);
}

/** 近期收藏 */
export async function fetchCollections(opts: UserApiOptions, limit = 20) {
  const r = await callUserEndpoint("collections", { Offset: 0, Limit: Math.min(limit, 50) }, opts);
  if (!r.ok) throw new ZhihuUserApiError("COLLECTIONS_FAILED", r.error ?? "取近期收藏失败", r.status);
  return itemsOf(r.data);
}
