#!/usr/bin/env node
/**
 * 「引导用户授权飞书 / 钉钉」的纯逻辑测试。
 *
 * ── 为什么要单测这一层 ────────────────────────────────────────────────
 * 这一层最容易出两种错，而且都**看不出来**：
 *   ① 授权 URL 拼错（缺 scope / 缺 state / 用了错的域名）—— 用户点过去
 *      只会看到一个平台报错页，我们这边毫无线索。
 *   ② 能力声明与实现不一致 —— 比如 UI 上写着"可读取消息"而代码根本没拉消息，
 *      那就是骗用户授权。所以能力声明必须被断言钉住。
 *
 * 另：**没配置凭证时绝不能给一个点了没反应的按钮**（用户原话："你要引导用户
 * 允许授权网站使用他们的飞书、钉钉账号的数据呀"），所以"未配置"这条路径
 * 也要有断言：状态查询必须如实回报 configured=false 且给出环境变量名与回调地址。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-oauth-platforms.mjs
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

const {
  OAUTH_PROVIDERS,
  PROVIDER_META,
  buildAuthorizeUrl,
  isOAuthProvider,
  providerConfigStatus,
  readProviderEnv,
} = await import("../lib/oauth/platforms.ts");

/* ── ① 能力声明 ───────────────────────────────────────────────────────── */
console.log("\n== 能力声明：能拉什么、拉不到什么，必须写清楚 ==");
for (const p of OAUTH_PROVIDERS) {
  const m = PROVIDER_META[p];
  rec(`${p} 声明了能拉到的数据`, m.capability.canPull.length > 0, m.capability.canPull.join("；"));
  rec(
    `${p} 声明了"拉不到什么"（不隐瞒才是真引导）`,
    m.capability.cannotPull.length > 0,
    m.capability.cannotPull.map((c) => c.what).join("；"),
  );
  rec(`${p} 给了配置步骤`, m.setupSteps.length >= 3, `${m.setupSteps.length} 步`);
  rec(
    `${p} 给了环境变量名（appId/appSecret/redirectUri 三件套）`,
    Boolean(m.envKeys.appId && m.envKeys.appSecret && m.envKeys.redirectUri),
    Object.values(m.envKeys).join(" / "),
  );
  rec(`${p} 给了开放平台申请入口`, m.consoleUrl.startsWith("https://"), m.consoleUrl);
}

rec(
  "⚠️ 钉钉必须写明「聊天消息拉不到」——钉钉 API 不提供历史消息，隐瞒就是骗授权",
  PROVIDER_META.dingtalk.capability.cannotPull.some((c) => c.what.includes("消息")),
  PROVIDER_META.dingtalk.capability.cannotPull.map((c) => `${c.what}: ${c.why.slice(0, 40)}`).join(" | "),
);
rec(
  "飞书声明能拉群聊消息 + 云文档（这才是「自动调取飞书数据」的兑现）",
  PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("消息")) &&
    PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("文档")) &&
    PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("多维表格")),
  PROVIDER_META.feishu.capability.canPull.join("；"),
);
rec(
  "⚠️ 飞书如实声明「私聊拉不到」并给出原因（不再写「含私聊」这种假话）",
  PROVIDER_META.feishu.capability.cannotPull.some((c) => c.what.includes("私聊")) &&
    !PROVIDER_META.feishu.capability.canPull.some((x) => x.includes("含私聊")),
  PROVIDER_META.feishu.capability.cannotPull.map((c) => c.what).join("；"),
);
rec(
  "飞书 scope 覆盖本轮新增的云文档能力",
  ["docx:document", "wiki:wiki", "bitable:app"].every((s) =>
    PROVIDER_META.feishu.scope.includes(s),
  ),
  PROVIDER_META.feishu.scope,
);

/* ── ② 授权 URL ───────────────────────────────────────────────────────── */
console.log("\n== 授权 URL：必须带 app_id / redirect_uri / scope / state ==");
const feishuEnv = {
  provider: "feishu",
  appId: "cli_test_app",
  appSecret: "secret",
  redirectUri: "https://www.zhiyuapp.site/api/oauth/feishu/callback",
};
const fu = new URL(buildAuthorizeUrl("feishu", feishuEnv, "STATE123"));
rec("飞书授权页域名正确", fu.host === "open.feishu.cn", fu.host);
rec("飞书授权页路径正确", fu.pathname === "/open-apis/authen/v1/authorize", fu.pathname);
rec("带上 app_id", fu.searchParams.get("app_id") === "cli_test_app");
rec("带上 redirect_uri（与配置逐字一致）", fu.searchParams.get("redirect_uri") === feishuEnv.redirectUri);
rec(
  "带上 scope（消息 + 云文档 + 多维表格）",
  (() => {
    const s = fu.searchParams.get("scope") ?? "";
    return ["im:message", "im:chat", "docx:document", "wiki:wiki", "bitable:app"].every((x) =>
      s.includes(x),
    );
  })(),
  fu.searchParams.get("scope"),
);
rec("带上 state（防 CSRF）", fu.searchParams.get("state") === "STATE123");
rec(
  "⚠️ URL 里**不能**出现 app_secret",
  !fu.toString().includes("secret"),
  fu.toString().slice(0, 120),
);

const dtEnv = {
  provider: "dingtalk",
  appId: "ding_test_key",
  appSecret: "dtsecret",
  redirectUri: "https://www.zhiyuapp.site/api/oauth/dingtalk/callback",
};
const du = new URL(buildAuthorizeUrl("dingtalk", dtEnv, "STATE456"));
rec("钉钉授权页域名正确", du.host === "login.dingtalk.com", du.host);
rec("钉钉授权页路径正确", du.pathname === "/oauth2/auth", du.pathname);
rec("用 client_id 传 AppKey", du.searchParams.get("client_id") === "ding_test_key");
rec("response_type=code", du.searchParams.get("response_type") === "code");
rec(
  "prompt=consent（每次显式征求同意，不静默通过）",
  du.searchParams.get("prompt") === "consent",
);
rec("带上 state", du.searchParams.get("state") === "STATE456");
rec("URL 里没有 app_secret", !du.toString().includes("dtsecret"));

/* ── ③ 未配置 → 必须能引导配置 ───────────────────────────────────────── */
console.log("\n== 未配置凭证时：要能「引导配置」，不是给个死按钮 ==");
/* 清掉可能存在的环境变量，模拟"还没配"的真实状态 */
for (const k of [
  "FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_OAUTH_REDIRECT_URI",
  "DINGTALK_APP_KEY", "DINGTALK_APP_SECRET", "DINGTALK_OAUTH_REDIRECT_URI",
]) {
  delete process.env[k];
}
rec("读不到配置时返回 null", readProviderEnv("feishu") === null);
const st = providerConfigStatus();
for (const p of OAUTH_PROVIDERS) {
  rec(`${p} 状态如实回报 configured=false`, st[p].configured === false);
  rec(
    `${p} 仍然给出三个环境变量名（用户照着配）`,
    Boolean(st[p].envKeys.appId && st[p].envKeys.appSecret && st[p].envKeys.redirectUri),
    Object.values(st[p].envKeys).join(" / "),
  );
}
rec(
  "状态查询里**不含任何秘密**（只有配没配 + 回调地址）",
  !JSON.stringify(st).toLowerCase().includes("secret_value") &&
    !JSON.stringify(st).includes("appSecretValue"),
  JSON.stringify(st).slice(0, 120),
);

/* 配好之后要能读出来 */
process.env.FEISHU_APP_ID = "cli_x";
process.env.FEISHU_APP_SECRET = "s3cret";
process.env.FEISHU_OAUTH_REDIRECT_URI = "https://example.com/api/oauth/feishu/callback";
const st2 = providerConfigStatus();
rec("配好之后 configured=true", st2.feishu.configured === true);
rec(
  "并把回调地址回显出来（用户要填到平台后台，且它不是秘密）",
  st2.feishu.redirectUri === "https://example.com/api/oauth/feishu/callback",
  st2.feishu.redirectUri,
);
rec("钉钉仍然是未配置（互不影响）", st2.dingtalk.configured === false);

/* ── ④ provider 白名单 ───────────────────────────────────────────────── */
console.log("\n== provider 白名单（防任意值打到 OAuth 逻辑里）==");
rec("feishu / dingtalk 通过", isOAuthProvider("feishu") && isOAuthProvider("dingtalk"));
rec(
  "其它值一律拒绝",
  !isOAuthProvider("zhihu") && !isOAuthProvider("") && !isOAuthProvider("__proto__"),
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
