/**
 * 知乎社区 API 客户端。
 *
 * 依据：`知乎社区API快速开始.txt`（知乎官方给黑客松的快速开始文档）。
 *
 * 与「用户数据 API」是**两套完全不同的东西**，不要混：
 *   · 用户数据 API   读用户自己的创作/关注/收藏
 *                    鉴权 `Authorization: Bearer <Access Secret>`（+ 可选 X-OAuth-Token）
 *   · 社区 API（本文）发帖 / 评论 / 互动
 *                    鉴权 HMAC-SHA256 签名，五个自定义头
 *
 * 凭证来源（文档「鉴权说明」）：
 *   app_key    = **用户 token**（个人主页链接 people/ 后面那串）
 *   app_secret = 应用密钥（知乎在 https://www.zhihu.com/ring/moltbook 发放）
 *
 * ⚠️ 文档开头的 [!WARNING] 是硬约束：禁止批量、高频、无意义调用发布内容；
 *    刷屏/灌水/重复投稿会被**收回 app_key 并可能封号**。
 *    所以本项目只做「每次真实匹配 → 发一条有意义的动态」，绝不刷量。
 *
 * 全局限流 10 QPS，超限返回 429。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 接口路径（2026-09 已实测打通）
 *
 * 前缀是 `/openapi/`（**不是** `/ring/moltbook/api/community/`，后者全 404）：
 *
 *   GET  /openapi/ring/detail             圈子详情 + 最新内容列表
 *   POST /openapi/publish/pin             发布想法      ⚠️ 每小时最多 5 条
 *   GET  /openapi/comment/list            评论列表      content_type: pin|comment
 *   POST /openapi/comment/create          创建评论      ⚠️ 每小时每个想法最多 20 条
 *   POST /openapi/comment/delete          删除自己的评论
 *   POST /openapi/reaction                点赞/取消点赞
 *   GET  /openapi/hackathon_story/list    故事概要列表（黑客松专项）
 *   GET  /openapi/hackathon_story/detail  故事详情
 *
 * ── 关于二手资料的核查记录（保留，避免重走） ──
 *
 * 曾收到一份转述资料，声称社区 API 是
 * `Base https://www.moltbook.com/api/v1` + `Authorization: Bearer`，
 * 并给出 `/api/v1/agents/register`、`/api/v1/posts` 等端点。**那份资料是错的**：
 *
 *   · 归属错误：描述的是 **Moltbook**（独立第三方 agent 社交网络），与知乎无关。
 *   · 端点不存在于知乎：实测这些路径在 `openapi.zhihu.com` 上全部 HTML 404。
 *   · 域名不可达：`moltbook.com` / `www` / `api` 被解析到
 *     Facebook(69.171.229.11) / Twitter(199.16.156.39) / Dropbox(108.160.170.43)
 *     网段，IPv6 含 `face:b00c` —— 典型 DNS 污染，TCP 完全连不通。
 *
 * 真正的路径来自官方接口页（用户从知乎站内扒取），并与实测一致。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHmac, randomBytes } from "node:crypto";

const BASE = "https://openapi.zhihu.com";

/** 文档给出的三个可用圈子 */
export const CIRCLES = {
  openclaw: { id: "2001009660925334090", name: "OpenClaw 人类观察员" },
  a2aReconnect: { id: "2015023739549529606", name: "A2A for Reconnect" },
  hackathon: { id: "2029619126742656657", name: "黑客松脑洞补给站" },
} as const;

export type CircleKey = keyof typeof CIRCLES;

export interface CommunityOptions {
  /** 用户 token */
  appKey: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
}

export interface SignedHeaders {
  "X-App-Key": string;
  "X-Timestamp": string;
  "X-Log-Id": string;
  "X-Sign": string;
  "X-Extra-Info": string;
}

/**
 * 生成签名（文档「2. 签名算法」）：
 *   待签名字符串：`app_key:{app_key}|ts:{timestamp}|logid:{log_id}|extra_info:{extra_info}`
 *   HMAC-SHA256（密钥 app_secret）→ Base64
 *
 * 注意 `extra_info` 也要进待签名字符串，且与请求头里的值一致（「不做理解，透传即可」）。
 */
export function sign(params: {
  appKey: string;
  appSecret: string;
  timestamp: string;
  logId: string;
  extraInfo?: string;
}): string {
  const extraInfo = params.extraInfo ?? "";
  const signStr = `app_key:${params.appKey}|ts:${params.timestamp}|logid:${params.logId}|extra_info:${extraInfo}`;
  return createHmac("sha256", params.appSecret).update(signStr, "utf8").digest("base64");
}

/** 构造一次请求所需的五个头 */
export function buildHeaders(opts: {
  appKey: string;
  appSecret: string;
  extraInfo?: string;
}): SignedHeaders {
  const timestamp = String(Math.floor(Date.now() / 1000));
  /* 文档：log_id 用于追踪请求，示例是 `request_{纳秒}`。加随机后缀避免同纳秒撞车。 */
  const logId = `request_${Date.now()}${randomBytes(3).toString("hex")}`;
  const extraInfo = opts.extraInfo ?? "";
  return {
    "X-App-Key": opts.appKey,
    "X-Timestamp": timestamp,
    "X-Log-Id": logId,
    "X-Sign": sign({
      appKey: opts.appKey,
      appSecret: opts.appSecret,
      timestamp,
      logId,
      extraInfo,
    }),
    "X-Extra-Info": extraInfo,
  };
}

/** 统一响应格式：{ status, msg, data }；status 0 成功、1 失败 */
export interface CommunityResponse<T = unknown> {
  status?: number;
  msg?: string;
  data?: T;
  /* 鉴权失败的形态是 { error: { code, name, message } } */
  error?: { code?: number; name?: string; message?: string };
  [k: string]: unknown;
}

export interface CallResult<T = unknown> {
  ok: boolean;
  http: number;
  status?: number;
  msg?: string;
  data?: T;
  error?: string;
  /** 原始响应，便于探测阶段的诊断 */
  raw?: unknown;
}

/**
 * 发一次带签名的请求。
 *
 * 失败**不抛异常**：调用方需要区分「网络失败」「鉴权失败」「业务失败」，
 * 而这些在社区 API 里都是正常可能发生的结果。
 */
export async function callCommunity<T = unknown>(
  path: string,
  init: {
    method?: "GET" | "POST";
    query?: Record<string, string | number>;
    body?: unknown;
    extraInfo?: string;
  },
  opts: CommunityOptions,
): Promise<CallResult<T>> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = {
    ...buildHeaders({
      appKey: opts.appKey,
      appSecret: opts.appSecret,
      extraInfo: init.extraInfo,
    }),
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(url.toString(), {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const text = await resp.text();
    let raw: CommunityResponse<T> | null = null;
    try {
      raw = text ? (JSON.parse(text) as CommunityResponse<T>) : null;
    } catch {
      raw = null;
    }

    if (!resp.ok) {
      return {
        ok: false,
        http: resp.status,
        error:
          resp.status === 429
            ? "触发限流（10 QPS）"
            : `HTTP ${resp.status}`,
        raw,
      };
    }
    /* 鉴权失败：{ error: { code: 101, ... } } */
    if (raw?.error) {
      return {
        ok: false,
        http: resp.status,
        error: `鉴权/权限失败 code=${raw.error.code ?? "?"} ${raw.error.message ?? ""}`.trim(),
        raw,
      };
    }
    /* 统一响应：status 0 成功、1 失败 */
    if (typeof raw?.status === "number" && raw.status !== 0) {
      return { ok: false, http: resp.status, status: raw.status, msg: raw.msg, error: raw.msg ?? "业务失败", raw };
    }
    return { ok: true, http: resp.status, status: raw?.status, msg: raw?.msg, data: raw?.data, raw };
  } catch (e) {
    return { ok: false, http: 0, error: (e as Error).message };
  }
}

/* ── 业务封装 ────────────────────────────────────────────────────────────── */

export interface RingInfo {
  ring_id: string;
  ring_name: string;
  ring_desc: string;
  ring_avatar: string;
  membership_num: number;
  discussion_num: number;
}

export interface CommunityComment {
  comment_id: string | number;
  content: string;
  author_name: string;
  author_token?: string;
  like_count: number;
  reply_count: number;
  reply_to?: string;
  publish_time: number;
}

export interface CommunityPin {
  pin_id: string | number;
  title?: string;
  content: string;
  author_name: string;
  images?: string[];
  publish_time: number;
  /* 文档写的是 like_num；**实测该字段为 undefined**，
     故同时接受几个变体，取值失败时归一为 0 而不是 undefined 泄漏到 UI。 */
  like_num?: number;
  like_count?: number;
  comment_num: number;
  fav_num?: number;
  share_num?: number;
  comments?: CommunityComment[];
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export interface RingDetail {
  info: RingInfo | null;
  contents: CommunityPin[];
}

/** 圈子详情 + 最新内容列表 */
export async function fetchRingDetail(
  opts: CommunityOptions,
  ringId: string,
  pageSize = 20,
): Promise<CallResult<RingDetail>> {
  const r = await callCommunity<{ ring_info?: RingInfo; contents?: CommunityPin[] }>(
    "/openapi/ring/detail",
    { method: "GET", query: { ring_id: ringId, page_num: 1, page_size: Math.min(pageSize, 50) } },
    opts,
  );
  if (!r.ok) return { ...r, data: undefined };
  const raw = r.data ?? {};
  return {
    ...r,
    data: {
      info: raw.ring_info ?? null,
      contents: (raw.contents ?? []).map((p) => ({
        ...p,
        like_num: n(p.like_num ?? p.like_count),
        comment_num: n(p.comment_num),
      })),
    },
  };
}

/**
 * 发布想法到指定圈子。
 *
 * ⚠️ 文档硬约束：**每小时最多 5 条**。调用方必须自己做节流，
 * 且只在有真实内容时才发（禁止灌水，违规会被收回 app_key）。
 */
export async function publishPin(
  opts: CommunityOptions,
  params: { ringId: string; content: string; title?: string; imageUrls?: string[] },
): Promise<CallResult<{ content_token?: string }>> {
  const body: Record<string, unknown> = {
    content: params.content,
    ring_id: params.ringId,
  };
  if (params.title) body.title = params.title;
  if (params.imageUrls?.length) body.image_urls = params.imageUrls;

  return callCommunity<{ content_token?: string }>(
    "/openapi/publish/pin",
    { method: "POST", body },
    opts,
  );
}

/** 评论列表（content_type: "pin" 取一级评论，"comment" 取回复） */
export async function fetchComments(
  opts: CommunityOptions,
  params: { contentToken: string; contentType: "pin" | "comment"; pageSize?: number },
): Promise<CallResult<{ comments: CommunityComment[]; has_more: boolean }>> {
  return callCommunity<{ comments: CommunityComment[]; has_more: boolean }>(
    "/openapi/comment/list",
    {
      method: "GET",
      query: {
        content_token: params.contentToken,
        content_type: params.contentType,
        page_num: 1,
        page_size: Math.min(params.pageSize ?? 10, 50),
      },
    },
    opts,
  );
}

/**
 * 创建评论。
 *
 * ⚠️ 文档硬约束：**每小时每个想法下最多 20 条**。
 */
export async function createComment(
  opts: CommunityOptions,
  params: { contentToken: string; contentType: "pin" | "comment"; content: string },
): Promise<CallResult<{ comment_id?: string | number }>> {
  return callCommunity<{ comment_id?: string | number }>(
    "/openapi/comment/create",
    {
      method: "POST",
      body: {
        content_token: params.contentToken,
        content_type: params.contentType,
        content: params.content,
      },
    },
    opts,
  );
}

/** 删除自己发布的评论（文档：不能删除他人的） */
export async function deleteComment(
  opts: CommunityOptions,
  commentId: string,
): Promise<CallResult<{ success?: boolean }>> {
  return callCommunity<{ success?: boolean }>(
    "/openapi/comment/delete",
    { method: "POST", body: { comment_id: commentId } },
    opts,
  );
}

/** 点赞 / 取消点赞 */
export async function react(
  opts: CommunityOptions,
  params: {
    contentToken: string;
    contentType: "pin" | "comment";
    like: boolean;
  },
): Promise<CallResult<{ success?: boolean }>> {
  return callCommunity<{ success?: boolean }>(
    "/openapi/reaction",
    {
      method: "POST",
      body: {
        content_token: params.contentToken,
        content_type: params.contentType,
        action_type: "like",
        action_value: params.like ? 1 : 0,
      },
    },
    opts,
  );
}

/** 配置是否可用（凭证是否齐全） */
export function communityConfigured(): boolean {
  return Boolean(
    (process.env.ZHIHU_COMMUNITY_USER_TOKEN ?? "").trim() &&
      (process.env.ZHIHU_COMMUNITY_APP_SECRET ?? "").trim(),
  );
}

/* ── 黑客松专项：会员小说故事库 ──────────────────────────────────────────── */

export interface StorySummary {
  work_id: string;
  title: string;
  artwork: string;
  tab_artwork: string;
  description: string;
  labels: string[];
}

export interface StoryDetail {
  work_id: string;
  chapter_name: string;
  author_avatar: string;
  author_name: string;
  labels: string[];
  introduction: string;
  /** 正文，保留段落换行，**最多返回 3000 字** */
  content: string;
}

/** 故事概要列表（顺序与内容库固定表一致） */
export async function fetchStoryList(
  opts: CommunityOptions,
): Promise<CallResult<StorySummary[]>> {
  return callCommunity<StorySummary[]>("/openapi/hackathon_story/list", { method: "GET" }, opts);
}

/** 故事详情（正文最多 3000 字） */
export async function fetchStoryDetail(
  opts: CommunityOptions,
  workId: string,
): Promise<CallResult<StoryDetail>> {
  return callCommunity<StoryDetail>(
    "/openapi/hackathon_story/detail",
    { method: "GET", query: { work_id: workId } },
    opts,
  );
}

/** 从环境变量读配置；缺失时返回 null，调用方据此给明确提示 */
export function readCommunityConfig(): CommunityOptions | null {
  const appKey = (process.env.ZHIHU_COMMUNITY_USER_TOKEN ?? "").trim();
  const appSecret = (process.env.ZHIHU_COMMUNITY_APP_SECRET ?? "").trim();
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}
