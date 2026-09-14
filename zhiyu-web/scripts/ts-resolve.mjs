/**
 * 极简 ESM 解析钩子：让纯 Node 能直接跑 `lib/` 下的模块单测。
 *
 * 解决两个 Node 原生做不到、而打包器（Next/Turbopack）能做的事：
 *   ① **补扩展名**：源码里写 `import "./chat"`，Node 的 ESM 解析器不会
 *      自动补 `.ts`（浏览器/打包器会）。没有这一步就只能把源码改成
 *      `./chat.ts`，但那样 TypeScript 会报 TS5097（需开
 *      `allowImportingTsExtensions`）—— 为了测试去改生产代码的写法不划算。
 *   ② **`@/` 路径别名**：`@/lib/db` 之类由 tsconfig 的 paths 提供，
 *      Node 不认识，需要映射到 `<工程根>/`。
 *
 * 用法：node --import ./scripts/ts-resolve.mjs scripts/xxx.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve-hooks.mjs", pathToFileURL(`${import.meta.dirname}/`));
