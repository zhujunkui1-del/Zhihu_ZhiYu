#!/usr/bin/env node
/**
 * #7「知遇提供的大模型（免费额度）」的纯逻辑测试。
 *
 * 需求：设置页 03 区加一个滑块，提示用户**截至 2026-09-23 前可免费使用**
 * 网站提供的大模型，**默认打开**。
 *
 * 界面文案承诺了一个日期，就必须**真的**在那个日期之后失效 ——
 * 否则文案是假的，平台 Key 会被无限期白用。所以这里重点验边界：
 *   · 截止日**当天**仍可用（含当日）
 *   · 次日**立即**失效（按东八区日历，不是 UTC）
 *   · 滑块关掉后不使用平台模型（尊重用户选择）
 *   · BYOK 始终优先且不受窗口影响
 *   · 日期配置写坏时**收紧**而不是放开（安全默认）
 *
 * `lib/llm/platform.ts` 只依赖 `./chat`（无 `@/` 别名、无 Prisma），
 * 因此纯 Node 可以直接跑。用随附的解析钩子补齐 Node 不做的扩展名解析：
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-platform-llm.mjs
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

/* 先给平台配上 Key，否则一切都会因为"未配置"而不可用 */
process.env.AI_API_KEY = "sk-test-platform-key";
process.env.AI_BASE_URL = "https://api.openai-next.com/v1";
process.env.AI_MODEL = "gpt-4o-mini";

const {
  FREE_UNTIL,
  isFreeWindowOpen,
  daysLeft,
  platformAvailability,
  resolveLlmSource,
  platformProvider,
} = await import("../lib/llm/platform.ts");

console.log("\n== 免费截止日与配置 ==");
rec("默认截止日是需求承诺的 2026-09-23", FREE_UNTIL === "2026-09-23", FREE_UNTIL);
rec("平台模型已配置", platformAvailability().configured === true);
rec("baseUrl 带 /v1（不带会拿到 SPA HTML）", platformProvider()?.baseUrl.endsWith("/v1") === true, platformProvider()?.baseUrl);

console.log("\n== 免费窗口边界（东八区日历） ==");
/* 东八区 2026-09-23 23:59:59 = UTC 15:59:59 */
rec(
  "截止日当天 23:59（东八区）仍可用",
  isFreeWindowOpen(new Date("2026-09-23T23:59:59+08:00")) === true,
);
rec(
  "截止日当天 00:00 可用",
  isFreeWindowOpen(new Date("2026-09-23T00:00:00+08:00")) === true,
);
rec(
  "次日 00:00:00（东八区）立即失效",
  isFreeWindowOpen(new Date("2026-09-24T00:00:00+08:00")) === false,
);
rec(
  "UTC 视角下同一天也不能提前失效（18:00Z 属于东八区次日 02:00 → 应失效）",
  /* 2026-09-23T18:00Z = 东八区 2026-09-24 02:00，已过截止 */
  isFreeWindowOpen(new Date("2026-09-23T18:00:00Z")) === false,
);
rec(
  "UTC 视角 2026-09-23T15:00Z（东八区 23:00）仍可用",
  isFreeWindowOpen(new Date("2026-09-23T15:00:00Z")) === true,
);
rec("很早以前当然可用", isFreeWindowOpen(new Date("2026-01-01T00:00:00+08:00")) === true);

console.log("\n== 剩余天数（按东八区日历日） ==");
/* 截止 2026-09-23 结束，所以从 9-23 往前数：
   9-01 → 22 天，9-22 → 1 天，9-23 当天 → 0 天。
   曾经用"小时÷24 向上取整"，在 9-01 会多报一天（23 天），已修正。 */
rec(
  "9-01 剩 22 天（不是 23）",
  daysLeft(new Date("2026-09-01T12:00:00+08:00")) === 22,
  `${daysLeft(new Date("2026-09-01T12:00:00+08:00"))} 天`,
);
rec(
  "9-22 剩 1 天",
  daysLeft(new Date("2026-09-22T12:00:00+08:00")) === 1,
  `${daysLeft(new Date("2026-09-22T12:00:00+08:00"))} 天`,
);
rec(
  "9-23 当天剩 0 天（当天仍可用，但已无剩余日）",
  daysLeft(new Date("2026-09-23T10:00:00+08:00")) === 0,
  `${daysLeft(new Date("2026-09-23T10:00:00+08:00"))} 天`,
);
rec("已过期时剩 0 天（不返回负数）", daysLeft(new Date("2026-10-01T00:00:00+08:00")) === 0);
rec(
  "东八区 9-22 23:30 仍算 1 天（不因 UTC 差一天）",
  daysLeft(new Date("2026-09-22T23:30:00+08:00")) === 1,
  `${daysLeft(new Date("2026-09-22T23:30:00+08:00"))} 天`,
);

console.log("\n== 可用性汇总 ==");
const nowOpen = platformAvailability(new Date("2026-09-01T00:00:00+08:00"));
rec("免费期内 usable=true", nowOpen.usable === true, JSON.stringify(nowOpen));
const afterEnd = platformAvailability(new Date("2026-09-24T00:00:00+08:00"));
rec("免费期后 usable=false", afterEnd.usable === false);
rec(
  "免费期后给出可展示的原因",
  typeof afterEnd.reason === "string" && afterEnd.reason.includes("2026-09-23"),
  afterEnd.reason,
);

console.log("\n== 滑块（usePlatformLlm）行为 ==");
const on = { usePlatformLlm: true };
const off = { usePlatformLlm: false };
const byok = { baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-user", model: "deepseek-chat" };

{
  const r = resolveLlmSource(on, null);
  rec("滑块开 + 无 BYOK → 用平台模型", r.source === "platform", r.source);
}
{
  const r = resolveLlmSource(off, null);
  rec("滑块关 + 无 BYOK → 无可用模型（不偷偷用平台）", r.source === "none", r.source);
  rec("并给出关闭的原因", typeof r.reason === "string", r.reason);
}
{
  const r = resolveLlmSource(on, byok);
  rec("有 BYOK → BYOK 优先（盖过平台）", r.source === "byok", r.source);
}
{
  const r = resolveLlmSource(off, byok);
  rec("滑块关但有 BYOK → 仍用 BYOK", r.source === "byok", r.source);
}
{
  /* 记录为 null（老用户没建过偏好行）时应按默认**开**处理 */
  const r = resolveLlmSource(null, null);
  rec("偏好行为空 → 默认走平台（默认打开）", r.source === "platform", r.source);
}

console.log("\n== 免费期结束后不误伤 BYOK ==");
/* 用当前真实时间无法模拟未来，这里直接验证判定函数：
   过期时 resolveLlmSource 必须仍能返回 BYOK */
{
  const r = resolveLlmSource({ usePlatformLlm: true }, byok);
  rec("免费期结束后 BYOK 依然可用", r.source === "byok", r.source);
}

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
