/**
 * 「这个请求是不是本站发出的」的**纯判定**（无框架依赖，可直接单测）。
 *
 * 为什么单独成文件：判定逻辑是安全关键，必须能脱离 Next.js 运行时被验证。
 * 返回 403 的那一层在 `lib/auth/csrf.ts`（依赖 NextResponse）。
 *
 * ── 背景 ─────────────────────────────────────────────────────────────
 * 会话 Cookie 曾经是 `SameSite=Lax`，它**本身就是**主要的 CSRF 防线：
 * 跨站请求不会带上这个 Cookie，攻击者的页面就无法冒用用户身份。
 *
 * 但 `SameSite=Lax` 在 Safari 上会破坏知乎 OAuth 回跳：
 * 从 `openapi.zhihu.com` 授权后跳回本站时，Safari（含 iOS）**不发送**
 * 刚设置的 Lax Cookie，用户表现为"授权完又回到登录页"。
 * WebKit 上这是长期未修的问题（bug 219650，多个 OAuth 集成方复现），
 * 社区解法是改用 `SameSite=None; Secure`。
 *
 * 一旦改成 `None`，那条隐式防线就没了 —— 所以必须在这里补一条**显式**校验。
 * 否则就是"修一个 bug、开一个洞"。
 */

/** 判定只需要 origin 与请求头，因此不绑定 NextRequest 类型 */
export interface SameOriginInput {
  origin: string;
  headers: { get(name: string): string | null };
}

export interface SameOriginVerdict {
  ok: boolean;
  /** 被拒绝时的机器可读原因 */
  reason?: "ORIGIN_MISMATCH" | "REFERER_MISMATCH" | "NO_ORIGIN";
  /** 观测到的来源，便于排查 */
  seen?: string;
}

/** 从 Referer 里取 origin；解析失败返回 null */
function originOfReferer(ref: string | null): string | null {
  if (!ref) return null;
  try {
    return new URL(ref).origin;
  } catch {
    return null;
  }
}

/**
 * 判定请求是否与本站同源。
 *
 * 判据（对浏览器而言可靠）：
 *   · 带 `Origin`  → 必须与本站同源
 *   · 不带 `Origin` 但有 `Referer` → Referer 的 origin 必须与本站同源
 *   · 两者都没有 → 视为伪造，拒绝
 *
 * 为什么"看不到 Origin 就拒绝"是安全的：现代浏览器对**所有**跨站的
 * （以及多数同源的）POST/PATCH/PUT/DELETE 都会带 `Origin`，且页面 JS
 * 无法篡改它。拿不到 Origin 的只剩非浏览器客户端，而本项目没有对外 API。
 *
 * 注意**不用** `Sec-Fetch-Site` 作为唯一依据：Safari 支持较晚；
 * Origin/Referer 组合已足够且兼容性更好。
 */
export function sameOriginVerdict(req: SameOriginInput): SameOriginVerdict {
  const self = req.origin;
  const origin = req.headers.get("origin");

  if (origin) {
    return origin === self
      ? { ok: true, seen: origin }
      : { ok: false, reason: "ORIGIN_MISMATCH", seen: `${origin} ≠ ${self}` };
  }

  const refOrigin = originOfReferer(req.headers.get("referer"));
  if (refOrigin) {
    return refOrigin === self
      ? { ok: true, seen: refOrigin }
      : { ok: false, reason: "REFERER_MISMATCH", seen: `${refOrigin} ≠ ${self}` };
  }

  return { ok: false, reason: "NO_ORIGIN", seen: "既无 Origin 也无 Referer" };
}
