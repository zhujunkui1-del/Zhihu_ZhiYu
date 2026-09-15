/**
 * 知乎链接的**唯一修正处**。
 *
 * ── 两个实测 bug ──────────────────────────────────────────────────────────
 *  ① 人格卡里「知乎公开内容」的跳转链接是 `https://www.zhiyuapp.site/pins/1533…`
 *     —— 打不开。原因：开放平台/公开端点返回的 `url` 是**站内相对路径**
 *     （`/pins/<id>`、`/answer/<id>`），我们直接塞进 `href`，浏览器就按
 *     本站域名解析了。
 *  ② 头像旁的昵称不是链接。产品要求：点昵称应打开 TA 的知乎主页
 *     （`https://www.zhihu.com/people/<url_token>`，如 liu-hao-ran-18-45）。
 *
 * 为什么修在**读**这一侧：库里的 600+ 条证据 url 已经按相对路径存好了，
 * 只改写入端的话，老数据依旧是坏链 —— 这类"历史数据也要一起好"的修正，
 * 必须放在渲染前。
 */

const ZHIHU_ORIGIN = "https://www.zhihu.com";

/**
 * 把可能是相对路径的知乎链接补成绝对地址。
 *
 * 规则尽量保守，**不猜**：
 *   · 已经是 `http(s)://` 的：原样返回（哪怕是别的站，也不是我们该改的）
 *   · `//host/...` 协议相对：补 https
 *   · `/pins/...` `/answer/...` 这类站内路径：补知乎域名
 *   · 空值 / 其它：返回 null，调用方**不渲染链接**（宁可不给，也不给坏链）
 */
export function zhihuAbsoluteUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  /**
   * `/pins/<id>` → `/pin/<id>`（复数改单数）。
   *
   * 依据：**官方开放平台返回的就是单数** `/pin/<id>`（库里 615 条走新版接口的
   * 证据全是这个形式），而早期用公开端点回填的那批存的是旧式复数 `/pins/<id>`
   * —— 用户点开正是这一批报"跑不通"。
   * 我无法从这里实测两种形式（知乎对非浏览器请求一律 403），所以按官方口径归一：
   * 单数是平台自己在用的形式，改过去只会更对。
   */
  const normalized = s.replace(/^\/pins\//, "/pin/");

  if (/^https?:\/\//i.test(normalized)) {
    /* 绝对地址也要顺手归一（老数据里可能是绝对形式的旧路径） */
    return normalized.replace(/^(https?:\/\/(?:www\.)?zhihu\.com)\/pins\//, "$1/pin/");
  }
  if (normalized.startsWith("//")) return `https:${normalized}`;
  if (normalized.startsWith("/")) return `${ZHIHU_ORIGIN}${normalized}`;
  return null;
}

/**
 * 知乎个人主页地址。
 *
 * ⚠️ 必须先有 `url_token`（存在 `Persona.publicRef`）：
 * 公开端点读别人时**不返回 url_token**（实测：只有 author_name），
 * 所以这个值是从"你自己的关注列表"带回来的。
 * 没有 token 就返回 null —— 界面不要显示一个点进去 404 的链接。
 */
export function zhihuProfileUrl(urlToken: string | null | undefined): string | null {
  const t = (urlToken ?? "").trim();
  if (!t) return null;
  /* 只允许 token 字符，避免把奇怪的字符串拼进 URL */
  if (!/^[A-Za-z0-9_\-%.]+$/.test(t)) return null;
  return `${ZHIHU_ORIGIN}/people/${encodeURIComponent(t)}`;
}
