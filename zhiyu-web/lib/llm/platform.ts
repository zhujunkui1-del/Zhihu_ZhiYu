/**
 * 「知遇提供的大模型」——免费额度与用量的唯一判定处。
 *
 * 产品需求（#7）：
 *   · 把站点自己的大模型 API 交给网站使用，用于 **Agent 蒸馏** 与
 *     **Agent 之间的交流**；
 *   · 设置页「03 · AI 大模型接入」加一个滑块，提示用户
 *     **截至 2026-09-23 前可免费使用网站提供的大模型**；
 *   · 该滑块**默认打开**。
 *
 * ── 为什么免费窗口要有服务端判定 ───────────────────────────────────────
 * 界面文案说了"截至 9-23"，那就必须真的在 9-23 之后停掉 ——
 * 否则文案就是假的，而且平台 Key 会被无限期白用。
 * 所以这里把"截止日期"落成代码，而不是只写在提示语里。
 *
 * ── 与 BYOK 的关系 ─────────────────────────────────────────────────────
 * 用户自己接入的模型（`LlmProviderConfig`）**始终可用**，不受这个窗口影响：
 * 免费额度是"我们送的"，BYOK 是"用户自己的"。免费期结束后，
 * 关掉平台模型的用户仍然可以用自己的 Key 跑蒸馏与对话。
 */

import { chatCompletion, type ChatMessage } from "./chat";

/**
 * 免费额度截止日（含当日），`Asia/Shanghai` 日历日。
 *
 * 需求原文：「提示用户截至 2026-09-23 前可免费使用网站提供的大模型」。
 * 允许用环境变量覆盖，方便延期时**不用改代码重新部署**；
 * 但默认值就是需求里承诺的那一天，改代码也不会悄悄变。
 */
export const FREE_UNTIL = process.env.PLATFORM_LLM_FREE_UNTIL?.trim() || "2026-09-23";

/** `YYYY-MM-DD` 视为该日 23:59:59（东八区）仍可用 */
const FREE_UNTIL_END = `${FREE_UNTIL}T23:59:59+08:00`;

/** 免费额度是否仍在有效期内 */
export function isFreeWindowOpen(now: Date = new Date()): boolean {
  const end = Date.parse(FREE_UNTIL_END);
  /* 日期写坏时**不放开**：宁可让用户用自己的 Key，也不能无限白用平台 Key */
  if (Number.isNaN(end)) return false;
  return now.getTime() <= end;
}

/**
 * 距离免费结束还剩几天（按 `Asia/Shanghai` 的**日历日**相减）。
 *
 * ⚠️ 不能用"小时数 ÷ 24 后向上取整"。那样在 2026-09-01 会算出 23 天，
 * 而实际只剩 22 天（截止到 9-23 结束）—— 界面写着"还剩 N 天"却多报一天，
 * 用户会以为还有富余。日历日相减才和用户的理解一致：
 *   9-01 → 22 天　9-22 → 1 天　9-23（当天）→ 0 天　9-24 起 → 0 天
 */
export function daysLeft(now: Date = new Date()): number {
  const end = Date.parse(FREE_UNTIL_END);
  if (Number.isNaN(end)) return 0;

  /* 取两端的"东八区日历日"（用 en-CA 拿 YYYY-MM-DD，便于直接比较） */
  const dayOf = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const endDay = Date.parse(`${dayOf(new Date(end))}T00:00:00+08:00`);
  const nowDay = Date.parse(`${dayOf(now)}T00:00:00+08:00`);
  const diff = Math.round((endDay - nowDay) / (24 * 60 * 60 * 1000));
  return diff <= 0 ? 0 : diff;
}

/** 平台侧是否配置了 Key（没配就没有"免费额度"这回事） */
export function platformLlmConfigured(): boolean {
  return Boolean((process.env.AI_API_KEY ?? "").trim());
}

export interface PlatformProvider {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** 平台模型的接入参数；未配置时为 null */
export function platformProvider(): PlatformProvider | null {
  const apiKey = (process.env.AI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return {
    /* ⚠️ 必须带 `/v1`：不带时该网关会返回一个 HTTP 200 的 SPA HTML，
       看起来"成功"但解析不出内容（实战踩过）。 */
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai-next.com/v1").trim(),
    apiKey,
    model: (process.env.AI_MODEL || "gpt-4o-mini").trim(),
  };
}

export interface PlatformAvailability {
  /** 平台 Key 是否已配置 */
  configured: boolean;
  /** 免费窗口是否仍开放 */
  freeOpen: boolean;
  /** 此刻是否**真的**可以用平台模型：已配置 且 免费窗口开放 */
  usable: boolean;
  /** 免费截止日（给界面展示） */
  freeUntil: string;
  /** 剩余天数 */
  daysLeft: number;
  /** 不可用时的原因，可直接给用户看 */
  reason?: string;
}

/** 汇总平台模型的当前可用性（页面与接口共用，避免两边判断不一致） */
export function platformAvailability(now: Date = new Date()): PlatformAvailability {
  const configured = platformLlmConfigured();
  const open = isFreeWindowOpen(now);
  const left = daysLeft(now);

  let reason: string | undefined;
  if (!configured) reason = "站点尚未配置平台大模型";
  else if (!open) reason = `免费额度已于 ${FREE_UNTIL} 结束，请接入自己的模型`;

  return {
    configured,
    freeOpen: open,
    usable: configured && open,
    freeUntil: FREE_UNTIL,
    daysLeft: left,
    reason,
  };
}

/**
 * 用户实际可用的模型来源。
 *
 * 优先级：**BYOK > 平台免费额度**。
 *
 * 为什么 BYOK 优先：用户自己填的 Key 代表他明确的偏好（可能是特定模型、
 * 特定区域、或为了数据不外流），没有理由让平台模型盖过它。
 *
 * @param prefs 用户的沟通偏好；`usePlatformLlm` 是设置页那个滑块
 * @param byok  已解密好的用户模型；传 null 表示没有 BYOK
 */
export function resolveLlmSource(
  prefs: { usePlatformLlm: boolean } | null,
  byok: PlatformProvider | null,
): { provider: PlatformProvider | null; source: "byok" | "platform" | "none"; reason?: string } {
  if (byok) return { provider: byok, source: "byok" };

  /* 用户关掉了滑块 → 明确不使用平台模型（尊重选择，不偷偷用） */
  const wantsPlatform = prefs?.usePlatformLlm ?? true;
  if (!wantsPlatform) {
    return { provider: null, source: "none", reason: "你已关闭「使用知遇提供的大模型」，且未接入自己的模型" };
  }

  const avail = platformAvailability();
  if (avail.usable) return { provider: platformProvider(), source: "platform" };

  return { provider: null, source: "none", reason: avail.reason };
}

/**
 * 只需要知道"**会不会用上大模型**"时的轻量判定（不需要真的拿到 Key）。
 *
 * 为什么单独有这个：调用方常常只配了 `byokCount` 这个计数（比如列表页、
 * 预检逻辑），手头没有解密后的 Key。原先的写法是硬造一个假 provider
 * `{ baseUrl: "", apiKey: "x", model: "" }` 传进 `resolveLlmSource` ——
 * 那是靠"对象非空"骗过判断，读代码的人无法分辨真假，也容易被误用。
 * 这里把意图写清楚。
 *
 * @param hasByok 该用户是否已接入自己的模型（查 count 或 findFirst 都行）
 */
export function planLlmSource(
  prefs: { usePlatformLlm: boolean } | null,
  hasByok: boolean,
): { source: "byok" | "platform" | "none"; reason?: string } {
  if (hasByok) return { source: "byok" };

  const wantsPlatform = prefs?.usePlatformLlm ?? true;
  if (!wantsPlatform) {
    return {
      source: "none",
      reason: "已关闭「使用知遇提供的大模型」，且未接入自己的模型",
    };
  }

  const avail = platformAvailability();
  if (avail.usable) return { source: "platform" };
  return { source: "none", reason: avail.reason };
}

/**
 * 用「用户可用的模型」跑一次补全。
 *
 * 把"选哪家模型"的逻辑收在一处，蒸馏与 Agent 对话都走它，
 * 避免两处各写一遍优先级而出现行为不一致。
 */
export async function chatWithResolvedLlm(
  prefs: { usePlatformLlm: boolean } | null,
  byok: PlatformProvider | null,
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<{ text: string; source: "byok" | "platform" }> {
  const r = resolveLlmSource(prefs, byok);
  if (!r.provider) throw new Error(r.reason ?? "没有可用的大模型");
  const text = await chatCompletion(r.provider, messages, opts);
  return { text, source: r.source as "byok" | "platform" };
}
