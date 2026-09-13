/**
 * 日期时间的统一格式化。
 *
 * 为什么必须集中在这里：
 * 服务端（Vercel / Node）默认跑在 **UTC**，而浏览器在用户本地时区。
 * 如果两边都用 `toLocaleString("zh-CN")` 而不指定时区，会渲染出**不同的文本**
 * （实测差 8 小时：SSR `09/13 16:40` vs 客户端 `09/14 00:40`），
 * 触发 React hydration 不一致（#418），React 会丢弃整棵服务端树在客户端重建。
 *
 * 所以：**所有面向界面的时间都走这里**，显式钉死时区。
 * 本产品面向中文用户，统一按 `Asia/Shanghai` 展示；
 * 用户之间的相对关系（谁更新）不受影响，因为排序用的是原始时间戳。
 */

/** 展示时区：与目标用户一致，且服务端与客户端算出同一结果 */
export const DISPLAY_TZ = "Asia/Shanghai";

const pad = (n: number) => String(n).padStart(2, "0");

/** 拿到某个时刻在展示时区下的年月日时分 */
function partsIn(d: Date) {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: DISPLAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour === "24" ? "00" : p.hour,
    minute: p.minute,
  };
}

/** 取某个时刻在展示时区下的"日期键"，用于判断是否同一天 */
function dayKey(d: Date): string {
  const p = partsIn(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * 列表用的紧凑时间：今天 / 昨天 / MM/DD HH:mm
 *
 * @param now 便于测试与确定性渲染传入基准时间；默认取当前时间
 */
export function formatListTime(input: Date | string, now: Date = new Date()): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";

  const p = partsIn(d);
  const hm = `${p.hour}:${p.minute}`;

  if (dayKey(d) === dayKey(now)) return `今天 ${hm}`;

  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  if (dayKey(d) === dayKey(yesterday)) return `昨天 ${hm}`;

  return `${p.month}/${p.day} ${hm}`;
}

/** 详情用的完整时间：YYYY/MM/DD HH:mm */
export function formatFullTime(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** 只要日期：YYYY/MM/DD */
export function formatDate(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d);
  return `${p.year}/${p.month}/${p.day}`;
}

/** 只要时分：HH:mm */
export function formatClock(input: Date | string): string {
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "";
  const p = partsIn(d);
  return `${pad(Number(p.hour))}:${p.minute}`;
}
