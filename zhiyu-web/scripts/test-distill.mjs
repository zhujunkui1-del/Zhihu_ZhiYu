/**
 * 实测人格蒸馏：真的调 LLM，把六源证据归纳成结构化 Persona。
 *
 * 直接调 lib 里的 distillPersona（绕过 HTTP），
 * 因为它用了 @/ 别名，这里用 Next 的运行时不便，改成重复最小逻辑？
 * —— 不，直接跑服务端路由更真实。本脚本走 HTTP。
 *
 * 用法：node --env-file=.env scripts/test-distill.mjs [BASE]
 */
const BASE = process.argv[2] || "http://127.0.0.1:3000";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? "[OK]" : "[FAIL]"} ${label}${detail ? `\n      ${detail}` : ""}`);
};

console.log("人格蒸馏实测（真实调用 LLM）");
console.log("=".repeat(80));

/* 建立会话（带 Origin：状态变更接口有 CSRF 同源校验） */
const login = await fetch(`${BASE}/api/auth/demo`, {
  method: "POST",
  headers: { "Content-Type": "application/json", origin: new URL(BASE).origin },
  body: "{}",
});
const setCookie = login.headers.get("set-cookie") ?? "";
const token = (setCookie.match(/zhiyu_session=([^;]+)/) || [])[1] ?? "";
if (!token) {
  console.error(`演示登录失败：HTTP ${login.status}`);
  process.exit(1);
}
const auth = { Cookie: `zhiyu_session=${token}`, origin: new URL(BASE).origin };
const me = await login.json();
console.log(`会话已建立（personaId=${me.personaId?.slice(0, 12)}…）\n`);

/* ① 就绪状态 */
const ready = await fetch(`${BASE}/api/persona/distill`, { headers: auth }).then((r) => r.json());
rec("GET /api/persona/distill 返回就绪状态", ready.ok === true, JSON.stringify(ready));
rec("平台大模型已配置（#7 的免费额度）", ready.platformLlm === true, `platformLlm=${ready.platformLlm}`);
rec("判定为可用 LLM", ready.canUseLlm === true, `byokCount=${ready.byokCount}`);

/* ② 真实蒸馏 */
console.log("\n调用 POST /api/persona/distill（可能要十几秒）…");
const t0 = Date.now();
const r = await fetch(`${BASE}/api/persona/distill`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...auth },
  body: JSON.stringify({}),
});
const raw = await r.text();
const j = JSON.parse(raw);
const ms = Date.now() - t0;

rec("蒸馏接口返回 200", r.status === 200, `HTTP ${r.status}，耗时 ${ms} ms`);
rec("蒸馏成功", j.ok === true, j.error ?? "");
rec("用的是真 LLM 归纳（不是规则兜底）", j.method === "llm",
  `method=${j.method}${j.llmError ? ` llmError=${j.llmError}` : ""}`);
rec("证据包非空", j.evidenceCount > 0, `${j.evidenceCount} 条证据，用到源：${(j.usedSources ?? []).join(", ")}`);
rec("耗时在合理范围（< 60s）", ms < 60000, `${(ms / 1000).toFixed(1)} s`);

const d = j.distilled ?? {};
console.log(`\n── 蒸馏结果 ──`);
console.log(`  bio              : ${d.bio}`);
console.log(`  interests        : ${(d.interests ?? []).join(" / ")}`);
console.log(`  topics           : ${(d.topics ?? []).join(" / ")}`);
console.log(`  communicationStyle: ${(d.communicationStyle ?? []).join(" / ")}`);
console.log(`  values           : ${Object.entries(d.values ?? {}).map(([k, v]) => `${k}=${v}`).join(" ")}`);
console.log(`  summary          : ${d.summary}`);
console.log(`  groundedIn       : ${(d.groundedIn ?? []).length} 条溯源`);

rec("产出了 bio", typeof d.bio === "string" && d.bio.length > 0, d.bio);
rec("产出了 interests", Array.isArray(d.interests) && d.interests.length > 0, `${d.interests?.length} 个`);
rec("产出了 communicationStyle", Array.isArray(d.communicationStyle) && d.communicationStyle.length > 0,
  `${d.communicationStyle?.length} 个`);
rec("values 六维都在 0~1",
  ["career", "social", "autonomy", "creation", "learning", "stability"].every(
    (k) => typeof d.values?.[k] === "number" && d.values[k] >= 0 && d.values[k] <= 1,
  ),
  JSON.stringify(d.values));
rec("有可解释的溯源（groundedIn）", (d.groundedIn ?? []).length > 0,
  `${d.groundedIn?.length ?? 0} 条`);
if ((d.groundedIn ?? []).length) {
  const g = d.groundedIn[0];
  console.log(`      例：${g.claim} ← 证据 [${g.from.join(",")}]`);
}

/* ③ 越权保护 */
{
  /* 拿一个别人的 persona id：从发现页接口取不到别人的 id，用库里的 zhihu- 前缀人设 */
  const other = await fetch(`${BASE}/api/persona/distill`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ personaId: "zhihu-zhang-jia-wei" }),
  });
  rec("不能蒸馏别人的 Persona（403）", other.status === 403, `HTTP ${other.status}`);
}

console.log("=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
