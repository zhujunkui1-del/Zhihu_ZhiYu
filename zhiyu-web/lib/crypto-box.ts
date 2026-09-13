/**
 * 服务端密文存储：AES-256-GCM。
 *
 * 为什么每类密文用**独立的密钥域**（purpose）而不是共用一把：
 *   BYOK 的 LLM Key 与知乎 OAuth token 是不同敏感级别、不同撤销周期的东西，
 *   共用密钥意味着任何一处泄漏都波及另一处，也无法单独轮换。
 *   密钥域通过 HKDF 从主密钥派生，互不可推。
 *
 * 主密钥来自环境变量（Vercel Environment Variables）：
 *   AUTH_ENC_KEY   —— 会话与 OAuth token 用
 *   USER_LLM_KEY_ENC —— BYOK 用（历史实现，继续兼容）
 * 两者都是 32 字节 base64。也可以用同一个 AUTH_ENC_KEY 派生，
 * 见 resolveMasterKey() 的回落顺序。
 */

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";

export type Purpose = "llm-key" | "zhihu-oauth-token";

const ENV_FOR_PURPOSE: Record<Purpose, string[]> = {
  /* BYOK 沿用既有变量名，避免破坏已存数据 */
  "llm-key": ["USER_LLM_KEY_ENC", "AUTH_ENC_KEY"],
  "zhihu-oauth-token": ["AUTH_ENC_KEY"],
};

function parseKey(raw: string, envName: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`${envName} 必须是 32 字节的 base64（当前解出 ${buf.length} 字节）`);
  }
  return buf;
}

/**
 * 取主密钥。
 *
 * 生产环境（NODE_ENV=production）**必须**显式配置，否则直接抛错 ——
 * 不允许在生产用派生自常量的密钥，那等于没有加密。
 * 开发环境允许回落，这样本地不必先配密钥就能跑通全流程。
 */
function resolveMasterKey(purpose: Purpose): Buffer {
  const candidates = ENV_FOR_PURPOSE[purpose];
  for (const name of candidates) {
    const raw = process.env[name];
    if (raw) return parseKey(raw, name);
  }

  if (process.env.NODE_ENV === "production") {
    /* 报错要把**所有可接受的变量名**都说出来。
       之前只说 candidates[0]，于是只配了 AUTH_ENC_KEY 的用户会看到
       「未配置 USER_LLM_KEY_ENC」而以为自己配错了。 */
    throw new Error(
      `未配置加密密钥：生产环境必须提供 32 字节 base64 的主密钥。` +
        `请设置 ${candidates.join(" 或 ")} 中的任意一个。`,
    );
  }
  /* 开发兜底：由固定串派生，仅供本地调试；生产走不到这里 */
  return Buffer.from(
    hkdfSync("sha256", "zhiyu-dev-master-key", "zhiyu-local", "dev", 32),
  ) as Buffer;
}

/** 按密钥域派生实际使用的 32 字节密钥 */
function purposeKey(purpose: Purpose): Buffer {
  const master = resolveMasterKey(purpose);
  return Buffer.from(hkdfSync("sha256", master, "zhiyu-purpose", purpose, 32)) as Buffer;
}

/**
 * 加密。输出 base64(iv ‖ tag ‖ ciphertext)。
 * 刻意带上 purpose 前缀，避免把一类密文当另一类解开（会直接认证失败，便于定位误用）。
 */
export function encryptFor(purpose: Purpose, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", purposeKey(purpose), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${purpose}:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

/** 解密；格式或密钥域不符时抛错 */
export function decryptFor(purpose: Purpose, payload: string): string {
  const prefix = `${purpose}:`;
  if (!payload.startsWith(prefix)) {
    throw new Error(`密文密钥域不符：期望 ${purpose}`);
  }
  const raw = Buffer.from(payload.slice(prefix.length), "base64");
  if (raw.length < 28) throw new Error("密文格式错误");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", purposeKey(purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** 掩码展示 */
export function maskSecret(plain: string): string {
  const t = plain.trim();
  return t.length <= 4 ? "****" : `****${t.slice(-4)}`;
}

/**
 * 当前环境是否具备加密能力（供设置页/健康检查提示用）。
 * 返回缺哪个变量，便于在 UI 上给出**具体**提示而不是笼统"配置错误"。
 */
export function encryptionStatus(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const purpose of Object.keys(ENV_FOR_PURPOSE) as Purpose[]) {
    if (!ENV_FOR_PURPOSE[purpose].some((n) => process.env[n])) {
      missing.push(ENV_FOR_PURPOSE[purpose][0]);
    }
  }
  /* 开发环境会自动回落，所以不算缺失 */
  if (process.env.NODE_ENV !== "production") return { ok: true, missing: [] };
  return { ok: missing.length === 0, missing };
}
