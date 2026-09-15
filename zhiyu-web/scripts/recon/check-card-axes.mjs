#!/usr/bin/env node
/** 只读：抽查若干**别人**的人格卡，确认画的是写死的五维、而不是旧的自我/情感/观念/行动/社交 */
const r = await fetch("http://127.0.0.1:3000/api/discover");
const j = await r.json();
const list = (j.personas ?? j.items ?? j.results ?? []).slice(0, 8);
if (!list.length) console.log("发现页没返回列表，keys:", Object.keys(j));
for (const p of list) {
  const x = await fetch(`http://127.0.0.1:3000/api/persona/${p.id}`).then((r) => r.json());
  const axes = (x.persona?.axes ?? []).map((a) => `${a.label}:${a.value == null ? "—" : Math.round(a.value * 100) + "%"}`);
  console.log(String(p.displayName ?? p.id).padEnd(14), JSON.stringify(axes));
}
