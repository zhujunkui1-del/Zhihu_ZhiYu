#!/usr/bin/env node
/**
 * 验证知乎头像 URL 的尺寸变体是否真实存在。
 *
 * 目的：`lib/sidebar-user.ts` 里用 `_xs.` 作为"这是默认占位头像"的判据。
 * 这个判据不能靠记忆 —— 直接去打这几个 URL，看哪个真有内容、
 * 各变体的字节数差多少。实测数据：头像基础 hash 相同，后缀不同分辨率不同。
 */
const base = "https://pic2.zhimg.com/v2-5fc67a2efe2e8f52b40fac8a80da1442";
const variants = ["_l.jpg", "_xl.jpg", "_m.jpg", "_s.jpg", "_xs.jpg", "_r.jpg", "_b.jpg", ""];

for (const v of variants) {
  const url = base + v;
  try {
    const r = await fetch(url, { method: "GET" });
    const buf = await r.arrayBuffer();
    const type = r.headers.get("content-type") ?? "?";
    console.log(
      `${r.status}  ${String(buf.byteLength).padStart(8)} B  ${type.padEnd(12)} ${v || "(无后缀)"}`,
    );
  } catch (e) {
    console.log(`ERR  ${e.message}  ${v || "(无后缀)"}`);
  }
}
