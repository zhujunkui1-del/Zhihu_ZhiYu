/**
 * 侧栏用户信息（头像 + 名称）。
 *
 * 需求（#8）：侧栏「设置」**上方**显示用户知乎头像 + 名称，圆形头像 + 名称，
 * **无交互**（不是按钮，不跳转）。抓不到知乎信息时用
 * `前端UI/…/assets/characters` 里的随机图 + 随机用户名 `zhiyu000000`
 * （zhiyu + 6 位随机字母数字）。
 *
 * 两个关键设计：
 *
 * ① **名称与头像必须是"稳定的"随机，不能每次渲染都变。**
 *    曾经原型里的随机兜底每次加载都换一张脸 —— 用户会以为登录成了别人。
 *    所以这里统一用 seed（优先 userId）做稳定散列：同一个人永远同一张图、
 *    同一个名字，跨刷新、跨设备一致。原型 `zhiyu-avatar.js` 的注释里
 *    也明确写了"避免随机导致同一人换头像"。
 *
 * ② 知乎头像的字段是 `avatar_path`（不是 `avatar_url`），且开放平台在
 *    **无权限时返回空串**。空串、"default" 这类占位图都算"抓不到"，
 *    必须走兜底，否则侧栏会出现一个灰块或裂图。
 */

/** 可用角色插画（与 public/assets/characters 下的文件一一对应） */
export const CHARACTER_FILES = [
  "self",
  "newfriend",
  "linyue",
  "chenyu",
  "suqing",
  "limeng",
  "zhaoyi",
  "zhouming",
] as const;

/** 展示兜底头像时优先用哪个（"我" 用 self 更自然） */
const SELF_FIRST = ["self", ...CHARACTER_FILES.filter((f) => f !== "self")] as const;

export function characterAvatar(file: string): string {
  return `/assets/characters/${file}.webp`;
}

/**
 * 稳定散列（与原型 zhiyu-avatar.js 的算法同族，取模换成正整数域）。
 * 用 FNV-1a 而不是 Java 式 `h*31+c`：后者在长字符串上更容易撞。
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 取字符串第 n 段散列，避免"同一 seed 下名字与头像总是联动" */
function hashAt(s: string, n: number): number {
  return hash(`${s}#${n}`);
}

const RANDOM_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * 生成 `zhiyu` + 6 位随机字母数字。
 *
 * 需求写的是"随机用户名 zhiyu000000（6 位随机字母数字）"。
 * 这里用 seed 派生而不是 `Math.random()`：服务端渲染与客户端水合必须得到
 * **同一个**名字，否则 React 会报 hydration 不一致。
 */
export function randomUsername(seed: string): string {
  let out = "zhiyu";
  let h = hashAt(seed, 7);
  for (let i = 0; i < 6; i += 1) {
    out += RANDOM_ALPHABET[h % RANDOM_ALPHABET.length];
    h = Math.floor(h / RANDOM_ALPHABET.length) || hashAt(`${seed}:${i}`, 11);
  }
  return out;
}

/** 稳定的角色头像路径（同一个 seed 永远同一张图） */
export function randomCharacter(seed: string): string {
  const file = SELF_FIRST[hashAt(seed, 3) % SELF_FIRST.length];
  return characterAvatar(file);
}

/**
 * 判断知乎给的头像地址能不能用。
 *
 * **只看"有没有拿到地址"，不做"是不是默认灰头像"的判断。**
 *
 * 为什么不做：实测（scripts/check-avatar-variants.mjs）发现知乎图片服务
 * 会忽略分辨率后缀 —— 同一个 hash 加 `_l/_s/_xs/_m` 全部返回 200，
 * 且 `_xs` 也返回一张 8.6KB 的正常图。也就是说 URL 形态里**没有任何可靠
 * 特征**能区分"用户自己设的头像"和"站方默认头像"。靠哈希前缀猜是编造。
 *
 * 拿不准时的策略：地址存在就用它。真图加载失败由 <img onError> 在前端
 * 兜底换成角色插画（见 AppShell），比在服务端误判丢掉用户真实头像更安全。
 */
function usableAvatar(url: string): boolean {
  return /^https?:\/\//.test(url.trim());
}

export interface SidebarUser {
  /** 显示名（永远是可用字符串） */
  name: string;
  /** 头像地址（永远是可用地址） */
  avatar: string;
  /** 是真实知乎头像还是本地兜底插画 —— 用于给图片一个合适的 alt */
  kind: "zhihu" | "generated";
}

/**
 * 本地演示用户的固定显示名。
 *
 * 它不是"用户自己的名字"，所以侧栏不用它，改走随机名兜底
 * —— 需求明确要求抓不到时显示 `zhiyu000000` 形态的用户名。
 */
const DEMO_PLACEHOLDER_NAME = "演示用户";

/**
 * 解析侧栏要展示的用户信息。
 *
 * @param user 库里的用户行；未登录时传 null（生产不会走到，本地兜底用）
 */
export function resolveSidebarUser(
  user: { id: string | null; displayName: string | null; avatarUrl: string | null } | null,
): SidebarUser {
  /* 完全没身份（本地未登录）也要能渲染出东西，且多次渲染保持一致 */
  const seed = user?.id ?? "zhiyu-guest";

  const rawName = user?.displayName?.trim() ?? "";
  const name =
    rawName && rawName !== DEMO_PLACEHOLDER_NAME ? rawName : randomUsername(seed);

  const rawAvatar = user?.avatarUrl?.trim() ?? "";
  const usable = usableAvatar(rawAvatar);

  return usable
    ? { name, avatar: rawAvatar, kind: "zhihu" }
    : { name, avatar: randomCharacter(seed), kind: "generated" };
}
