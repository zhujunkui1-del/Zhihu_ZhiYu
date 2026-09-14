/**
 * 从知乎**公开可见**数据采集真实人物画像。
 *
 * 为什么走公开端点而不是开放平台：
 *   实测开放平台的用户数据 API **只能读「自己」**（带 hash_id/uid 参数会被忽略），
 *   OAuth 也只能读「已授权给我们的人」。要拿高曝光用户的真实数据，
 *   只能采集公开可见的部分。
 *
 * 实测可读（www.zhihu.com/api/v4，无需登录）：
 *   ★ /members/{url_token}            资料（name / headline / avatar / IP 属地）
 *   ★ /members/{url_token}/pins       想法（正文 HTML + 赞/评 + 时间戳）
 * 实测不可读：
 *   ✗ /answers、/articles             401「第三方应用独立请求时，无此操作权限」
 *   ✗ /followees /followers           401「身份未经过验证」
 *
 * 采集纪律：
 *   · 只读公开数据，不登录、不绕权限、不带 Cookie
 *   · 串行 + 固定间隔，避免给对方造成压力（不是"高频抓取"）
 *   · 明确记录「哪些字段拿到了、哪些拿不到」，不假装完整
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const HEADERS = {
  "User-Agent": UA,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Referer: "https://www.zhihu.com/",
};

/** 采集间隔：串行且留间隔，避免压力 */
const DELAY_MS = 600;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把知乎的 content（数组 + HTML）还原成纯文本 */
export function contentToText(content) {
  if (typeof content === "string") return stripTags(content);
  if (!Array.isArray(content)) return "";
  return content
    .map((seg) => {
      if (typeof seg === "string") return stripTags(seg);
      if (seg && typeof seg === "object") {
        if (typeof seg.content === "string") return stripTags(seg.content);
        /* 图片/视频类段落：用类型占位，保留"这条内容是图/视频"的信号 */
        if (seg.type) return `[${seg.type}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function stripTags(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface PublicProfile {
  urlToken: string;
  name: string;
  headline: string;
  description: string;
  avatarUrl: string;
  /** 如 "北京"；拿不到为 null */
  ipLocation: string | null;
  isOrg: boolean;
  gender: string | null;
}

export interface PublicPin {
  id: string;
  title: string;
  text: string;
  likeCount: number;
  commentCount: number;
  createdAt: Date;
  url: string;
}

export interface FetchResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

/** 采集一个人：资料 + 想法 */
export async function fetchPublicPerson(
  urlToken: string,
  pinLimit = 20,
): Promise<{
  profile: FetchResult<PublicProfile>;
  pins: FetchResult<PublicPin[]>;
  /** 采集耗时（毫秒） */
  elapsedMs: number;
}> {
  const t0 = Date.now();
  let profile: FetchResult<PublicProfile> = { ok: false, data: null, error: "未请求" };
  let pins: FetchResult<PublicPin[]> = { ok: false, data: null, error: "未请求" };

  try {
    const r = await fetch(`https://www.zhihu.com/api/v4/members/${encodeURIComponent(urlToken)}`, {
      headers: HEADERS,
    });
    if (!r.ok) {
      profile = { ok: false, data: null, error: `HTTP ${r.status}` };
    } else {
      const j = await r.json();
      profile = {
        ok: true,
        data: {
          urlToken: j.url_token ?? urlToken,
          name: j.name ?? "",
          headline: stripTags(j.headline ?? ""),
          description: stripTags(j.description ?? ""),
          avatarUrl: j.avatar_url ?? "",
          ipLocation: typeof j.ip_info === "string" ? j.ip_info.replace(/^IP 属地/, "") : null,
          isOrg: j.user_type === "organization" || j.is_org === true,
          gender: j.gender === 1 ? "male" : j.gender === 0 ? "female" : null,
        },
      };
    }
  } catch (e) {
    profile = { ok: false, data: null, error: (e as Error).message };
  }

  await sleep(DELAY_MS);

  try {
    const r = await fetch(
      `https://www.zhihu.com/api/v4/members/${encodeURIComponent(urlToken)}/pins?limit=${pinLimit}&offset=0`,
      { headers: HEADERS },
    );
    if (!r.ok) {
      pins = { ok: false, data: null, error: `HTTP ${r.status}` };
    } else {
      const j = await r.json();
      const list = Array.isArray(j.data) ? j.data : [];
      pins = {
        ok: true,
        data: list.map((p: Record<string, unknown>) => ({
          id: String(p.id ?? ""),
          title: stripTags(String(p.excerpt_title ?? "")),
          text: contentToText(p.content),
          likeCount: typeof p.like_count === "number" ? p.like_count : 0,
          commentCount: typeof p.comment_count === "number" ? p.comment_count : 0,
          createdAt: new Date(((p.created as number) ?? 0) * 1000),
          url: String(p.url ?? ""),
        })),
      };
    }
  } catch (e) {
    pins = { ok: false, data: null, error: (e as Error).message };
  }

  return { profile, pins, elapsedMs: Date.now() - t0 };
}

/** 从一个 UrlToken 列表批量采集（串行，带进度回调） */
export async function fetchPublicPeople(
  urlTokens: string[],
  pinLimit = 20,
  onProgress?: (i: number, total: number, token: string, ms: number) => void,
) {
  const out = [];
  for (let i = 0; i < urlTokens.length; i += 1) {
    const token = urlTokens[i];
    const r = await fetchPublicPerson(token, pinLimit);
    out.push({ urlToken: token, ...r });
    onProgress?.(i + 1, urlTokens.length, token, r.elapsedMs);
    if (i < urlTokens.length - 1) await sleep(DELAY_MS);
  }
  return out;
}
