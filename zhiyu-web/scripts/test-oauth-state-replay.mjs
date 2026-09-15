#!/usr/bin/env node
/**
 * 知乎 OAuth state 校验 / 重复回调（幂等重放）的接线测试 —— 打真库，不打真网络。
 *
 * ── 为什么必须有这一层 ────────────────────────────────────────────────────
 * 用户反馈：手机端登录经常失败，只看到「登录失败：授权状态校验失败」。
 * 复盘发现三个问题叠在一起：
 *   ① 三种完全不同的失败（不匹配 / 超时 / 重复回调）在前端被合并成同一句话，
 *      用户和服务端都拿不到可判断的信息；
 *   ② 回调用例是 GET，手机端下拉刷新、预取、前进后退都会请求第二次，
 *      而授权码是一次性的 —— 第二次必然失败，用户被挡在登录页；
 *   ③ 失败时 `?oauth=` 被 replaceState 抹掉，连原因代码都不剩。
 *
 * 所以这里断言的是"行为规格"，不是实现细节：
 *   · state 只能被成功消费一次（防重放不能丢）
 *   · 已消费的 state 在窗口内可以**幂等重放**成同一张会话
 *   · 窗口外 / 会话已死 → 必须拒绝，且拒绝原因能区分
 *   · 拒绝时绝不把 state 本身塞进给用户的 URL
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env \
 *         scripts/test-oauth-state-replay.mjs
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

const { prisma } = await import("../lib/db.ts");
const { issueState, consumeState, saveStateResult, decideStateAction, STATE_REPLAY_MS } =
  await import("../lib/auth/session.ts");

const created = [];
const track = (s) => {
  created.push(s);
  return s;
};

try {
  /* ── ① 生成的 state 必须是 URL 安全的 ───────────────────────────────── */
  const s1 = track(await issueState({ returnTo: "/home", sessionToken: null }));
  rec("issueState 返回非空 state", typeof s1 === "string" && s1.length >= 32, `len=${s1?.length}`);
  rec(
    "state 不含 + / =（query 里不会被二次转义搞坏）",
    !/[+/=]/.test(s1),
    s1,
  );
  rec("state 可用 ?state= 原样取回", new URLSearchParams(`state=${s1}`).get("state") === s1);

  /* ── ② 第一次消费成功，且 returnTo 被带回来 ─────────────────────────── */
  const c1 = await consumeState(s1);
  rec("首次消费成功", c1.ok === true, JSON.stringify(c1));
  rec("returnTo 原样回传", c1.ok && c1.returnTo === "/home", c1.ok ? String(c1.returnTo) : "-");

  /* ── ③ 同一 state 第二次消费必须失败（防重放不能因为要兼容刷新就丢掉） ─ */
  const c2 = await consumeState(s1);
  rec("二次消费被拒", c2.ok === false && c2.reason === "consumed", JSON.stringify(c2));
  rec("能区分出'行存在'（不是猜的）", c2.ok === false && c2.exists === true);
  rec(
    "消费时间差可读（用于判定重放窗口）",
    c2.ok === false && typeof c2.consumedAgoMs === "number" && c2.consumedAgoMs < 5000,
    c2.ok === false ? String(c2.consumedAgoMs) : "-",
  );
  rec(
    "还没写结果时不给重放（不能凭空造会话）",
    decideStateAction(c2, { sessionAlive: true }).kind === "reject",
  );

  /* ── ④ 写入结果后：窗口内重放，窗口外拒绝 ──────────────────────────── */
  await saveStateResult(s1, "replay-session-token-1");
  const c3 = await consumeState(s1);
  rec(
    "结果被持久化到 state 行",
    c3.ok === false && c3.resultSessionToken === "replay-session-token-1",
    JSON.stringify(c3),
  );
  const replay = decideStateAction(c3, { sessionAlive: true });
  rec(
    "窗口内 + 会话还活着 → 重放同一张会话（刷新不再报错）",
    replay.kind === "replay" && replay.sessionToken === "replay-session-token-1",
    JSON.stringify(replay),
  );
  const dead = decideStateAction(c3, { sessionAlive: false });
  rec(
    "窗口内但会话已失效 → 拒绝（不能重放一张死会话）",
    dead.kind === "reject" && dead.reason === "state_consumed",
    JSON.stringify(dead),
  );
  const stale = decideStateAction(
    { ok: false, reason: "consumed", exists: true, returnTo: null, resultSessionToken: "x", consumedAgoMs: STATE_REPLAY_MS + 1 },
    { sessionAlive: true },
  );
  rec(
    "超出重放窗口 → 拒绝",
    stale.kind === "reject" && stale.reason === "state_consumed",
    JSON.stringify(stale),
  );

  /* ── ⑤ 并发回调：只能有一个成功（原子消费） ────────────────────────── */
  const s2 = track(await issueState({ returnTo: "/home/persona", sessionToken: null }));
  const race = await Promise.all(Array.from({ length: 5 }, () => consumeState(s2)));
  const wins = race.filter((r) => r.ok).length;
  rec("5 个并发回调只有 1 个消费成功", wins === 1, `wins=${wins}`);
  rec(
    "其余 4 个都是 consumed 而不是 mismatch",
    race.filter((r) => !r.ok && r.reason === "consumed").length === 4,
    JSON.stringify(race.map((r) => (r.ok ? "ok" : r.reason))),
  );
  rec(
    "returnTo 在并发失败分支里也带回来了",
    race.find((r) => !r.ok)?.returnTo === "/home/persona",
    JSON.stringify(race.find((r) => !r.ok)),
  );

  /* ── ⑥ 从未见过的 state → mismatch，且不能说'存在' ─────────────────── */
  const c4 = await consumeState("definitely-not-a-real-state-000000");
  rec("未知 state 判为 mismatch", c4.ok === false && c4.reason === "mismatch");
  rec("未知 state 的 exists 必须是 false", c4.ok === false && c4.exists === false);
  rec(
    "mismatch 的拒绝原因里不含 state 值",
    decideStateAction(c4).reason === "state_mismatch",
  );

  /* ── ⑦ 过期的 state → expired（10 分钟窗口） ───────────────────────── */
  const s3 = track(await issueState({ returnTo: "/home", sessionToken: null }));
  await prisma.oAuthState.update({
    where: { state: s3 },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const c5 = await consumeState(s3);
  rec("过期 state 判为 expired", c5.ok === false && c5.reason === "expired", JSON.stringify(c5));
  rec("三种 state 失败在前端能区分", decideStateAction(c5).reason === "state_expired");
  rec("过期的 state 不会被写成已消费", (await prisma.oAuthState.findUnique({ where: { state: s3 } }))?.consumedAt === null);

  /* ── ⑧ 平台不回传 state 的兼容路径不能因为这次改动被弄丢 ───────────── */
  const c6 = await consumeState(null);
  rec("没带 state 判为 missing 且不存在", c6.ok === false && c6.reason === "missing" && !c6.exists);
  rec(
    "missing 仍然放行（否则平台确实不返 state 时无法登录）",
    decideStateAction(c6).kind === "proceed",
  );

  /* ── ⑨ 正常路径不受影响 ───────────────────────────────────────────── */
  const s4 = track(await issueState({ returnTo: "/home/persona?tab=sources", sessionToken: "sess-abc" }));
  const c7 = await consumeState(s4);
  rec("首次消费 → proceed", decideStateAction(c7).kind === "proceed");
  rec("发起时的会话 token 仍被带回", c7.ok && c7.sessionToken === "sess-abc");
  rec("带 query 的 returnTo 原样保留", c7.ok && c7.returnTo === "/home/persona?tab=sources");
} catch (e) {
  fail += 1;
  console.log(`  [FAIL] 抛出异常：${e?.stack ?? e}`);
} finally {
  /* 只清理本测试造的 state 行，不碰任何真实数据 */
  if (created.length) {
    const del = await prisma.oAuthState.deleteMany({ where: { state: { in: created } } });
    console.log(`\n  已清理测试 state 行：${del.count} 条`);
  }
  await prisma.$disconnect();
}

console.log(`\n  state 幂等重放：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
