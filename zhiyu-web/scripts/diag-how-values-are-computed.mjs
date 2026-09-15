#!/usr/bin/env node
/**
 * 只读诊断：把某个人格的「六维/五轴」到底怎么算出来的，一步步摊开。
 *
 * 回答的问题：用户注入的数据（微信/QQ/知乎/飞书/钉钉/SBTI）分别喂进哪个公式，
 * 最终雷达上的 5 个数字是怎么来的。
 *
 * 用法：
 *   node --no-warnings --import ./scripts/ts-resolve.mjs --env-file=.env \
 *        scripts/diag-how-values-are-computed.mjs [personaId|--all]
 */
import { prisma } from "../lib/db.ts";
import {
  facetFromContents,
  facetFromSbti,
  fuseSourceFacets,
  matchPersonaType,
  VALUE_KEYS,
  VALUE_LABEL,
} from "../lib/persona/fusion.ts";
import { axesFromObservedValues } from "../lib/sbti/axes.ts";

const pct = (x) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");
const vec = (o) =>
  VALUE_KEYS.map((k) => `${VALUE_LABEL[k]}=${pct(o?.[k])}`).join("  ");

const arg = process.argv[2] ?? "--all";

/* 先按"证据条数"找出最像截图里那位的人格 */
const rows = await prisma.persona.findMany({
  select: {
    id: true,
    displayName: true,
    kind: true,
    values: true,
    personality: true,
    userId: true,
    evidence: { select: { source: true } },
  },
});

const counts = rows
  .map((p) => {
    const c = {};
    for (const e of p.evidence) c[e.source] = (c[e.source] ?? 0) + 1;
    return { p, c, total: p.evidence.length };
  })
  .sort((a, b) => b.total - a.total);

let targets;
if (arg === "--all") {
  targets = counts.slice(0, 6);
} else {
  targets = counts.filter((x) => x.p.id === arg);
}

for (const { p, c } of targets) {
  console.log("\n" + "=".repeat(78));
  console.log(`${p.displayName}  (${p.id})  kind=${p.kind}`);
  console.log(`证据条数：${JSON.stringify(c)}`);

  const sbti = p.personality?.sbti;
  console.log(
    `SBTI：type=${sbti?.type ?? "—"} title=${sbti?.typeTitle ?? "—"} codes=${sbti?.codes ?? "—"} 有dimensions=${Boolean(sbti?.dimensions)}`,
  );
  if (sbti?.dimensions) {
    const entries = Object.entries(sbti.dimensions);
    console.log(
      `  15 维原始分：${entries
        .map(([k, v]) => `${k}=${v?.score ?? v}`)
        .join(" ")}`,
    );
  }

  console.log(`\nPersona.values（整源蒸馏产物）：${vec(p.values ?? {})}`);

  /* ── 持久化的分源 facet（页面上「分源解析」读的就是它） ── */
  const feats = await prisma.personaFeature.findMany({
    where: { personaId: p.id, key: { startsWith: "facets:" } },
  });
  console.log(`\n持久化 facet：${feats.length} 份`);
  const facets = [];
  for (const f of feats) {
    const v = f.value;
    facets.push(v);
    console.log(`  · ${v.label ?? v.source}  [${v.source}]  依据 ${v.itemCount} 条`);
    console.log(`      values: ${vec(v.values ?? {})}`);
    console.log(`      titleOnly=${v.titleOnly}  partialReason=${v.partialReason ?? "—"}`);
    console.log(`      summary: ${v.summary}`);
  }

  /* ── 融合 ── */
  const withSbti = [...facets];
  const sbtiFacet = facetFromSbti(sbti?.dimensions, sbti?.codes, {
    typeTitle: sbti?.typeTitle,
    type: sbti?.type,
  });
  if (sbtiFacet) withSbti.push(sbtiFacet);
  const { fused, usedSources, selfReportSources, selfReportOnly } =
    fuseSourceFacets(withSbti);
  console.log(`\n融合六维：${vec(fused)}`);
  console.log(
    `  参与源：${usedSources.join(", ")}   自报源：${selfReportSources.join(", ") || "无"}   selfReportOnly=${selfReportOnly}`,
  );
  if (sbtiFacet) console.log(`  SBTI 折算成六维：${vec(sbtiFacet.values)}`);

  /* ── 雷达五轴：先 persona.values，再被融合值逐维覆盖 ── */
  const merged = { ...(p.values ?? {}) };
  for (const [k, v] of Object.entries(fused)) {
    if (typeof v === "number" && Number.isFinite(v)) merged[k] = v;
  }
  console.log(`\n雷达取值（逐维覆盖后）：${vec(merged)}`);
  const axes = axesFromObservedValues(merged);
  console.log(
    `雷达五轴：${axes.map((a) => `${a.label}=${a.value == null ? "—" : pct(a.value)}←${a.parts[0]?.key ?? "无"}`).join("  ")}`,
  );

  const t = matchPersonaType(fused);
  console.log(
    `判型：${t ? `${t.type} 匹配度 ${t.similarity}%  次优 ${t.runnerUp.map((r) => `${r.type} ${r.similarity}%`).join(" / ")}` : "null（无有效维度）"}`,
  );

  /* ── 对比：蒸馏路径用的"无 opts"口径 vs 导入/同步路径的 opts ── */
  const ev = await prisma.personaEvidence.findMany({
    where: { personaId: p.id },
    select: { source: true, note: true, value: true },
  });
  const bySource = new Map();
  for (const r of ev) {
    const list = bySource.get(r.source) ?? [];
    list.push({ text: (r.note ?? "").trim(), heat: r.value ?? undefined });
    bySource.set(r.source, list);
  }
  console.log(`\n两种口径对比（同一批证据，看差异有多大）：`);
  for (const [src, list] of bySource) {
    const clean = list.filter((x) => x.text.length > 0);
    if (!clean.length) continue;
    const a = facetFromContents(src, src, clean); // ← distill.ts 现在用的口径
    const b = facetFromContents(src, src, clean, { noHeat: true, profile: "im" }); // ← import/oauth 用的口径
    console.log(`  [${src}] ${clean.length} 条`);
    console.log(`     无 opts（蒸馏路径）  : ${vec(a?.values ?? {})}  titleOnly=${a?.titleOnly}`);
    console.log(`     noHeat+im（导入路径）: ${vec(b?.values ?? {})}  titleOnly=${b?.titleOnly}`);
  }
}

await prisma.$disconnect();
