/**
 * CSRF 防护：拒绝跨站发起的「状态变更请求」。
 *
 * 判定逻辑在 `lib/auth/same-origin.ts`（纯函数、可单测）；
 * 这里只负责把它接成 Next.js 的 403 响应。
 *
 * 为什么需要它：会话 Cookie 已改为生产环境 `SameSite=None`
 * （为了修 Safari 上的知乎 OAuth 回跳，见 `lib/auth/cookie.ts` 的说明）。
 * `Lax` 原本提供的隐式 CSRF 保护因此消失，必须在此显式补回。
 *
 * 用法（放在每个状态变更 handler 最前面）：
 * ```ts
 * const blocked = denyIfCrossSite(req);
 * if (blocked) return blocked;
 * ```
 */

import { NextRequest, NextResponse } from "next/server";
import {
  sameOriginVerdict,
  type SameOriginVerdict,
} from "./same-origin";

export type { SameOriginVerdict };

/**
 * 从请求头推出"浏览器看到的本站 origin"。
 *
 * ⚠️ **不能用 `req.nextUrl.origin`。** 实测（scripts/debug-csrf-origin.mjs）：
 *   dev server 监听时 `nextUrl.origin` 恒为 `http://localhost:3000`，
 *   而浏览器访问 `127.0.0.1:3000` 时发的 `Origin` 是 `http://127.0.0.1:3000`
 *   —— 两者不等，于是**站内请求被自己的 CSRF 校验拒掉**（写操作全 403）。
 *   Vercel 上同理：`nextUrl.origin` 可能解析成部署内部域名，
 *   而浏览器发的是自定义域名。
 *
 * 正确做法是还原浏览器眼里的地址：协议取 `x-forwarded-proto`，
 * 主机取 `x-forwarded-host` / `host`。这两个头由浏览器设置、经 Vercel 边缘
 * 透传，页面 JS 改不了，因此可以信任。
 */
function requestOrigin(req: NextRequest): string {
  const h = req.headers;
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || req.nextUrl.host;
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    req.nextUrl.protocol.replace(":", "") ||
    "https";
  return `${proto}://${host}`;
}

/** 判定 NextRequest 是否可信（同源） */
export function checkSameOrigin(req: NextRequest): SameOriginVerdict {
  return sameOriginVerdict({ origin: requestOrigin(req), headers: req.headers });
}

/** 同源校验失败时返回 403；通过时返回 null */
export function denyIfCrossSite(req: NextRequest): NextResponse | null {
  const v = checkSameOrigin(req);
  if (v.ok) return null;
  return NextResponse.json(
    {
      ok: false,
      code: "CROSS_SITE_BLOCKED",
      error: `请求来源不是本站，已拒绝（CSRF 防护：${v.reason}）`,
    },
    { status: 403 },
  );
}
