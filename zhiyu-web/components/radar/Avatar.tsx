/**
 * 角色头像。
 *
 * 规则（与原型一致）：
 *   1. 有真实头像（如已授权的知乎头像）→ 用它
 *   2. 否则按 **确定性哈希** 从本地角色插画池里取一张
 *
 * 为什么必须确定性：否则同一个人会在雷达、人格卡、通知里显示三张不同的脸。
 * 这是实际踩过的坑。哈希：h = (h×31 + charCode) % 100000，取模池长度。
 */

/** 本地角色插画池（7 张）。中心「我」固定用 self.webp。 */
export const AVATAR_POOL = [
  "linyue",
  "chenyu",
  "suqing",
  "limeng",
  "zhaoyi",
  "zhouming",
  "newfriend",
] as const;

export const AVATAR_BASE = "/assets/characters/";
/** 中心「我」的头像 */
export const SELF_AVATAR = `${AVATAR_BASE}self.webp`;

/** 确定性：同一 seed 永远同一张 */
export function localAvatarFor(seed: string): string {
  const key = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) % 100000;
  return `${AVATAR_BASE}${AVATAR_POOL[h % AVATAR_POOL.length]}.webp`;
}

/** 解析出最终要用的头像 URL */
export function resolveAvatar(opts: { avatarUrl?: string | null; seed: string }): string {
  const remote = opts.avatarUrl?.trim();
  if (remote) return remote;
  return localAvatarFor(opts.seed);
}

interface Props {
  /** 真实头像 URL；为空走本地兜底 */
  avatarUrl?: string | null;
  /** 确定性兜底的种子，通常传 persona id */
  seed: string;
  /** 无障碍文本；纯装饰时留空 */
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
  /** 有真实头像时加载失败，回退到本地插画（用 onError 切换） */
  onRemoteError?: () => void;
}

/**
 * 用原生 <img> 而不是 next/image：
 *  · 这些是本地静态插画，体积 10~18KB，不需要优化管线
 *  · next/image 对远程域名要求配 remotePatterns，而头像域名来自知乎授权、
 *    部署前无法确定，用原生 img 更省事且不引入配置耦合
 */
export default function Avatar({
  avatarUrl,
  seed,
  alt = "",
  className,
  width = 84,
  height = 84,
  onRemoteError,
}: Props) {
  const remote = avatarUrl?.trim();
  const src = remote || localAvatarFor(seed);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading="lazy"
      decoding="async"
      onError={remote && onRemoteError ? onRemoteError : undefined}
    />
  );
}
