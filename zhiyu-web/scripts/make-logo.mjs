/**
 * 由素材 logo 生成 README 用图与站点用 logo。
 *
 * 源图 977×866 / 839 KB，对 README 与网页都过大，需要缩放。
 * 保留原有米色底（与产品 --bg #f8f0df 一致），不强行抠图——抠图会破坏描边。
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("..");
const SRC = path.join(ROOT, "素材/logo-zhiyu-master.png");
const meta = await sharp(SRC).metadata();
console.log(
  `源图：${meta.width}×${meta.height}  ${(fs.statSync(SRC).size / 1024).toFixed(0)} KB`,
);

const targets = [
  { out: path.join(ROOT, "产品方案/assets/logo-zhiyu.png"), width: 360 },
  { out: path.join(ROOT, "zhiyu-web/public/assets/brand/logo-zhiyu.png"), width: 512 },
];

for (const t of targets) {
  fs.mkdirSync(path.dirname(t.out), { recursive: true });
  await sharp(SRC)
    .resize({ width: t.width, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(t.out);
  const m = await sharp(t.out).metadata();
  console.log(
    `  → ${path.relative(ROOT, t.out)}  ${m.width}×${m.height}  ${(fs.statSync(t.out).size / 1024).toFixed(0)} KB`,
  );
}
console.log("\n完成。");
