/**
 * 飞书 / 钉钉的 token 交换与数据拉取。
 *
 * 端点全部对齐 distilly 的采集脚本（`tools/feishu_auto_collector.py`、
 * `tools/dingtalk_auto_collector.py`），不自己臆造：
 *
 * 飞书（BASE = https://open.feishu.cn/open-apis）
 *   · 应用凭证换 app_access_token：POST /auth/v3/app_access_token/internal
 *   · 授权码换 user_access_token：  POST /authen/v1/oidc/access_token
 *   · 当前用户信息：                GET  /authen/v1/user_info
 *   · 会话列表：                    GET  /im/v1/chats
 *   · 会话消息：                    GET  /im/v1/messages?container_id_type=chat&container_id=…
 *   · 刷新 token：                  POST /authen/v1/oidc/refresh_access_token
 *
 * 钉钉（BASE = https://api.dingtalk.com）
 *   · 授权码换 userAccessToken：    POST /v1.0/oauth2/userAccessToken
 *   · 知识库列表：                  GET  /v1.0/doc/workspaces
 *   · 空间内文件：                  GET  /v1.0/doc/workspaces/{ws}/files
 *   · 文档正文：                    GET  /v1.0/doc/workspaces/{ws}/files/{doc}/content
 *   · ⚠️ 钉钉**没有**历史消息接口（官方限制，distilly 因此退回浏览器抓取）
 */

import type { ProviderEnv, OAuthProvider } from "./platforms";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** 有效期（秒） */
  expiresIn: number | null;
  /** 平台侧的用户标识（飞书 open_id / 钉钉 unionId） */
  externalId: string | null;
  displayName: string | null;
}

export class OAuthApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const DINGTALK_BASE = "https://api.dingtalk.com";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { _raw: text.slice(0, 300) };
  }
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

/* ── 飞书 ──────────────────────────────────────────────────────────────── */

export async function feishuExchangeCode(env: ProviderEnv, code: string): Promise<TokenSet> {
  /* ① app_access_token（用 app_id/app_secret 换，只用于换 user token） */
  const appRes = await fetch(`${FEISHU_BASE}/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: env.appId, app_secret: env.appSecret }),
  });
  const appJson = await readJson(appRes);
  const appToken = pickStr(appJson, "app_access_token", "tenant_access_token");
  if (!appToken) {
    throw new OAuthApiError(
      "app_token_failed",
      `飞书应用凭证换取 app_access_token 失败：${pickStr(appJson, "msg") || JSON.stringify(appJson).slice(0, 160)}`,
    );
  }

  /* ② 授权码换 user_access_token */
  const res = await fetch(`${FEISHU_BASE}/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${appToken}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const json = await readJson(res);
  const data = (json.data ?? {}) as Record<string, unknown>;
  const accessToken = pickStr(data, "access_token");
  if (!accessToken) {
    throw new OAuthApiError(
      "exchange_failed",
      `飞书授权码换 token 失败：${pickStr(json, "error_description", "msg") || JSON.stringify(json).slice(0, 160)}`,
    );
  }
  return {
    accessToken,
    refreshToken: pickStr(data, "refresh_token") || null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
    externalId: pickStr(data, "open_id") || null,
    displayName: pickStr(data, "name") || null,
  };
}

export interface PulledItem {
  text: string;
  /** 来源细分（群名 / 文档名），写进证据的 trait */
  trait: string;
  url?: string | null;
  time?: string;
}

/** 从飞书消息体里取纯文本（正文是 JSON 字符串：{"text":"..."}） */
function feishuMessageText(bodyContent: unknown): string {
  if (typeof bodyContent !== "string") return "";
  try {
    const o = JSON.parse(bodyContent) as Record<string, unknown>;
    const t = o.text;
    if (typeof t === "string") return t;
    /* 富文本：{ title, content: [[{text}]] } */
    if (Array.isArray(o.content)) {
      return (o.content as unknown[])
        .map((line) =>
          Array.isArray(line)
            ? (line as Record<string, unknown>[]).map((seg) => pickStr(seg, "text")).join("")
            : "",
        )
        .join("\n");
    }
    return "";
  } catch {
    return bodyContent;
  }
}

/**
 * 拉取飞书消息。
 *
 * 只留**我自己发的**消息：`sender.sender_type === "user"` 且 `sender.id` 等于我的 open_id。
 * 群里别人的话不算我的人格（与手动导入只留自己发的内容同一口径）。
 */
export async function feishuPullMessages(
  accessToken: string,
  myOpenId: string,
  opts: { maxChats?: number; maxMessagesPerChat?: number } = {},
): Promise<{ items: PulledItem[]; chats: number; scanned: number }> {
  const maxChats = opts.maxChats ?? 10;
  const maxMessages = opts.maxMessagesPerChat ?? 50;
  const headers = { Authorization: `Bearer ${accessToken}` };

  const chatsRes = await fetch(`${FEISHU_BASE}/im/v1/chats?page_size=50`, { headers });
  const chatsJson = await readJson(chatsRes);
  const chatList = ((chatsJson.data ?? {}) as Record<string, unknown>).items;
  const chats = Array.isArray(chatList) ? (chatList as Record<string, unknown>[]) : [];

  const items: PulledItem[] = [];
  let scanned = 0;

  for (const c of chats.slice(0, maxChats)) {
    const chatId = pickStr(c, "chat_id");
    if (!chatId) continue;
    const name = pickStr(c, "name") || "会话";
    const url = `${FEISHU_BASE}/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(
      chatId,
    )}&page_size=${maxMessages}`;
    const msgRes = await fetch(url, { headers });
    const msgJson = await readJson(msgRes);
    const list = ((msgJson.data ?? {}) as Record<string, unknown>).items;
    if (!Array.isArray(list)) continue;

    for (const m of list as Record<string, unknown>[]) {
      scanned += 1;
      const sender = (m.sender ?? {}) as Record<string, unknown>;
      const senderId = pickStr(sender, "id");
      const senderType = pickStr(sender, "sender_type");
      if (senderType !== "user" || senderId !== myOpenId) continue;
      const msgType = pickStr(m, "msg_type");
      if (msgType && msgType !== "text" && msgType !== "post") continue;
      const text = feishuMessageText((m.body ?? {}) as unknown).trim();
      if (text.length < 2) continue;
      items.push({ text, trait: `飞书 · ${name}`.slice(0, 40), url: null });
    }
  }

  return { items, chats: chats.length, scanned };
}

/* ── 钉钉 ──────────────────────────────────────────────────────────────── */

export async function dingtalkExchangeCode(env: ProviderEnv, code: string): Promise<TokenSet> {
  const res = await fetch(`${DINGTALK_BASE}/v1.0/oauth2/userAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: env.appId,
      clientSecret: env.appSecret,
      code,
      grantType: "authorization_code",
    }),
  });
  const json = await readJson(res);
  const accessToken = pickStr(json, "accessToken");
  if (!accessToken) {
    throw new OAuthApiError(
      "exchange_failed",
      `钉钉授权码换 token 失败：${pickStr(json, "message", "msg") || JSON.stringify(json).slice(0, 160)}`,
    );
  }
  return {
    accessToken,
    refreshToken: pickStr(json, "refreshToken") || null,
    expiresIn: typeof json.expireIn === "number" ? json.expireIn : null,
    externalId: pickStr(json, "unionId", "openId") || null,
    displayName: pickStr(json, "nick") || null,
  };
}

/** 钉钉文档 / 多维表格拉取（**消息拉不到**，见 platforms.ts 的能力声明） */
export async function dingtalkPullDocs(
  accessToken: string,
  opts: { maxDocs?: number } = {},
): Promise<{ items: PulledItem[]; workspaces: number; docs: number }> {
  const maxDocs = opts.maxDocs ?? 20;
  const headers = { "x-acs-dingtalk-access-token": accessToken };
  const items: PulledItem[] = [];

  const wsRes = await fetch(`${DINGTALK_BASE}/v1.0/doc/workspaces?maxResults=50`, { headers });
  const wsJson = await readJson(wsRes);
  const wsList = wsJson.workspaces;
  const workspaces = Array.isArray(wsList) ? (wsList as Record<string, unknown>[]) : [];

  let docs = 0;
  for (const ws of workspaces.slice(0, 5)) {
    const wsId = pickStr(ws, "workspaceId", "id");
    if (!wsId) continue;
    const filesRes = await fetch(
      `${DINGTALK_BASE}/v1.0/doc/workspaces/${encodeURIComponent(wsId)}/files?maxResults=50`,
      { headers },
    );
    const filesJson = await readJson(filesRes);
    const files = filesJson.workspaces;
    const list = Array.isArray(files) ? (files as Record<string, unknown>[]) : [];
    for (const f of list.slice(0, maxDocs)) {
      const docId = pickStr(f, "dentries", "id", "docId");
      const name = pickStr(f, "name", "title") || "文档";
      if (!docId) continue;
      const spaceId = pickStr(f, "spaceId") || wsId;
      const contentRes = await fetch(
        `${DINGTALK_BASE}/v1.0/doc/workspaces/${encodeURIComponent(spaceId)}/files/${encodeURIComponent(
          docId,
        )}/content`,
        { headers },
      );
      const contentJson = await readJson(contentRes);
      const text = pickStr(contentJson, "content", "text", "markdown").trim();
      if (text.length < 10) continue;
      docs += 1;
      /* 文档可能很长：切成段落，每段一条证据（与手动导入 docs.txt 的口径一致） */
      for (const para of text.split(/\n{2,}/)) {
        const t = para.replace(/\s+/g, " ").trim();
        if (t.length < 10) continue;
        items.push({ text: t.slice(0, 2000), trait: `钉钉 · ${name}`.slice(0, 40), url: null });
      }
    }
  }
  return { items, workspaces: workspaces.length, docs };
}

/** 供 route 统一调用：换 token */
export async function exchangeCode(
  provider: OAuthProvider,
  env: ProviderEnv,
  code: string,
): Promise<TokenSet> {
  return provider === "feishu" ? feishuExchangeCode(env, code) : dingtalkExchangeCode(env, code);
}
