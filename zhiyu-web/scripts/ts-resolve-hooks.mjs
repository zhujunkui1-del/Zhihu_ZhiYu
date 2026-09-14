/**
 * `ts-resolve.mjs` 的解析钩子实现（见该文件的说明）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 工程根：本文件在 <root>/scripts/ 下 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** 依次尝试候选路径，返回第一个真实存在的文件 URL */
function firstExisting(basePath) {
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, `${basePath}/index.ts`];
  for (const c of candidates) {
    try {
      const url = new URL(c);
      if (existsSync(fileURLToPath(url))) return url.href;
    } catch {
      /* 非法 URL 直接跳过 */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  /* ① `@/xxx` → 工程根下的 xxx（对应 tsconfig paths 的 "@/*": ["./*"]） */
  if (specifier.startsWith("@/")) {
    const url = firstExisting(new URL(specifier.slice(2), ROOT));
    if (url) return { url, shortCircuit: true };
  }

  /* ② 相对/绝对路径但没有扩展名 → 补 .ts / .tsx / /index.ts */
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("file:")) {
    const resolved = new URL(specifier, context.parentURL);
    if (!/\.[a-z]+$/i.test(resolved.pathname)) {
      const url = firstExisting(resolved);
      if (url) return { url, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
