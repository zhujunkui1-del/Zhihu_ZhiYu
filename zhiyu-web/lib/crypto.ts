/**
 * 用户 BYOK API Key 的加密。
 *
 * 这是**兼容层**：真正的实现统一在 `lib/crypto-box.ts`
 * （按用途派生独立密钥域，主密钥回落 `USER_LLM_KEY_ENC` → `AUTH_ENC_KEY`）。
 *
 * 为什么改：本文件原来硬依赖 `USER_LLM_KEY_ENC`，而生产只配了 `AUTH_ENC_KEY`，
 * 于是「保存模型」在生产会直接报错，且与 `crypto-box` 的回落逻辑不一致。
 * 现在两者走同一条路径，配任意一个都能用。
 *
 * 历史密文说明：旧实现用 `USER_LLM_KEY_ENC` 直接作 AES 密钥（无 HKDF 派生），
 * 与现在的派生密钥不同。切换时已确认库中 `LlmProviderConfig` 为 0 行，
 * 因此无需保留旧格式的解密兼容。
 */

import { decryptFor, encryptFor, maskSecret } from "@/lib/crypto-box";

export function encryptSecret(plain: string): string {
  return encryptFor("llm-key", plain);
}

export function decryptSecret(payload: string): string {
  return decryptFor("llm-key", payload);
}

export function keyMask(plain: string): string {
  return maskSecret(plain);
}
