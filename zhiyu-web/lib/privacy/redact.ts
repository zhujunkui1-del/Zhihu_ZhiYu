/**
 * 外发文本脱敏。
 *
 * ── 为什么必须有这一层 ────────────────────────────────────────────────────
 * 用户把微信/QQ 私聊、飞书/钉钉文档导进来，这些原文会整段进
 * `lib/persona/distill.ts` 的证据包，发给**外部 LLM 服务商**。
 * 实测一份真实微信私聊里就出现过：手机号、身份证式长数字、
 * base64 凭证串（解出来是 IP:端口）、以及转发的群聊记录。
 * 这些一旦外发就收不回来了。
 *
 * ── 设计原则 ──────────────────────────────────────────────────────────────
 *   ① **只作用于外发文本，不改库里原文** —— 用户自己还要看自己的聊天记录，
 *      就地打码等于把用户的数据弄坏。
 *   ② **宁可漏，不可误伤** —— 长数字串不是号码的情况太多（时间戳、订单号、
 *      验证码、版本号），所以带校验的（身份证校验位、银行卡 Luhn）才敢打码，
 *      纯 11 位还要求前后不是数字。
 *   ③ **留下痕迹** —— 返回命中条数，界面要如实告诉用户"替换了几处再交给模型"，
 *      而不是悄悄改了他的数据。
 *
 * 刻意**不做**的：裸 IPv4 不动（用户可能在正经讨论网络配置，误伤成本高于收益）；
 * 用户名/昵称不动（那是蒸馏材料本身，打掉就没法分析了）。
 */

export interface RedactHit {
  /** 规则名，如「手机号」 */
  rule: string;
  count: number;
}

export interface RedactResult {
  text: string;
  hits: RedactHit[];
  /** 命中总处数 */
  total: number;
}

/* ── 校验函数 ───────────────────────────────────────────────────────────── */

/** 中国大陆身份证：18 位，最后一位是前 17 位的加权校验位 */
function isChinaId(s: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(s)) return false;
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const check = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(s[i]) * w[i];
  return check[sum % 11] === s[17].toUpperCase();
}

/** 银行卡 Luhn 校验 */
function luhn(s: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    let n = Number(s[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** 前后紧邻是不是数字（用于判断是否为一个独立数字串） */
function isolated(text: string, start: number, len: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = start + len < text.length ? text[start + len] : "";
  return !/\d/.test(before) && !/\d/.test(after);
}

interface DigiRule {
  rule: string;
  re: RegExp;
  placeholder: string;
  /** 命中后再校验一次，不通过就当没看见 */
  verify?: (s: string) => boolean;
  /** 额外要求：必须是个独立数字串 */
  isolatedOnly?: boolean;
}

/** 数字类规则：身份证 → 银行卡 → 手机号（长的先跑，避免 18 位被 11 位规则切碎） */
const DIGIT_RULES: DigiRule[] = [
  { rule: "身份证", re: /\d{17}[\dXx]/g, placeholder: "[身份证]", verify: isChinaId, isolatedOnly: true },
  { rule: "银行卡", re: /\d{16,19}/g, placeholder: "[银行卡]", verify: luhn, isolatedOnly: true },
  { rule: "手机号", re: /1[3-9]\d{9}/g, placeholder: "[手机号]", isolatedOnly: true },
];

/** 文本类规则：顺序无关，一次过一遍 */
const TEXT_RULES: { rule: string; re: RegExp; placeholder: string }[] = [
  { rule: "邮箱", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, placeholder: "[邮箱]" },
  {
    rule: "密钥",
    re: /\b(?:sk|pk|ghp|gho|glpat|xox[baprs])[-_][A-Za-z0-9_\-]{16,}\b/g,
    placeholder: "[密钥]",
  },
  /* AWS 的 Access Key 没有分隔符：AKIA + 16 位大写字母数字 */
  { rule: "密钥", re: /\bAKIA[0-9A-Z]{16}\b/g, placeholder: "[密钥]" },
  { rule: "Bearer", re: /\bBearer\s+[A-Za-z0-9._\-]{20,}/gi, placeholder: "Bearer [密钥]" },
  /**
   * 长随机串（base64 / base64url）。
   * 40 位以上、必须含数字 —— 纯字母的 40 位串更可能是单词或哈希前缀，
   * 而带数字的长串基本就是 token、签名或编码后的凭据。
   *
   * ⚠️ 必须**以字母或数字开头**：字符类里含 `/`，若不限定开头，
   * `easyn2n://xxxx` 会把 `//` 一起吃掉，变成 `easyn2n:[凭据]`（实测踩过），
   * 那样连"这是条链接"都看不出来了。
   */
  { rule: "凭据串", re: /[A-Za-z0-9][A-Za-z0-9+/\-_]{39,}={0,2}/g, placeholder: "[凭据]" },
];

/** 凭据串的额外判断：必须有数字，且不能是中文（中文不在字符类里，天然排除） */
function looksLikeCredential(s: string): boolean {
  return /\d/.test(s) && !/^[A-Za-z]+$/.test(s);
}

/**
 * 对外唯一入口：把一段文本里的敏感信息替换成占位符。
 *
 * @returns 替换后的文本 + 每类命中的条数（没命中时 `total === 0`，文本原样返回）
 */
export function redactText(input: string): RedactResult {
  if (!input) return { text: input, hits: [], total: 0 };

  let text = input;
  /* 按规则名归并计数（「密钥」有两条正则，对用户只该显示成一类） */
  const counts = new Map<string, number>();
  const bump = (rule: string) => counts.set(rule, (counts.get(rule) ?? 0) + 1);

  for (const r of DIGIT_RULES) {
    text = text.replace(r.re, (match, offset: number, whole: string) => {
      if (r.isolatedOnly && !isolated(whole, offset, match.length)) return match;
      if (r.verify && !r.verify(match)) return match;
      bump(r.rule);
      return r.placeholder;
    });
  }

  for (const r of TEXT_RULES) {
    text = text.replace(r.re, (match) => {
      if (r.rule === "凭据串" && !looksLikeCredential(match)) return match;
      bump(r.rule);
      return r.placeholder;
    });
  }

  const hits: RedactHit[] = [...counts].map(([rule, count]) => ({ rule, count }));
  return { text, hits, total: hits.reduce((s, h) => s + h.count, 0) };
}

/** 命中摘要，给界面用：「手机号×2 邮箱×1」 */
export function describeHits(hits: RedactHit[]): string {
  return hits.map((h) => `${h.rule}×${h.count}`).join(" ");
}

/**
 * 批量脱敏（消息数组）。给 LLM 客户端当咽喉用：
 * 每一条 content 都过一遍，返回新的数组，不改原对象。
 */
export function redactMessages<T extends { content: string }>(messages: T[]): T[] {
  return messages.map((m) => ({ ...m, content: redactText(m.content).text }));
}
