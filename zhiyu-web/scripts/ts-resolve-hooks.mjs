/**
 * `ts-resolve.mjs` 的解析钩子实现（见该文件的说明）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/** 工程根：本文件在 <root>/scripts/ 下（用 file: URL，便于 new URL 拼接） */
const ROOT_URL = new URL("../", import.meta.url);
const ROOT = fileURLToPath(ROOT_URL);

/**
 * 依次尝试候选路径，返回第一个真实存在的 file: URL。
 *
 * 注意必须用 `pathToFileURL` 生成 URL —— 直接把 Windows 路径
 * （`D:\...`）丢给 `new URL()` 会抛 ERR_INVALID_URL。
 */
function firstExisting(absPathNoExt) {
  const candidates = [
    absPathNoExt,
    `${absPathNoExt}.ts`,
    `${absPathNoExt}.tsx`,
    path.join(absPathNoExt, "index.ts"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return pathToFileURL(c).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  /* ① `@/xxx` → 工程根下的 xxx（对应 tsconfig paths 的 "@/*": ["./*"]） */
  if (specifier.startsWith("@/")) {
    const url = firstExisting(path.join(ROOT, specifier.slice(2)));
    if (url) return { url, shortCircuit: true };
  }

  /* ② 相对/绝对路径但没有扩展名 → 补 .ts / .tsx / /index.ts */
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:")) {
    const resolved = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(resolved.pathname)) {
      const url = firstExisting(fileURLToPath(resolved));
      if (url) return { url, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}

