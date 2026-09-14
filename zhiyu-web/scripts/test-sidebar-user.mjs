#!/usr/bin/env node
/**
 * `lib/sidebar-user.ts` 的纯逻辑测试（#8）。
 *
 * 为什么要有这一层：浏览器测试跑的是**当前登录身份**那一条分支
 * （本地是 demo → 走兜底），知乎头像那条分支在 e2e 里跑不到。
 * 而这两条分支的差别正是需求的核心，必须都测到。
 *
 * 用例覆盖：
 *   · 知乎用户 → 用真实知乎头像与真实名称
 *   · 抓不到头像 → 兜底到 /assets/characters/，且文件名在白名单里
 *   · 抓不到名字 / 只有"演示用户" → 生成 zhiyu + 6 位随机字母数字
 *   · **稳定性**：同一个 seed 反复调用结果完全一致（不能每次换脸换名）
 *   · 不同 seed 会得到不同结果（否则所有兜底用户长一样）
 *   · 非 http(s) 的地址不算可用头像
 *
 * 用法：node --experimental-strip-types scripts/test-sidebar-user.mjs
 */
import {
  resolveSidebarUser,
  randomUsername,
  randomCharacter,
  characterAvatar,
  CHARACTER_FILES,
} from "../lib/sidebar-user.ts";

let pass = 0;
let fail = 0;
const rec = (label, ok, detail = "") => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  [${ok ? "OK" : "FAIL"}] ${label}`);
  if (detail) console.log(`      ${detail}`);
};

const ZHIHU_AVATAR =
  "https://pic2.zhimg.com/v2-5fc67a2efe2e8f52b40fac8a80da1442_l.jpg";

console.log("\n== 知乎用户分支 ==");
const zhihu = resolveSidebarUser({
  id: "user-1",
  displayName: "食堂泼辣酱",
  avatarUrl: ZHIHU_AVATAR,
});
rec("用真实知乎头像", zhihu.avatar === ZHIHU_AVATAR, zhihu.avatar);
rec("kind = zhihu", zhihu.kind === "zhihu", zhihu.kind);
rec("用真实名称", zhihu.name === "食堂泼辣酱", zhihu.name);

console.log("\n== 兜底分支（抓不到） ==");
const noAvatar = resolveSidebarUser({
  id: "user-2",
  displayName: "某位用户",
  avatarUrl: null,
});
rec("没有头像 → 走本地插画", noAvatar.kind === "generated", noAvatar.avatar);
rec(
  "插画在 /assets/characters/ 下",
  noAvatar.avatar.startsWith("/assets/characters/"),
  noAvatar.avatar,
);
rec("名称沿用真实名", noAvatar.name === "某位用户", noAvatar.name);

const emptyAvatar = resolveSidebarUser({
  id: "user-3",
  displayName: "",
  avatarUrl: "   ",
});
rec(
  "空串头像也算抓不到（开放平台无权限时返回空串）",
  emptyAvatar.kind === "generated",
  emptyAvatar.avatar,
);
rec(
  "空名称 → 生成 zhiyu + 6 位",
  /^zhiyu[a-z0-9]{6}$/.test(emptyAvatar.name),
  emptyAvatar.name,
);

const demoName = resolveSidebarUser({
  id: "user-4",
  displayName: "演示用户",
  avatarUrl: null,
});
rec(
  "「演示用户」这种占位名不当作真名，改走随机名",
  /^zhiyu[a-z0-9]{6}$/.test(demoName.name),
  demoName.name,
);

console.log("\n== 非 http(s) 地址不算可用 ==");
const relative = resolveSidebarUser({
  id: "user-5",
  displayName: "甲",
  avatarUrl: "/local/avatar.png",
});
rec("相对路径 → 兜底", relative.kind === "generated", relative.avatar);
const dataUrl = resolveSidebarUser({
  id: "user-6",
  displayName: "乙",
  avatarUrl: "data:image/png;base64,AAAA",
});
rec("data: URL → 兜底", dataUrl.kind === "generated", dataUrl.avatar);
const httpOk = resolveSidebarUser({
  id: "user-7",
  displayName: "丙",
  avatarUrl: "http://example.com/a.png",
});
rec("http: 也算可用（不强制 https）", httpOk.kind === "zhihu", httpOk.avatar);

console.log("\n== 稳定性（关键：同一人不换脸换名） ==");
const a1 = resolveSidebarUser({ id: "stable-seed", displayName: "", avatarUrl: null });
const a2 = resolveSidebarUser({ id: "stable-seed", displayName: "", avatarUrl: null });
const a3 = resolveSidebarUser({ id: "stable-seed", displayName: "", avatarUrl: null });
rec("三次调用结果完全一致", a1.name === a2.name && a2.name === a3.name && a1.avatar === a3.avatar, `${a1.name} / ${a1.avatar}`);
rec("名字稳定", randomUsername("stable-seed") === randomUsername("stable-seed"));
rec("头像稳定", randomCharacter("stable-seed") === randomCharacter("stable-seed"));

console.log("\n== 不同用户要有区分度 ==");
const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);
const names = new Set(seeds.map((s) => randomUsername(s)));
const avatars = new Set(seeds.map((s) => randomCharacter(s)));
rec(
  "200 个 seed 生成的名字基本不重复（>=180 种）",
  names.size >= 180,
  `${names.size} 种不同名字`,
);
rec(
  "头像覆盖到多个角色（>=5 种）",
  avatars.size >= 5,
  `${avatars.size} 种不同头像`,
);
rec(
  "所有生成名都符合 zhiyu + 6 位格式",
  [...names].every((n) => /^zhiyu[a-z0-9]{6}$/.test(n)),
  [...names].slice(0, 4).join(" "),
);
rec(
  "所有生成头像都在白名单文件里",
  [...avatars].every((a) =>
    CHARACTER_FILES.some((f) => a === characterAvatar(f)),
  ),
  [...avatars].slice(0, 4).join(" "),
);

console.log("\n== 边界 ==");
const guest = resolveSidebarUser(null);
rec(
  "未登录（null）也能渲染出可用信息",
  guest.name.length > 0 && guest.avatar.startsWith("/assets/characters/"),
  `${guest.name} / ${guest.avatar}`,
);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
