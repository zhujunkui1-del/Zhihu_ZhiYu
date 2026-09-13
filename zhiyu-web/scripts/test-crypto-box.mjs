#!/usr/bin/env node
/**
 * 加密与密钥域隔离测试（纯 Node，不依赖 Next 路径别名）。
 *
 * 用法：node --env-file=.env scripts/test-crypto-box.mjs
 */
import { encryptFor, decryptFor, maskSecret, encryptionStatus } from "../lib/crypto-box.ts";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("加密与密钥域测试（AES-256-GCM）");
console.log("=".repeat(80));

/* ① 往返 */
{
  const plain = "ZHIHU_ACCESS_TOKEN_abc123";
  const cipher = encryptFor("zhihu-oauth-token", plain);
  rec("加密后能原样解回", decryptFor("zhihu-oauth-token", cipher) === plain);
  rec("密文不是明文（确实加密了）", !cipher.includes(plain), cipher.slice(0, 34) + "…");
}

/* ② 同一明文两次加密结果不同（随机 IV） */
{
  const a = encryptFor("zhihu-oauth-token", "same");
  const b = encryptFor("zhihu-oauth-token", "same");
  rec("同明文两次加密密文不同（随机 IV）", a !== b, `${a.slice(0, 24)}… vs ${b.slice(0, 24)}…`);
  rec("两者都能解回同一个明文",
    decryptFor("zhihu-oauth-token", a) === "same" && decryptFor("zhihu-oauth-token", b) === "same");
}

/* ③ 密钥域隔离 */
{
  const c = encryptFor("zhihu-oauth-token", "v");
  let err = "";
  try {
    decryptFor("llm-key", c);
  } catch (e) {
    err = e.message;
  }
  rec("跨密钥域解密被拒", err.includes("密钥域不符"), err);
}

/* ④ GCM 完整性：篡改必失败 */
{
  const c = encryptFor("llm-key", "value");
  let err = "";
  try {
    decryptFor("llm-key", c.slice(0, -6) + "AAAAAA");
  } catch (e) {
    err = e.message;
  }
  rec("篡改密文后解密失败（GCM 认证标签生效）", err.length > 0, err.slice(0, 50));
}

/* ⑤ 非法输入 */
{
  let e1 = "";
  try {
    decryptFor("llm-key", "llm-key:not-base64!!!");
  } catch (e) {
    e1 = e.message;
  }
  rec("非法密文格式被拒", e1.length > 0, e1.slice(0, 50));

  let e2 = "";
  try {
    decryptFor("llm-key", "短");
  } catch (e) {
    e2 = e.message;
  }
  rec("无密钥域前缀的密文被拒", e2.includes("密钥域"), e2.slice(0, 50));
}

/* ⑥ 中文与大 payload */
{
  const plain = "中文密钥内容 with mixed ASCII · " + "x".repeat(4096);
  const c = encryptFor("zhihu-oauth-token", plain);
  rec("中文与长内容往返一致", decryptFor("zhihu-oauth-token", c) === plain,
    `${plain.length} 字符`);
}

/* ⑦ 掩码 */
rec("掩码只露末 4 位", maskSecret("abcdefghijk") === "****hijk", maskSecret("abcdefghijk"));
rec("短串全掩", maskSecret("ab") === "****", maskSecret("ab"));

/* ⑧ 环境状态（开发环境应可用） */
{
  const st = encryptionStatus();
  rec("开发环境报告加密可用", st.ok === true, JSON.stringify(st));
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
