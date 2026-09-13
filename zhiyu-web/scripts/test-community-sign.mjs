#!/usr/bin/env node
/**
 * 知乎社区 API 签名实现测试（纯本地，不发网络请求）。
 *
 * 为什么值得测：签名算法是文档**唯一给全了**的部分，也是出错最难排查的部分
 * （签错只会得到 101，看不出哪里错）。这里按文档的待签名字符串格式逐字节核对。
 *
 * 用法：node --env-file=.env scripts/test-community-sign.mjs
 */
import { createHmac } from "node:crypto";
import { buildHeaders, sign, CIRCLES } from "../lib/zhihu/community-api.ts";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

const APP_KEY = "0anq7q";
const APP_SECRET = "test-secret-for-unit-test";

console.log("社区 API 签名测试（本地）");
console.log("=".repeat(80));

/* ① 待签名字符串格式必须与文档逐字一致 */
{
  const ts = "1700000000";
  const logId = "request_1700000000000000000";
  const extra = "";
  const expectedStr = `app_key:${APP_KEY}|ts:${ts}|logid:${logId}|extra_info:${extra}`;
  const expected = createHmac("sha256", APP_SECRET).update(expectedStr, "utf8").digest("base64");
  const actual = sign({ appKey: APP_KEY, appSecret: APP_SECRET, timestamp: ts, logId, extraInfo: extra });
  rec("待签名字符串格式与文档一致", actual === expected,
    `app_key:…|ts:…|logid:…|extra_info:…`);
}

/* ② 输出是 Base64（不是 hex） */
{
  const s = sign({ appKey: APP_KEY, appSecret: APP_SECRET, timestamp: "1", logId: "l" });
  const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  /* HMAC-SHA256 → 32 字节 → Base64 固定 44 字符（含一个 =） */
  rec("签名是 Base64 且长度为 44", isBase64 && s.length === 44, `${s.length} 字符：${s.slice(0, 16)}…`);
  rec("签名不是 hex（hex 会是 64 字符）", s.length !== 64);
}

/* ③ 密钥不同 → 签名不同（确认密钥真的参与了） */
{
  const a = sign({ appKey: APP_KEY, appSecret: APP_SECRET, timestamp: "1", logId: "l" });
  const b = sign({ appKey: APP_KEY, appSecret: "another-secret", timestamp: "1", logId: "l" });
  rec("换 app_secret 会改变签名", a !== b);
}

/* ④ 任一字段变化 → 签名变化（四个字段都进签名） */
{
  const base = { appKey: APP_KEY, appSecret: APP_SECRET, timestamp: "1", logId: "l", extraInfo: "" };
  const s0 = sign(base);
  rec("换 app_key 会改变签名", sign({ ...base, appKey: "other" }) !== s0);
  rec("换 timestamp 会改变签名", sign({ ...base, timestamp: "2" }) !== s0);
  rec("换 log_id 会改变签名", sign({ ...base, logId: "l2" }) !== s0);
  rec("换 extra_info 会改变签名", sign({ ...base, extraInfo: "x" }) !== s0);
}

/* ⑤ 相同输入 → 相同签名（确定性，可复现） */
{
  const args = { appKey: APP_KEY, appSecret: APP_SECRET, timestamp: "1", logId: "l" };
  rec("同输入签名可复现", sign(args) === sign(args));
}

/* ⑥ buildHeaders 输出全部五个必需头 */
{
  const h = buildHeaders({ appKey: APP_KEY, appSecret: APP_SECRET });
  const need = ["X-App-Key", "X-Timestamp", "X-Log-Id", "X-Sign", "X-Extra-Info"];
  const missing = need.filter((k) => !(k in h));
  rec("五个必需请求头齐全", missing.length === 0, missing.length ? `缺 ${missing.join(", ")}` : need.join(" / "));
  rec("X-Timestamp 是秒级时间戳",
    /^\d{10}$/.test(h["X-Timestamp"]), h["X-Timestamp"]);
  rec("X-App-Key 与传入的用户 token 一致", h["X-App-Key"] === APP_KEY, h["X-App-Key"]);
  rec("X-Extra-Info 可为空但必须存在", h["X-Extra-Info"] === "");
}

/* ⑦ 头部签名与「用头部里的字段重算」一致 —— 防止组装时字段错位 */
{
  const h = buildHeaders({ appKey: APP_KEY, appSecret: APP_SECRET, extraInfo: "trace=1" });
  const recomputed = sign({
    appKey: h["X-App-Key"],
    appSecret: APP_SECRET,
    timestamp: h["X-Timestamp"],
    logId: h["X-Log-Id"],
    extraInfo: h["X-Extra-Info"],
  });
  rec("用头部字段重算签名与 X-Sign 一致", recomputed === h["X-Sign"],
    "（若不一致说明组装时字段错位）");
  rec("extra_info 透传进头部", h["X-Extra-Info"] === "trace=1");
}

/* ⑧ log_id 每次不同（避免追踪 ID 重复） */
{
  const a = buildHeaders({ appKey: APP_KEY, appSecret: APP_SECRET });
  const b = buildHeaders({ appKey: APP_KEY, appSecret: APP_SECRET });
  rec("log_id 每次调用都不同", a["X-Log-Id"] !== b["X-Log-Id"], a["X-Log-Id"].slice(0, 28) + "…");
}

/* ⑨ 文档给出的三个圈子 ID 与文件一致 */
{
  const ids = Object.values(CIRCLES).map((c) => c.id);
  rec("三个圈子 ID 与文档一致",
    ids.includes("2001009660925334090") &&
      ids.includes("2015023739549529606") &&
      ids.includes("2029619126742656657"),
    Object.values(CIRCLES).map((c) => c.name).join(" / "));
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
