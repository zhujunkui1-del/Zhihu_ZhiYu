/**
 * 会话 Cookie 的属性（**无任何依赖**，可被纯 Node 测试直接 import）。
 *
 * 为什么单独成文件：原本这几个属性写在 `lib/auth/session.ts` 里，而那个模块
 * import 了 Prisma 与 `@/` 别名 —— 于是想单独测"Cookie 到底是什么属性"
 * 就必须起整个数据库栈，测试写不动，属性也就没人守。
 * 而这几行恰恰是 #2（手机端授权后跳回登录页）的修复点，必须能被独立验证。
 */

export const SESSION_COOKIE = "zhiyu_session";
/** 会话有效期：30 天 */
export const SESSION_DAYS = 30;

/**
 * ⚠️ **生产环境必须是 `SameSite=None`，不能是 `Lax`。**
 *
 * 原因（手机端"授权后又跳回登录页"的根因）：
 *   知乎授权完成后，浏览器从 `openapi.zhihu.com` 跳回本站回调地址。
 *   Safari（含 iOS）在这个"第三方站点跳回"的流程里**不发送**
 *   `SameSite=Lax` 的 Cookie —— 于是回调设置的会话在紧接着的请求里读不到，
 *   页面判定未登录，把用户送回登录页。
 *   WebKit 上这是长期未修的问题（bug 219650，Stripe / NextAuth 等
 *   集成方都复现过），社区通行解法就是改用 `SameSite=None`。
 *
 *   注意这不只是"发不发"的问题：Safari 连**读回**自己刚拿到的 Lax Cookie
 *   都会失败，因此桌面 Chrome 正常、手机上却始终登录不上。
 *
 * `SameSite=None` 要求同时带 `Secure`，所以本地 http 开发不能用它 ——
 * 本地没有第三方回跳（回调就在 localhost），`Lax` 完全够用。
 *
 * 因为这里削弱了 Cookie 这条隐式 CSRF 防线，**所有状态变更接口都必须
 * 显式做同源校验**，见 `lib/auth/csrf.ts` 的 `denyIfCrossSite()`。
 */
export function sessionCookieOptions(value: string, maxAgeSeconds?: number) {
  const secure = process.env.NODE_ENV === "production";
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    path: "/",
    maxAge: maxAgeSeconds ?? SESSION_DAYS * 24 * 60 * 60,
  };
}

/**
 * 清除会话 Cookie 用的属性。
 *
 * 必须与写入时**同 name/domain/path/SameSite/Secure**，否则浏览器认为
 * 不是同一个 Cookie 而不删 —— 表现为"点了退出但还登录着"。
 */
export function clearedSessionCookieOptions() {
  return { ...sessionCookieOptions("", 0) };
}
