#!/usr/bin/env node
/**
 * 由 paper.png 生成 paper.webp（纸纹背景）。
 *
 * 为什么：`/assets/textures/paper.png` 是 1024×1024 的 PNG，**1.27 MB**，
 * 而它是全站 body 背景 —— 一次冷访问里它占了整个登录页传输量的 61%（实测）。
 * 手机端「加载太慢」很大一块就是它。同分辨率转 WebP(q=85) 只要 88 KB，
 * 体积降到 1/15，纸纹这种高频细节在 q=85 下肉眼看不出差别。
 *
 * 保留 PNG 作为老浏览器兜底：CSS 里先声明 PNG，再用
 * `image-set(... type("image/webp"), ... type("image/png"))` 覆盖，
 * 不认 image-set 的浏览器自然回落到 PNG，不会白屏也不会报错。
 *
 * 用法：node scripts/optimize-paper-texture.mjs
 */
import sharp from "sharp";
import fs from "node:fs";

const SRC = "public/assets/textures/paper.png";
const OUT = "public/assets/textures/paper.webp";
const QUALITY = 85;

const before = fs.statSync(SRC).size;
const meta = await sharp(SRC).metadata();

/* 只压格式，不改尺寸：CSS 里 background-size 是 620px，
   但高 DPR 手机需要更高像素密度，缩尺寸会糊掉纸纹 */
await sharp(SRC).webp({ quality: QUALITY, effort: 6 }).toFile(OUT);

const after = fs.statSync(OUT).size;
console.log(
  `${SRC} → ${OUT}\n` +
    `  ${meta.width}×${meta.height}  ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB` +
    `  （${(before / after).toFixed(1)}× 更小，省 ${((before - after) / 1024).toFixed(0)} KB）`,
);
