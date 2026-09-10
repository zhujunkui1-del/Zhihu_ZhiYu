// 一次性构建：解析 sbti-skill 的 questions.md / personalities.md → lib/sbti/data/*.json
// 用法：node scripts/build-sbti.mjs
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = "D:/tlydcg/Codex_work/知乎黑客松/开源项目/sbti-skill/references";
const outDir = join(root, "lib", "sbti", "data");

function parseQuestions() {
  const text = readFileSync(join(srcDir, "questions.md"), "utf8");
  const questions = [];
  let currentDim = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^## 特殊题/.test(line)) break;

    const dimMatch = line.match(/^### ([A-Za-z0-9]+)\s+(.+)$/);
    if (dimMatch) {
      currentDim = { id: dimMatch[1], name: dimMatch[2].trim() };
      continue;
    }

    const qMatch = line.match(/^\*\*q(\d+)\*\*:\s*(.+)$/);
    if (qMatch) {
      questions.push({
        id: `q${qMatch[1]}`,
        dim: currentDim?.id ?? "",
        dimName: currentDim?.name ?? "",
        text: qMatch[2].trim(),
        options: [],
      });
      continue;
    }

    const optMatch = line.match(/^- ([A-D])\s*(?:\((\d)分\))?:?\s*(.*)$/);
    if (optMatch && questions.length > 0) {
      const last = questions[questions.length - 1];
      last.options.push({
        key: optMatch[1],
        score: optMatch[2] ? Number(optMatch[2]) : 0,
        text: optMatch[3].trim(),
      });
    }
  }
  return questions;
}

function parsePersonalities() {
  const text = readFileSync(join(srcDir, "personalities.md"), "utf8");
  const blocks = text.split(/^### /m).slice(1);
  const list = [];
  for (const block of blocks) {
    const head = block.match(/^#(\d+) ([A-Za-z0-9_!-]+) — (.+)/);
    if (!head) continue;
    const body = block.replace(/^#\d+ [^\n]*\n?/, "");
    const mode = body.match(/模式\*\*:\s*([HML-]+)/);
    if (!mode) continue; // DRUNK 等无 pattern 的特殊人格不进常规匹配库
    const greeting = body.match(/开场白\*\*:\s*(.+)/);
    const desc = body.match(/描述\*\*:\s*([\s\S]*?)(?=\n### |$)/);
    list.push({
      id: head[1],
      name: head[2],
      title: head[3].trim(),
      pattern: mode[1],
      greeting: greeting?.[1]?.trim() ?? "",
      description: desc?.[1]?.trim() ?? "",
    });
  }
  return list;
}

mkdirSync(outDir, { recursive: true });
const questions = parseQuestions();
const personalities = parsePersonalities();
writeFileSync(join(outDir, "questions.json"), JSON.stringify(questions, null, 2), "utf8");
writeFileSync(
  join(outDir, "personalities.json"),
  JSON.stringify(personalities, null, 2),
  "utf8",
);

console.log(`questions: ${questions.length}（维度：${new Set(questions.map((q) => q.dim)).size}）`);
console.log(`personalities: ${personalities.length}`);
console.log(`DRUNK/HHHH 是否在库：${personalities.some((p) => p.name === "DRUNK")}/${personalities.some((p) => p.name === "HHHH")}`);
