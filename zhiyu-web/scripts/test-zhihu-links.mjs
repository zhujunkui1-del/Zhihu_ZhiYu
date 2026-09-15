#!/usr/bin/env node
/**
 * 知乎链接修正（lib/zhihu/links.ts）的验收测试。
 *
 * 修的是两个实测 bug：
 *  ① 人格卡里「知乎公开内容」的链接是 `https://www.zhiyuapp.site/pins/…`（打不开）
 *     —— 库里存的是**相对路径**，直接塞进 href 就被解析到本站域名了（615 条受影响）
 *  ② 点昵称要能打开 TA 的知乎主页（`/people/<url_token>`）
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-zhihu-links.mjs
 */
import assert from "node:assert/strict";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const { zhihuAbsoluteUrl, zhihuProfileUrl } = await import("../lib/zhihu/links.ts");

console.log("\n== ① 证据链接：相对路径必须补成知乎绝对地址 ==");
{
  const cases = [
    ["/pins/1538586676192014336", "https://www.zhihu.com/pin/1538586676192014336"],
    ["/pin/2078334496009671973", "https://www.zhihu.com/pin/2078334496009671973"],
    ["/answer/123456", "https://www.zhihu.com/answer/123456"],
    ["/question/1/answer/2", "https://www.zhihu.com/question/1/answer/2"],
    ["/pins/999", "https://www.zhihu.com/pin/999"],
  ];
  for (const [raw, want] of cases) {
    const got = zhihuAbsoluteUrl(raw);
    rec(`${raw} → ${want}`, got === want, String(got));
  }
  rec(
    "**复数 /pins/ 归一成官方单数 /pin/**（官方开放平台用的就是单数）",
    zhihuAbsoluteUrl("/pins/1") === "https://www.zhihu.com/pin/1",
  );
}

console.log("\n== ② 已经是绝对地址的不要动 ==");
{
  rec(
    "新版接口存的绝对地址原样返回",
    zhihuAbsoluteUrl("https://www.zhihu.com/pin/2078334496009671973") ===
      "https://www.zhihu.com/pin/2078334496009671973",
  );
  rec(
    "但绝对形式里的旧路径也归一",
    zhihuAbsoluteUrl("https://www.zhihu.com/pins/999") === "https://www.zhihu.com/pin/999",
  );
  rec("协议相对补 https", zhihuAbsoluteUrl("//www.zhihu.com/x") === "https://www.zhihu.com/x");
  rec(
    "别的站点的链接不动（不是我们该改的）",
    zhihuAbsoluteUrl("https://example.com/a") === "https://example.com/a",
  );
}

console.log("\n== ③ 不可用的值一律返回 null（界面不渲染链接，不给坏链） ==");
{
  rec("空串 → null", zhihuAbsoluteUrl("") === null);
  rec("null → null", zhihuAbsoluteUrl(null) === null);
  rec("undefined → null", zhihuAbsoluteUrl(undefined) === null);
  rec("裸文本 → null", zhihuAbsoluteUrl("随便一段文字") === null);
  rec(
    "**javascript: 伪协议 → null**（证据 url 来自外部数据，不能直接进 href）",
    zhihuAbsoluteUrl("javascript:alert(1)") === null,
  );
  rec("data: 伪协议 → null", zhihuAbsoluteUrl("data:text/html,<script>1</script>") === null);
}

console.log("\n== ④ 知乎主页链接 ==");
{
  rec(
    "刘昊然的 token → 正确主页",
    zhihuProfileUrl("liu-hao-ran-18-45") === "https://www.zhihu.com/people/liu-hao-ran-18-45",
    String(zhihuProfileUrl("liu-hao-ran-18-45")),
  );
  rec("没有 token → null（不渲染链接）", zhihuProfileUrl(null) === null && zhihuProfileUrl("") === null);
  rec("token 里出现空格/斜杠 → null（不拼坏 URL）", zhihuProfileUrl("a b/c") === null);
  rec(
    "token 里的中划线/数字正常保留",
    zhihuProfileUrl("zhang-jia-wei-123") === "https://www.zhihu.com/people/zhang-jia-wei-123",
  );
}

console.log(`\n  知乎链接：${pass} 通过 / ${fail} 失败`);
assert.ok(pass > 0);
process.exit(fail === 0 ? 0 : 1);
