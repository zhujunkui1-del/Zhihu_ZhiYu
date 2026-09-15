#!/usr/bin/env node
/**
 * 脱敏层（lib/privacy/redact.ts）的验收测试。
 *
 * ── 为什么这些用例长这样 ──────────────────────────────────────────────────
 * 用户导入的是**真实私聊**，所以用例分两类：
 *   · 正例：真实出现过的敏感串（那份微信私聊里就有 base64 凭据串）
 *   · 反例：长得像但不是的东西（时间戳、订单号、版本号、代码、普通数字）
 * 反例必须一条都不能误伤 —— 脱敏把用户数据弄坏，比不脱敏更糟。
 *
 * 用法：node scripts/test-redact.mjs
 */
import assert from "node:assert/strict";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const { redactText, describeHits, redactMessages } = await import("../lib/privacy/redact.ts");

const R = (s) => redactText(s);

/* ── ① 手机号 ───────────────────────────────────────────────────────────── */
console.log("\n== ① 手机号 ==");
{
  const a = R("我的手机号是 13812345678，有事打这个");
  rec("11 位手机号被替换", a.text.includes("[手机号]") && !a.text.includes("13812345678"), a.text);
  rec("命中计数为 1", a.total === 1 && a.hits[0]?.rule === "手机号", JSON.stringify(a.hits));

  const b = R("联系 13812345678 或 15900001111");
  rec("同一段里两个号码都替换", b.hits[0]?.count === 2, JSON.stringify(b.hits));

  const c = R("订单号 1381234567890");
  rec("13 位数字（订单号）不误伤", c.total === 0, c.text);

  const d = R("时间戳 1722610680");
  rec("10 位时间戳不误伤", d.total === 0, d.text);

  const e = R("版本 1.2.3.4567 构建号");
  rec("版本号不误伤", e.total === 0, e.text);

  const f = R("身份证尾号 1234，手机 13812345678");
  rec("夹在文本中间也认得（前面有中文）", f.hits[0]?.rule === "手机号", JSON.stringify(f.hits));

  const g = R("号段不对：12812345678");
  rec("非 1[3-9] 开头的 11 位不动", g.total === 0, g.text);

  const h = R("卡号 6217000010001234569 转账");
  rec("19 位卡号（Luhn 通过）替换为银行卡", h.text.includes("[银行卡]"), h.text);

  const h2 = R("卡号 6217000010001234567 转账");
  rec("19 位但 Luhn 不过 → 不误伤", !h2.text.includes("[银行卡]"), h2.text);
}

/* ── ② 身份证：必须过校验位 ─────────────────────────────────────────────── */
console.log("\n== ② 身份证（带校验位才打码） ==");
{
  /* 11010519491231002X 是公开的合法样例号 */
  const ok = R("身份证 11010519491231002X 已实名");
  rec("合法身份证被替换", ok.text.includes("[身份证]") && ok.hits[0]?.rule === "身份证", ok.text);

  const bad = R("随便一串 110105194912310021 不是身份证");
  rec("校验位不对的 18 位不误伤", !bad.text.includes("[身份证]"), bad.text);
}

/* ── ③ 银行卡：Luhn ─────────────────────────────────────────────────────── */
console.log("\n== ③ 银行卡（Luhn 校验） ==");
{
  const ok = R("卡号 4111111111111111");
  rec("Luhn 通过的 16 位替换", ok.text.includes("[银行卡]"), ok.text);

  const bad = R("流水号 1234567890123456");
  rec("Luhn 不通过的 16 位不误伤", !bad.text.includes("[银行卡]"), bad.text);
}

/* ── ④ 邮箱 / 密钥 / Bearer ─────────────────────────────────────────────── */
console.log("\n== ④ 邮箱与密钥 ==");
{
  const m = R("发到 zhangsan.li+work@example.co.uk 就行");
  rec("邮箱（带 + 和多级域名）替换", m.text.includes("[邮箱]"), m.text);

  const k = R("key 是 sk-abcdefghijklmnopqrstuvwxyz012345");
  rec("sk- 密钥替换", k.text.includes("[密钥]"), k.text);

  const b = R("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  rec("Bearer token 替换", /Bearer \[密钥\]/.test(b.text), b.text);

  const aws = R("AKIAIOSFODNN7EXAMPLE 是示例");
  rec("AWS AKIA 密钥替换", aws.text.includes("[密钥]"), aws.text);
}

/* ── ⑤ 长凭据串（真实样例：那份微信私聊里的 base64） ───────────────────── */
console.log("\n== ⑤ 长凭据串 ==");
{
  const real =
    "easyn2n://bjJuLnMzLmJ1Z3hpYS5jb206MzQ0NDBAWElaSVNBTUFAMTkyLjE2OC4zLkBMVVVOQ2kxNElERT0=";
  const r = R(real);
  rec("真实 base64 凭据串被替换", r.text.includes("[凭据]") && !r.text.includes("bjJuLnMz"), r.text);
  rec("协议前缀保留（仍能看出这是一条链接）", r.text.startsWith("easyn2n://"), r.text);

  const cpp = R("#include <iostream>\nint main(){cout<<\"hello world\";return 0;}");
  rec("代码不被当成凭据（无 40 位连续串）", !cpp.text.includes("[凭据]"), cpp.text);

  const longWord = R("averyveryverylongidentifierwithoutanydigitxxxxxxxxxxxx");
  rec("40 位纯字母不误伤（必须含数字）", !longWord.text.includes("[凭据]"), longWord.text);

  const url = R("https://www.bilibili.com/video/BV1EyNXeHE9V?vd_source=2de5be0a5cca78ef2ed2cbe700426a05");
  rec("普通视频链接不被整条吃掉", url.text.startsWith("https://www.bilibili.com/video/"), url.text);
}

/* ── ⑥ 组合与幂等 ───────────────────────────────────────────────────────── */
console.log("\n== ⑥ 组合与幂等 ==");
{
  const mixed = R("手机 13812345678 邮箱 a@b.com 身份证 11010519491231002X，还有 sk-abcdefghijklmnopqrstuvwx");
  rec("多类同时命中", mixed.total === 4, JSON.stringify(mixed.hits));
  rec("命中摘要可读", describeHits(mixed.hits).includes("手机号×1"), describeHits(mixed.hits));

  const twice = redactText(mixed.text);
  rec("二次脱敏幂等（不会越脱越多）", twice.total === 0 && twice.text === mixed.text, twice.text);

  const empty = R("");
  rec("空串安全", empty.total === 0 && empty.text === "");

  const plain = R("今天吃什么？随便吧（");
  rec("普通中文聊天不受影响", plain.total === 0 && plain.text === "今天吃什么？随便吧（");

  const msgs = redactMessages([
    { role: "system", content: "你是助手" },
    { role: "user", content: "打 13812345678" },
  ]);
  rec("批量脱敏只改 user 内容", msgs[0].content === "你是助手" && msgs[1].content.includes("[手机号]"));
  rec("批量脱敏返回新对象（不改原数组）", msgs !== undefined && msgs.length === 2);

  const long = R(`${"靠".repeat(200)} 13812345678 ${"啊".repeat(200)}`);
  rec("长文本中间也能命中", long.text.includes("[手机号]"), `len=${long.text.length}`);
}

/* ── ⑦ 咽喉位置：chatCompletion 真的会脱敏（打桩 fetch，验证真正发出去的 body） ── */
console.log("\n== ⑦ chatCompletion 发出去的 body ==");
{
  const { chatCompletion } = await import("../lib/llm/chat.ts");
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const provider = { baseUrl: "https://example.invalid/v1", apiKey: "sk-test", model: "m" };
  try {
    await chatCompletion(provider, [
      { role: "system", content: "你是助手" },
      { role: "user", content: "她的手机 13812345678，邮箱 lin@example.com" },
    ]);
    const body = sent[0];
    const userText = body.messages[1].content;
    rec("默认脱敏：手机号没发出去", !userText.includes("13812345678"), userText);
    rec("默认脱敏：邮箱没发出去", !userText.includes("lin@example.com"), userText);
    rec("系统提示词不受影响", body.messages[0].content === "你是助手");

    await chatCompletion(
      provider,
      [{ role: "user", content: "手机 13812345678" }],
      { redact: false },
    );
    rec(
      "显式 redact:false 时原样发送（逃生舱可用）",
      String(sent[1].messages[0].content).includes("13812345678"),
      sent[1].messages[0].content,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`\n  脱敏：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
