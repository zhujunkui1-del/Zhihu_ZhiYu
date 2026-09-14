#!/usr/bin/env node
/**
 * 核对：每个人格代码是否都能找到一个存在的头像文件。
 *
 * 已知坑：代码 `WOC!` 带感叹号，而文件名是 `WOC.webp` ——
 * 直接 `code + ".webp"` 会 404。所以要有一套确定的归一化规则。
 */
import fs from "node:fs";
import path from "node:path";
import personalities from "../lib/sbti/data/personalities.json" with { type: "json" };

const DIR = path.resolve("public/assets/sbti");
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".webp"));
const byName = new Set(files.map((f) => f.replace(/\.webp$/, "")));

/** 归一化：只保留字母数字，转大写（`WOC!` → `WOC`，`ATM-er` → `ATMER`） */
const norm = (s) => String(s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();

const fileByNorm = new Map();
for (const f of files) fileByNorm.set(norm(f.replace(/\.webp$/, "")), f);

console.log(`头像文件 ${files.length} 个；人格库 ${personalities.length} 条\n`);
console.log("代码 → 头像文件：");
let miss = 0;
for (const p of personalities) {
  const f = fileByNorm.get(norm(p.name));
  if (!f) {
    miss += 1;
    console.log(`  ✗ ${String(p.name).padEnd(10)} 找不到头像`);
  } else {
    console.log(`  ✓ ${String(p.name).padEnd(10)} → ${f}`);
  }
}

console.log(`\n缺失 ${miss} 个`);
const unused = files.filter((f) => !personalities.some((p) => fileByNorm.get(norm(p.name)) === f));
console.log(`未被任何人格用到的头像：${unused.length ? unused.join(", ") : "(无)"}`);
process.exit(miss ? 1 : 0);
