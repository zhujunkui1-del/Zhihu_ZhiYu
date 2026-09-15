#!/usr/bin/env node
/**
 * ④c 端到端：**真跑一次蒸馏**，验证判型与依据落库、页面显示、且不再写 LLM 六维。
 *
 * 为什么必须真跑：判型改由 LLM 出结论，光看代码无法证明
 *   · prompt 里的字段名与解析器对得上（模型真给了 type / typeEvidence）
 *   · 六个型名过得了白名单校验（模型自创型名会被拒 → 那等于判型永远为空）
 *   · 依据不是空串（没有依据的型名等于编）
 *   · `Persona.values` **没有被覆盖**（方针：六维不再由 LLM 写）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env \
 *        scripts/verify-distill-type.mjs [baseUrl]
 */
import assert from "node:assert/strict";
import {
  loadPlaywright,
  launchChromium,
} from "file:///C:/Users/zhuju/.dsh/skills/web-clone/scripts/lib/playwright-loader.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:3000";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const { prisma } = await import("../lib/db.ts");
const { PERSONA_TYPES } = await import("../lib/persona/fusion.ts");

const { chromium } = loadPlaywright();
const browser = await launchChromium(chromium);

let before = null;
let personaId = null;

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const demo = await page.evaluate(async () =>
    (await fetch("/api/auth/demo", { method: "POST" })).json(),
  );
  rec("本地演示登录可用", demo?.ok === true);
  personaId = demo.personaId;

  before = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { values: true, personality: true, interests: true },
  });

  /* ── 真跑蒸馏 ── */
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/persona/distill", { method: "POST" });
    const t = await r.text();
    try {
      return { status: r.status, body: JSON.parse(t) };
    } catch {
      return { status: r.status, body: { raw: t.slice(0, 300) } };
    }
  });
  rec("蒸馏接口返回 200", res.status === 200, `HTTP ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  rec("这次真的调用了大模型（method=llm）", res.body?.method === "llm", String(res.body?.method));
  rec("蒸馏时如实回报了脱敏情况", Boolean(res.body?.privacy), JSON.stringify(res.body?.privacy ?? {}));

  /* ── 落库检查 ── */
  const after = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { values: true, personality: true },
  });
  const p = after.personality ?? {};
  const judged = typeof p.type === "string" ? p.type : null;

  rec(
    "写入了判定的倾向型，且是六型之一",
    judged !== null && PERSONA_TYPES.includes(judged),
    `type=${judged ?? "(无)"}（白名单：${PERSONA_TYPES.join("/")}）`,
  );
  rec(
    "判定依据非空（没有依据的型名等于编）",
    typeof p.typeEvidence === "string" && p.typeEvidence.trim().length >= 8,
    String(p.typeEvidence ?? "").slice(0, 160),
  );
  rec("记了判定时间与判定方式", Boolean(p.typeJudgedAt) && Boolean(p.typeJudgeMethod), `${p.typeJudgeMethod} @ ${p.typeJudgedAt}`);
  rec(
    "**`Persona.values` 没有被 LLM 六维覆盖**（方针：六维不再由 LLM 写）",
    JSON.stringify(after.values) === JSON.stringify(before.values),
    `前 ${JSON.stringify(before.values)?.slice(0, 80)} → 后 ${JSON.stringify(after.values)?.slice(0, 80)}`,
  );

  /* ── 页面显示：型名 + 依据同时出现 ── */
  await page.goto(`${BASE}/persona`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);
  const ui = await page.evaluate(() => {
    const box = document.querySelector("[data-judged-type]");
    return {
      hasBox: Boolean(box),
      text: (box?.textContent ?? "").replace(/\s+/g, " ").trim(),
      bodyHasType: document.body.innerText.includes("你的人格倾向是"),
    };
  });
  rec("人格页显示了判定结果", ui.hasBox || ui.bodyHasType, ui.text.slice(0, 180));
  rec("判定结果里带上了依据", /判定依据/.test(ui.text), ui.text.slice(0, 180));
  rec(
    "页面上真的出现了那个型名",
    judged ? ui.text.includes(judged) : false,
    `type=${judged}`,
  );

  /* ── 发现页筛选也认这个型 ── */
  await page.goto(`${BASE}/find`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2000);
  const findText = await page.evaluate(() => document.body.innerText);
  rec(
    "发现页能拿到这个倾向型（筛选口径与人格页一致）",
    judged ? findText.includes(judged) : false,
    judged ? `页面含「${judged}」` : "没有型名",
  );
} catch (e) {
  fail += 1;
  console.log(`  [FAIL] 抛出异常：${e?.stack ?? e}`);
} finally {
  await prisma.$disconnect();
  await browser.close();
}

console.log(`\n  判型落库与展示：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
