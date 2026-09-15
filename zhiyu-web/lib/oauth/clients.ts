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

/**
 * ⚠️ 必须检查业务错误码 —— 飞书/钉钉的业务错误是 **HTTP 200 + `{code, msg}`**。
 *
 * 这条是踩过坑才加的：之前只看 `data.items`，接口因为**权限不足**返回
 * `{code: 99991672, msg: "..."}` 时，`data` 是 undefined → 被当成"没有数据"，
 * 于是给用户的结论是"可能是你还没发过话，或应用缺少权限"这种**推测**，
 * 真正的错误码和原因全被吞掉了（用户根本无从下手）。
 *
 * @param what 人话描述这一步在做什么，出错时拼进提示
 * @param scopeHint 这一步需要哪个权限，出错时一并告诉用户去开
 */
function assertOk(
  json: Record<string, unknown>,
  provider: "feishu" | "dingtalk",
  what: string,
  scopeHint: string,
): void {
  const rawCode = json.code;
  /* 飞书：code 是数字，0 为成功；钉钉：成功时通常没有 code，出错才有 */
  const failed =
    provider === "feishu"
      ? typeof rawCode === "number" && rawCode !== 0
      : typeof rawCode === "number" && rawCode !== 0;
  if (!failed) return;

  const msg = pickStr(json, "msg", "message", "error_description") || JSON.stringify(json).slice(0, 160);
  throw new OAuthApiError(
    `${provider}_api_${rawCode}`,
    `${provider === "feishu" ? "飞书" : "钉钉"}接口在「${what}」这一步报错：${rawCode} ${msg}` +
      `（该步需要权限：${scopeHint}）`,
  );
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

/**
 * 从飞书消息体里取纯文本。
 *
 * ⚠️ 踩过的坑（真 bug，不是理论风险）：飞书消息的形状是
 * `{ msg_type, body: { content: '{"text":"..."}' } }` —— 正文是**嵌在 body.content
 * 里的 JSON 字符串**。之前这里只接受字符串，调用处却传了 `m.body`（对象），
 * 于是 `typeof !== "string"` 直接返回空串，**所有消息都被丢掉**。
 * 表现是"同步成功但读到 0 条"，而我当时把它归因成了"应用缺 im:message 权限"
 * —— 用户截图里那条错误其实是这个 bug 造成的。
 * 所以这里两种形状都接受：body 对象、或已经是字符串的 content。
 */
function feishuMessageText(body: unknown): string {
  let raw = "";
  if (typeof body === "string") {
    raw = body;
  } else if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const c = o.content ?? o.text ?? o.msg;
    raw = typeof c === "string" ? c : "";
  }
  if (!raw) return "";

  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const t = o.text;
    if (typeof t === "string") return t;
    /* 富文本 post：{ title, content: [[{text}]] } */
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
    /* content 不是 JSON（纯文本消息）→ 原样用 */
    return raw;
  }
}

/**
 * 拉取飞书消息（群聊 + 用户指定的私聊）。
 *
 * 只留**我自己发的**消息：`sender.sender_type === "user"` 且 `sender.id` 等于我的 open_id。
 * 别人的话不算我的人格（与手动导入只留自己发的内容同一口径）。
 *
 * ── 群聊 ──
 * 从 `GET /im/v1/chats` 拿会话列表。
 * ⚠️ 该接口**只返回群聊**，不返回私聊（飞书平台限制）。
 *
 * ── 私聊 ──
 * 官方文档《群 ID 说明》给了两条取 chat_id 的路：
 *   ① 飞书客户端（≥7.60）打开该私聊 → 右上角设置 → 直接看/复制群 ID；
 *   ② 让机器人给对方发一条消息，从响应里拿 chat_id（会在对方聊天框留痕）。
 * 本站走 ①：用户在页面上把 `oc_...` 粘进来，**零打扰**，也不需要机器人能力。
 * 拿到 chat_id 后，`GET /im/v1/messages?container_id_type=chat&container_id=…`
 * 对单聊同样有效（官方文档：「包括单聊、群组」）。
 *
 * ⚠️ 权限（官方文档明写，漏了就"授权成功但读不到"）：
 *   基础 `im:message`；读群聊再加 `im:message.group_msg:get_as_user`；
 *   读单聊再加 `im:message.p2p_msg:get_as_user`。
 */
export async function feishuPullMessages(
  accessToken: string,
  myOpenId: string,
  opts: { maxChats?: number; maxTotalMessages?: number; extraChatIds?: string[] } = {},
): Promise<{ items: PulledItem[]; chats: number; scanned: number; p2p: number }> {
  const maxChats = opts.maxChats ?? 20;
  /* 总量上限，与 distilly 的 --msg-limit 1000 对齐 */
  const maxTotal = opts.maxTotalMessages ?? 1000;
  const PAGE = 50;
  const headers = { Authorization: `Bearer ${accessToken}` };

  const chatsRes = await fetch(`${FEISHU_BASE}/im/v1/chats?page_size=50`, { headers });
  const chatsJson = await readJson(chatsRes);
  assertOk(chatsJson, "feishu", "读取你的群列表", "im:chat");
  const chatList = ((chatsJson.data ?? {}) as Record<string, unknown>).items;
  const chats = Array.isArray(chatList) ? (chatList as Record<string, unknown>[]) : [];

  /* 群聊 + 用户给的私聊，统一成 {id, label} 列表后一起翻页 */
  const targets: { id: string; label: string; isP2p: boolean }[] = [];
  for (const c of chats.slice(0, maxChats)) {
    const id = pickStr(c, "chat_id");
    if (id) targets.push({ id, label: `群「${pickStr(c, "name") || "会话"}」`, isP2p: false });
  }
  const extra = (opts.extraChatIds ?? [])
    .map((s) => s.trim())
    .filter((s) => /^oc_[A-Za-z0-9]+$/.test(s));
  for (const id of [...new Set(extra)]) {
    targets.push({ id, label: "私聊", isP2p: true });
  }

  const items: PulledItem[] = [];
  let scanned = 0;
  let p2p = 0;

  for (const t of targets) {
    if (t.isP2p) p2p += 1;
    /* 逐页翻，直到取满总配额或没有下一页 */
    let pageToken = "";
    while (scanned < maxTotal) {
      const url =
        `${FEISHU_BASE}/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(t.id)}` +
        `&page_size=${PAGE}&sort_type=ByCreateTimeDesc` +
        `${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
      const msgRes = await fetch(url, { headers });
      const msgJson = await readJson(msgRes);
      assertOk(
        msgJson,
        "feishu",
        `拉取会话 ${t.id} 的消息`,
        t.isP2p ? "im:message.p2p_msg:get_as_user" : "im:message.group_msg:get_as_user",
      );
      const data = (msgJson.data ?? {}) as Record<string, unknown>;
      const list = data.items;
      if (!Array.isArray(list) || list.length === 0) break;

      for (const m of list as Record<string, unknown>[]) {
        scanned += 1;
        const sender = (m.sender ?? {}) as Record<string, unknown>;
        const senderId = pickStr(sender, "id");
        const senderType = pickStr(sender, "sender_type");
        if (senderType !== "user" || senderId !== myOpenId) continue;
        const msgType = pickStr(m, "msg_type");
        if (msgType && msgType !== "text" && msgType !== "post") continue;
        const text = feishuMessageText(m.body).trim();
        if (text.length < 2) continue;
        items.push({ text, trait: `飞书 · ${t.label}`.slice(0, 40), url: null });
      }

      const hasMore = data.has_more === true;
      pageToken = pickStr(data, "page_token");
      if (!hasMore || !pageToken) break;
    }
  }

  return { items, chats: chats.length, scanned, p2p };
}

/* ── 飞书云文档（文档 / Wiki / 多维表格）────────────────────────────────
   调用链与 distilly 的 `feishu_auto_collector.py` 一致：
     ① `POST /search/v2/message`（search_type=docs, creator_ids=[我]）找到我创建的文档
     ② 从返回的 url 里取出 token（`/(?:wiki|docx|docs|sheets|base)/<token>`）
     ③ 按类型取正文：
        · docx  → `GET /docx/v1/documents/{token}/raw_content`
        · wiki  → `GET /wiki/v2/spaces/get_node?token=` → obj_token/obj_type → 回到 ③
        · base  → `GET /bitable/v1/apps/{token}/tables` → 每张表 records
   ──────────────────────────────────────────────────────────────────────── */

const DOC_TOKEN_RE = /\/(?:wiki|docx|docs|sheets|base)\/([A-Za-z0-9]+)/;

/**
 * 把长文切成段落，每段一条证据（与手动导入 docs.txt 的口径一致）。
 *
 * ⚠️ 段落太短时**回落成整篇一条**：真实飞书文档里"每行一句话"很常见，
 * 若每段都不够长就一段都不产出，这篇文档就等于白拉了 ——
 * 但调用方已经把它算进"已拉取"，数字会骗人（e2e 实测暴露）。
 */
function splitParagraphs(text: string, trait: string, minLen = 10): PulledItem[] {
  const label = trait.slice(0, 40);
  const paras = text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter((p) => p.length >= minLen);

  if (paras.length === 0) {
    const whole = text.replace(/\s+/g, " ").trim();
    return whole.length >= minLen
      ? [{ text: whole.slice(0, 2000), trait: label, url: null }]
      : [];
  }
  return paras.slice(0, 60).map((p) => ({ text: p.slice(0, 2000), trait: label, url: null }));
}

/** 拉一篇文档的正文（docx / wiki 递归） */
async function feishuDocContent(
  token: string,
  type: string,
  headers: Record<string, string>,
  depth = 0,
): Promise<string> {
  if (depth > 2) return "";

  if (type === "wiki") {
    const r = await fetch(
      `${FEISHU_BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`,
      { headers },
    );
    const j = await readJson(r);
    assertOk(j, "feishu", "解析 Wiki 节点", "wiki:wiki:readonly");
    const node = (((j.data ?? {}) as Record<string, unknown>).node ?? {}) as Record<string, unknown>;
    const objToken = pickStr(node, "obj_token") || token;
    const objType = pickStr(node, "obj_type") || "docx";
    return feishuDocContent(objToken, objType, headers, depth + 1);
  }

  if (type === "doc" || type === "docx") {
    const r = await fetch(`${FEISHU_BASE}/docx/v1/documents/${encodeURIComponent(token)}/raw_content`, {
      headers,
    });
    const j = await readJson(r);
    assertOk(j, "feishu", "读取文档正文", "docx:document:readonly");
    return pickStr((j.data ?? {}) as Record<string, unknown>, "content");
  }

  return "";
}

/** 拉一张多维表格的全部记录（拼成 Markdown 表） */
async function feishuBitableText(
  appToken: string,
  headers: Record<string, string>,
): Promise<string> {
  const r = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=100`, {
    headers,
  });
  const j = await readJson(r);
  assertOk(j, "feishu", "读取多维表格", "bitable:app:readonly");
  const data = (j.data ?? {}) as Record<string, unknown>;
  const tables = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];

  const out: string[] = [];
  for (const t of tables.slice(0, 10)) {
    const tableId = pickStr(t, "table_id");
    if (!tableId) continue;
    const name = pickStr(t, "name") || tableId;
    const rr = await fetch(
      `${FEISHU_BASE}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?page_size=200`,
      { headers },
    );
    const rj = await readJson(rr);
    const rd = (rj.data ?? {}) as Record<string, unknown>;
    const records = Array.isArray(rd.items) ? (rd.items as Record<string, unknown>[]) : [];
    for (const rec of records.slice(0, 200)) {
      const fields = (rec.fields ?? {}) as Record<string, unknown>;
      const line = Object.entries(fields)
        .map(([k, v]) => `${k}：${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join(" / ");
      if (line.length < 10) continue;
      out.push(`【${name}】${line}`);
    }
  }
  return out.join("\n");
}

export async function feishuPullDocs(
  accessToken: string,
  myOpenId: string,
  myName: string,
  opts: { maxDocs?: number } = {},
): Promise<{ items: PulledItem[]; docs: number; found: number }> {
  const maxDocs = opts.maxDocs ?? 20;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=utf-8",
  };

  /**
   * 先按"创建人是我"搜；平台不支持该过滤时退回关键词搜索（distilly 的同款兜底）。
   *
   * ⚠️ 第一次因为**权限不足**（缺 search:message）失败时，不能把它当成
   * "没搜到文档"就去重试关键词 —— 那样错误会被彻底吞掉。
   * 所以这里区分：`code!==0` 且是权限类错误 → 直接抛出，让用户看到真实原因；
   * 其它情况（比如不支持 creator 过滤）才回落。
   */
  const search = async (body: Record<string, unknown>) => {
    const r = await fetch(`${FEISHU_BASE}/search/v2/message`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return readJson(r);
  };

  let j = await search({
    query: myName || "",
    search_type: "docs",
    docs_options: { creator_ids: [myOpenId] },
    page_size: maxDocs,
  });
  let raw = ((j.data ?? {}) as Record<string, unknown>).items;
  if (!Array.isArray(raw) || raw.length === 0) {
    /* 权限不足 / 未开通该接口 → 抛出真实错误，而不是静默"没搜到" */
    assertOk(j, "feishu", "搜索你的云文档", "search:message");
    j = await search({ query: myName || "", search_type: "docs", page_size: maxDocs });
    assertOk(j, "feishu", "搜索你的云文档", "search:message");
    raw = ((j.data ?? {}) as Record<string, unknown>).items;
  }
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

  const items: PulledItem[] = [];
  let docs = 0;

  for (const it of list.slice(0, maxDocs)) {
    const info = (it.docs_info ?? {}) as Record<string, unknown>;
    const title = pickStr(info, "title") || "无标题";
    const url = pickStr(info, "url");
    const dtype = pickStr(info, "docs_type") || "docx";
    const m = DOC_TOKEN_RE.exec(url);
    if (!m) continue;
    const token = m[1];

    try {
      let text = "";
      if (dtype === "bitable" || dtype === "base") {
        text = await feishuBitableText(token, headers);
      } else {
        text = await feishuDocContent(token, dtype, headers);
      }
      if (text.trim().length < 10) continue;
      const chunks = splitParagraphs(text, `飞书 · 文档《${title}》`);
      /* 只有真的产出证据才算"拉到" —— 否则计数会骗人 */
      if (chunks.length === 0) continue;
      docs += 1;
      items.push(...chunks);
    } catch {
      /* 单篇拉不到不影响其它文档 */
    }
  }

  return { items, docs, found: list.length };
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
  opts: { maxDocs?: number; keyword?: string } = {},
): Promise<{
  items: PulledItem[];
  workspaces: number;
  docs: number;
  bitables: number;
  warnings: string[];
}> {
  const maxDocs = opts.maxDocs ?? 20;
  const headers = { "x-acs-dingtalk-access-token": accessToken };
  const items: PulledItem[] = [];
  const warnings: string[] = [];

  /* 文档与多维表格是两套权限，分别 try/catch：一个没开不该连带丢掉另一个 */
  let workspaces = 0;
  let docs = 0;
  try {
    const wsRes = await fetch(`${DINGTALK_BASE}/v1.0/doc/workspaces?maxResults=50`, { headers });
    const wsJson = await readJson(wsRes);
    assertOk(wsJson, "dingtalk", "列出知识库", "文档读权限");
    const wsList = wsJson.workspaces;
    const list0 = Array.isArray(wsList) ? (wsList as Record<string, unknown>[]) : [];
    workspaces = list0.length;

    for (const ws of list0.slice(0, 5)) {
      const wsId = pickStr(ws, "workspaceId", "id");
      if (!wsId) continue;
      const filesRes = await fetch(
        `${DINGTALK_BASE}/v1.0/doc/workspaces/${encodeURIComponent(wsId)}/files?maxResults=50`,
        { headers },
      );
      const filesJson = await readJson(filesRes);
      assertOk(filesJson, "dingtalk", "列出知识库文件", "文档读权限");
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
        assertOk(contentJson, "dingtalk", "读取文档正文", "文档读权限");
        const text = pickStr(contentJson, "content", "text", "markdown").trim();
        if (text.length < 10) continue;
        const chunks = splitParagraphs(text, `钉钉 · 文档《${name}》`);
        if (chunks.length === 0) continue;
        docs += 1;
        items.push(...chunks);
      }
    }
  } catch (e) {
    warnings.push(`文档没拉到：${(e as Error).message}`);
  }

  /* ── 多维表格 ──
     调用链与 distilly 的 `dingtalk_auto_collector.py` 一致：
       `POST /v1.0/doc/search`（docTypes=["bitable"]）找表格
       → `GET /v1.0/bitable/bases/{baseId}/sheets` 取工作表
       → `…/sheets/{sheetId}/fields` 取字段名、`…/records` 取记录
     （之前完全没做这一块，而 distilly 是把它当"职场人格"的主要素材之一。） */
  const bitables: PulledItem[] = [];
  let bitableCount = 0;
  try {
    const searchRes = await fetch(`${DINGTALK_BASE}/v1.0/doc/search`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword: opts.keyword ?? "",
        size: 20,
        offset: 0,
        docTypes: ["bitable"],
      }),
    });
    const searchJson = await readJson(searchRes);
    assertOk(searchJson, "dingtalk", "搜索多维表格", "多维表格读权限");
    const docList = searchJson.docList;
    const found = Array.isArray(docList) ? (docList as Record<string, unknown>[]) : [];

    for (const d of found.slice(0, 10)) {
      const baseId = pickStr(d, "docId", "baseId", "dentries");
      const title = pickStr(d, "name", "title") || "多维表格";
      if (!baseId) continue;

      const sheetsRes = await fetch(
        `${DINGTALK_BASE}/v1.0/bitable/bases/${encodeURIComponent(baseId)}/sheets`,
        { headers },
      );
      const sheetsJson = await readJson(sheetsRes);
      assertOk(sheetsJson, "dingtalk", "读取多维表格工作表", "多维表格读权限");
      const sheets = Array.isArray(sheetsJson.sheets)
        ? (sheetsJson.sheets as Record<string, unknown>[])
        : [];
      if (!sheets.length) continue;
      bitableCount += 1;

      for (const sh of sheets.slice(0, 5)) {
        const sheetId = pickStr(sh, "sheetId", "id");
        const sheetName = pickStr(sh, "name") || sheetId;
        if (!sheetId) continue;

        const fieldsRes = await fetch(
          `${DINGTALK_BASE}/v1.0/bitable/bases/${encodeURIComponent(baseId)}/sheets/${encodeURIComponent(
            sheetId,
          )}/fields?maxResults=100`,
          { headers },
        );
        const fieldsJson = await readJson(fieldsRes);
        assertOk(fieldsJson, "dingtalk", "读取多维表格字段", "多维表格读权限");
        const fields = (Array.isArray(fieldsJson.fields) ? fieldsJson.fields : [])
          .map((f) => pickStr(f as Record<string, unknown>, "name"))
          .filter(Boolean);

        const recRes = await fetch(
          `${DINGTALK_BASE}/v1.0/bitable/bases/${encodeURIComponent(baseId)}/sheets/${encodeURIComponent(
            sheetId,
          )}/records?maxResults=200`,
          { headers },
        );
        const recJson = await readJson(recRes);
        assertOk(recJson, "dingtalk", "读取多维表格记录", "多维表格读权限");
        const records = Array.isArray(recJson.records)
          ? (recJson.records as Record<string, unknown>[])
          : [];

        for (const rec of records.slice(0, 200)) {
          const f = (rec.fields ?? {}) as Record<string, unknown>;
          const keys = fields.length ? fields : Object.keys(f);
          const line = keys
            .map((k) => {
              const v = f[k];
              if (v == null) return "";
              return `${k}：${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
            })
            .filter(Boolean)
            .join(" / ");
          if (line.length < 10) continue;
          bitables.push({
            text: `【${title} · ${sheetName}】${line}`.slice(0, 2000),
            trait: `钉钉 · 多维表格《${title}》`.slice(0, 40),
            url: null,
          });
        }
      }
    }
  } catch (e) {
    /* 多维表格失败不影响文档（权限可能只开了一部分），但**要说出来** */
    warnings.push(`多维表格没拉到：${(e as Error).message}`);
  }

  return {
    items: [...items, ...bitables],
    workspaces,
    docs,
    bitables: bitableCount,
    warnings,
  };
}

/* ── 用户信息（open_id / 昵称）────────────────────────────────────────
   ⚠️ 为什么必须有这一步：拉消息时要靠 `open_id` 判断"哪条是我发的"
   （`sender.id === myOpenId`）。而 `/authen/v1/oidc/access_token` 的返回里
   **没有 open_id**，只有一个 access_token —— 少了这一步，`myOpenId` 是空串，
   过滤条件恒不成立，**所有消息都会被丢掉**（实测：授权成功但读到 0 条）。
   ──────────────────────────────────────────────────────────────────── */

export async function feishuFetchUserInfo(
  accessToken: string,
): Promise<{ openId: string | null; name: string | null }> {
  const r = await fetch(`${FEISHU_BASE}/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await readJson(r);
  const d = (j.data ?? {}) as Record<string, unknown>;
  return { openId: pickStr(d, "open_id") || null, name: pickStr(d, "name") || null };
}

export async function dingtalkFetchUserInfo(
  accessToken: string,
): Promise<{ openId: string | null; name: string | null }> {
  const r = await fetch(`${DINGTALK_BASE}/v1.0/contact/users/me`, {
    headers: { "x-acs-dingtalk-access-token": accessToken },
  });
  const j = await readJson(r);
  return {
    openId: pickStr(j, "unionId", "openId") || null,
    name: pickStr(j, "nick", "name") || null,
  };
}

/** 供 route 统一调用：换 token */
export async function exchangeCode(
  provider: OAuthProvider,
  env: ProviderEnv,
  code: string,
): Promise<TokenSet> {
  if (provider === "feishu") {
    const t = await feishuExchangeCode(env, code);
    if (!t.externalId || !t.displayName) {
      /* 用 user_access_token 补 open_id 与昵称 */
      try {
        const u = await feishuFetchUserInfo(t.accessToken);
        t.externalId = t.externalId ?? u.openId;
        t.displayName = t.displayName ?? u.name;
      } catch {
        /* 拿不到不阻断授权；同步时会再试一次（见 sync.ts 的自愈） */
      }
    }
    return t;
  }
  const t = await dingtalkExchangeCode(env, code);
  if (!t.externalId || !t.displayName) {
    try {
      const u = await dingtalkFetchUserInfo(t.accessToken);
      t.externalId = t.externalId ?? u.openId;
      t.displayName = t.displayName ?? u.name;
    } catch {
      /* 同上 */
    }
  }
  return t;
}
