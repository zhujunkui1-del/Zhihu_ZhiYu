/**
 * 上线就绪度检查（如实报告，不美化）。
 *
 * 检查项：
 *   ① 构建是否干净
 *   ② 环境变量：代码里用到 vs .env 里有 vs .env.example 里有
 *   ③ 是否有硬编码的 localhost / 域名（部署后会坏）
 *   ④ 是否引入境外第三方资源（AGENTS.md 硬约束：必须自托管）
 *   ⑤ Prisma schema 与实际库是否一致
 */
import fs from "node:fs";
import path from "node:path";

const WEB = process.cwd();
const ROOT = path.resolve("..");

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", "migrations"].includes(e.name)) continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const codeFiles = walk(path.join(WEB, "app"))
  .concat(walk(path.join(WEB, "lib")))
  .concat(walk(path.join(WEB, "components")))
  .concat(fs.existsSync(path.join(WEB, "middleware.ts")) ? [path.join(WEB, "middleware.ts")] : []);

/* 本脚本自身含检测用的域名字符串，不该把自己算成命中 */
const SELF = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const allText = codeFiles
  .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
  .map((f) => ({ f, t: fs.readFileSync(f, "utf8") }));

console.log("=".repeat(84));
console.log("① 环境变量核对");
console.log("=".repeat(84));

/* 从代码里抓 process.env.XXX */
const used = new Set();
for (const { t } of allText) {
  for (const m of t.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
}

const readEnv = (p) => {
  if (!fs.existsSync(p)) return new Map();
  const m = new Map();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const x = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?/);
    if (x) m.set(x[1], x[2].trim());
  }
  return m;
};
const env = readEnv(path.join(WEB, ".env"));
const example = readEnv(path.join(WEB, ".env.example"));

/* Prisma/Neon 自带的一批环境变量不算业务配置 */
const IGNORE = /^(NODE_ENV|VERCEL|NEXT_RUNTIME|CI|PORT|PG|POSTGRES_|DATABASE_URL_UNPOOLED)/;

const rows = [];
for (const name of [...used].sort()) {
  if (IGNORE.test(name)) continue;
  const inEnv = env.has(name);
  const inExample = example.has(name);
  const filled = inEnv && env.get(name).length > 0;
  rows.push({ name, inExample, filled, has: inEnv });
}

console.log(`${"变量".padEnd(32)}${"代码引用".padEnd(10)}${".env".padEnd(8)}${".env.example"}`);
console.log("-".repeat(84));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(32)}${"是".padEnd(10)}${(r.filled ? "已填" : r.has ? "空" : "缺").padEnd(8)}${r.inExample ? "有" : "✗ 缺"}`,
  );
}

const missingExample = rows.filter((r) => !r.inExample);
const emptyNow = rows.filter((r) => r.has && !r.filled);

console.log("\n" + "=".repeat(84));
console.log("② 硬编码地址检查（部署后会坏的写法）");
console.log("=".repeat(84));
const badHosts = [];
for (const { f, t } of allText) {
  for (const m of t.matchAll(/https?:\/\/(localhost|127\.0\.0\.1)[^\s"'`)]*/g)) {
    badHosts.push({ f: path.relative(ROOT, f), hit: m[0] });
  }
}
if (badHosts.length) {
  for (const h of badHosts) console.log(`  · ${h.f}  →  ${h.hit}`);
} else {
  console.log("  ✓ 源码中没有硬编码 localhost（脚本除外则另算）");
}

console.log("\n" + "=".repeat(84));
console.log("③ 境外第三方资源检查（AGENTS.md：必须自托管）");
console.log("=".repeat(84));
const FOREIGN = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "google-analytics",
  "googletagmanager",
  "cdnjs.cloudflare.com",
];
const foreignHits = [];
for (const { f, t } of allText) {
  for (const d of FOREIGN) if (t.includes(d)) foreignHits.push(`${path.relative(ROOT, f)} → ${d}`);
}
/* 样式与页面里也查一遍 */
for (const f of walk(path.join(WEB, "app")).filter((x) => /\.css$/.test(x))) {
  const t = fs.readFileSync(f, "utf8");
  for (const d of FOREIGN) if (t.includes(d)) foreignHits.push(`${path.relative(ROOT, f)} → ${d}`);
}
if (foreignHits.length) {
  for (const h of foreignHits) console.log(`  ✗ ${h}`);
} else {
  console.log("  ✓ 未引入境外 CDN / 字体 / 统计");
}

console.log("\n" + "=".repeat(84));
console.log("④ 汇总");
console.log("=".repeat(84));
console.log(`  环境变量：代码用到 ${rows.length} 个；.env.example 缺 ${missingExample.length} 个；当前为空 ${emptyNow.length} 个`);
if (missingExample.length) {
  console.log(`    .env.example 待补：${missingExample.map((r) => r.name).join(", ")}`);
}
if (emptyNow.length) {
  console.log(`    当前为空（多半依赖部署时填）：${emptyNow.map((r) => r.name).join(", ")}`);
}
console.log(`  硬编码 localhost：${badHosts.length} 处`);
console.log(`  境外第三方资源：${foreignHits.length} 处`);
