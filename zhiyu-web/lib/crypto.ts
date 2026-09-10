// 用户 BYOK API Key 加密：AES-256-GCM，密钥来自 USER_LLM_KEY_ENC（32 字节 base64）
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

function key(): Buffer {
  const raw = process.env.USER_LLM_KEY_ENC;
  if (!raw) {
    throw new Error("USER_LLM_KEY_ENC 未配置");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("USER_LLM_KEY_ENC 必须是 32 字节的 base64");
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 28) throw new Error("密文格式错误");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function keyMask(plain: string): string {
  const t = plain.trim();
  return t.length <= 4 ? "****" : `****${t.slice(-4)}`;
}
