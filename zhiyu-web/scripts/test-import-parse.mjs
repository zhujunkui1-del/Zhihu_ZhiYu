#!/usr/bin/env node
/**
 * 「手动导入数据」解析层的测试。
 *
 * ── 为什么先测这一层 ──────────────────────────────────────────────────
 * 需求是"点按钮 → 弹系统文件窗口 → 把 json/txt 导进来能用于蒸馏"。
 * 这条链路上最容易出错、也最难靠手点页面发现的是**解析**：
 * 各家导出格式不一样（微信/QQ 没有统一格式，飞书/钉钉要对齐 distilly），
 * 而解析错了的表现是"导入成功但内容不对"—— 手点页面看不出来。
 *
 * 所以这里用**真实形态的样例文本**逐条钉住：
 *   · 微信 JSON / TXT / CSV
 *   · QQ 两行式 TXT、富文本数组 JSON
 *   · 飞书 JSON（distilly `feishu_parser.py` 认的结构）、distilly TXT
 *   · 钉钉 distilly 采集产物 docs.txt / bitables.txt / messages.txt
 * 外加 GBK 解码、昵称过滤、噪声过滤、noHeat 语义。
 *
 * 用法：node --no-warnings --import ./scripts/ts-resolve.mjs scripts/test-import-parse.mjs
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

const { parseImportFile, decodeBytes, parseCsv, IMPORT_MAX_BYTES } = await import(
  "../lib/import/parse.ts"
);
const { facetFromContents, VALUE_KEYS } = await import("../lib/persona/fusion.ts");

/* ── ① 微信：JSON ─────────────────────────────────────────────────────── */
console.log("\n== 微信 JSON（第三方导出工具常见形态：messages + talker/content/createTime）==");
const wechatJson = JSON.stringify({
  chat: "与 小李 的聊天",
  messages: [
    {
      talker: "我",
      content:
        "这个方案我建议先把风险列出来再决定要不要推进：第一是数据来源的合规边界，第二是上线节奏会不会挤压其它排期，第三是万一出错怎么回滚。",
      createTime: "2024-01-01 10:00:00",
    },
    { talker: "小李", content: "行，那我今天整理一下", createTime: "2024-01-01 10:01:00" },
    { talker: "我", content: "[图片]", createTime: "2024-01-01 10:02:00" },
    { talker: "我", content: "好的", createTime: "2024-01-01 10:03:00" },
    { talker: "我", content: "好的", createTime: "2024-01-01 10:04:00" },
    { talker: "我", content: "我最近在读一些关于技术伦理的书，也在写长文，想把这些想法系统化", createTime: "2024-01-01 10:05:00" },
  ],
});
const w1 = parseImportFile("wechat", "chat.json", wechatJson, { selfName: "我" });
rec("认出了 messages 数组", w1.format.includes("JSON"), w1.format);
rec(
  "按昵称只留自己发的（6 条原始 → 跳过对方 1 条、图片 1 条）",
  w1.rawCount === 6 && w1.items.length === 4,
  `raw=${w1.rawCount} items=${w1.items.length}：${w1.items.map((i) => i.text).join(" | ")}`,
);
rec("过滤掉 [图片]", !w1.items.some((i) => i.text.includes("[图片]")));
rec(
  "重复消息**保留**（重复率本身是「复读 vs 说新东西」的信号）",
  w1.items.filter((i) => i.text === "好的").length === 2,
  `「好的」出现 ${w1.items.filter((i) => i.text === "好的").length} 次`,
);
rec(
  "长消息排在前面（证据按信息量排序）",
  w1.items[0].text.length >= w1.items[w1.items.length - 1].text.length,
  w1.items.map((i) => `${i.trait}:${i.text.length}`).join(" "),
);
rec("长消息被标为「长消息」", w1.items.some((i) => i.trait === "长消息"));
rec(
  "过滤与保留都写进了 warnings（不静默）",
  w1.warnings.some((w) => w.includes("过滤：保留")) && w1.warnings.some((w) => w.includes("噪声")),
  w1.warnings.join(" ⏐ "),
);

const w1NoName = parseImportFile("wechat", "chat.json", wechatJson);
rec(
  "没填昵称时**如实警告**会混入对方的话",
  w1NoName.warnings.some((w) => w.includes("没有填昵称")),
  w1NoName.warnings.find((w) => w.includes("昵称")) ?? "(无)",
);
rec("列出了文件里的发言者（帮用户核对昵称）", w1.speakers.length >= 2, w1.speakers.join("、"));

const w1Wrong = parseImportFile("wechat", "chat.json", wechatJson, { selfName: "不存在的人" });
rec(
  "昵称填错时不报成功，而是给出可操作的提示",
  w1Wrong.items.length === 0 && w1Wrong.warnings[0].includes("没有找到"),
  w1Wrong.warnings[0].slice(0, 80),
);

/* ── ② 微信 / QQ：TXT ─────────────────────────────────────────────────── */
console.log("\n== 微信 TXT（`昵称：内容`）+ QQ TXT（两行式）==");
const wechatTxt = [
  "张三：今天去看了个展，讲的是城市记忆，挺有意思",
  "李四：我也想去",
  "张三：这个展的策展思路是把老照片和口述史放在一起，比单纯摆物件有力量",
  "",
  "张三：回头我把链接发你",
].join("\n");
const t1 = parseImportFile("wechat", "chat.txt", wechatTxt, { selfName: "张三" });
rec(
  "只留张三的 3 条",
  t1.items.length === 3,
  t1.items.map((i) => i.text).join(" | "),
);
rec("跳过了李四那条", !t1.items.some((i) => i.text.includes("我也想去")));

const qqTxt = [
  "2024-03-05 21:00:00 阿强",
  "我最近在折腾一个开源项目，主要是想把聊天记录做成可检索的知识库",
  "2024-03-05 21:01:12 小美",
  "哇 好厉害",
  "2024-03-05 21:02:00 阿强",
  "难点其实在隐私边界：本地解析和上传云端是两种完全不同的承诺",
].join("\n");
const q1 = parseImportFile("qq", "qq.txt", qqTxt, { selfName: "阿强" });
rec(
  "两行式 QQ 导出：正确取出 2 条（时间与昵称行不当正文）",
  q1.items.length === 2,
  q1.items.map((i) => `${i.trait}|${i.text.slice(0, 18)}`).join(" ⏐ "),
);
rec(
  "没有把「2024-03-05 21:00:00 阿强」当成内容",
  !q1.items.some((i) => i.text.startsWith("2024-")),
);

/* ── ③ QQ：富文本数组 JSON ───────────────────────────────────────────── */
console.log("\n== QQ JSON（富文本数组 content + 名字在前时间在后的 TXT）==");
const qqJson = JSON.stringify({
  msgList: [
    {
      sender: "阿强",
      content: [{ text: "关于这个问题，" }, { text: "我觉得先看数据再下结论" }, { text: "，不然容易拍脑袋" }],
      time: "2024-03-06 09:00",
    },
  ],
});
const q2 = parseImportFile("qq", "qq.json", qqJson);
rec(
  "富文本数组被拼成一句话",
  q2.items.length === 1 && q2.items[0].text.includes("先看数据再下结论"),
  q2.items[0]?.text,
);

const wechatNameFirst = ["张三 2024-01-01 10:00:00", "名字在前、时间在后的格式也要认"].join("\n");
const t2 = parseImportFile("wechat", "chat.txt", wechatNameFirst, { selfName: "张三" });
rec(
  "「名字 + 时间」两行式也能认",
  t2.items.length === 1 && t2.items[0].text.includes("名字在前"),
  t2.items[0]?.text,
);

/* ── ④ CSV ───────────────────────────────────────────────────────────── */
console.log("\n== CSV（带表头 / 引号包裹 / 逗号在内容里）==");
const csv = [
  "sender,content,time",
  '张三,"今天的复盘我写完了，重点是三个：范围、风险、验收",2024-01-02 09:00',
  "李四,收到,2024-01-02 09:01",
].join("\n");
const c1 = parseImportFile("wechat", "chat.csv", csv, { selfName: "张三" });
rec(
  "按表头取列，且引号里的逗号没被切开",
  c1.items.length === 1 && c1.items[0].text.includes("范围、风险、验收"),
  c1.items[0]?.text,
);
rec(
  "parseCsv 处理转义引号",
  parseCsv('a,"他说""你好""",c')[0][1] === '他说"你好"',
  parseCsv('a,"他说""你好""",c')[0][1],
);

/* ── ④b 真实微信导出工具 WeFlow 的格式（用户的实际文件）────────────── */
console.log("\n== 微信 WeFlow 导出（真实文件格式：senderDisplayName + isSend + session）==");
const weflow = JSON.stringify({
  weflow: { version: "1.0.3", exportedAt: 1788287742, generator: "WeFlow" },
  session: {
    wxid: "wxid_el53la4o0sc522",
    nickname: "Evol",
    remark: "陈思婕",
    displayName: "陈思婕",
    type: "私聊",
    messageCount: 608,
  },
  messages: [
    {
      localId: 1,
      createTime: 1729904359,
      formattedTime: "2024-10-26 08:59:19",
      type: "文本消息",
      content: "我通过了你的朋友验证请求，现在我们可以开始聊天了",
      isSend: 0,
      senderUsername: "wxid_el53la4o0sc522",
      senderDisplayName: "陈思婕",
    },
    {
      localId: 2,
      type: "动画表情",
      content: "[表情包]",
      isSend: 1,
      senderDisplayName: "S·P·W",
    },
    {
      localId: 3,
      type: "文本消息",
      content: "我下周一到长沙，大概待三天，想把上次说的那个方案再对一遍细节",
      isSend: 1,
      senderDisplayName: "S·P·W",
    },
    {
      localId: 4,
      type: "引用消息",
      content: "可以([引用 S·P·W：我下周一到长沙])",
      isSend: 0,
      senderDisplayName: "陈思婕",
      replyToMessageId: 3,
      quotedSender: "S·P·W",
    },
    { localId: 5, type: "系统消息", content: "对方撤回了一条消息", isSend: 0, senderDisplayName: "" },
  ],
});
const wf = parseImportFile("wechat", "私聊_陈思婕.json", weflow, { selfName: "S·W" });
rec(
  "认出发言人（senderDisplayName）",
  wf.speakers.some((s) => s.includes("S·P·W")) && wf.speakers.some((s) => s.includes("陈思婕")),
  wf.speakers.join("、"),
);
rec(
  "⚠️ 用文件自带的 isSend 判断方向（不再依赖昵称，昵称填错也不影响）",
  wf.mineDetectedBy === "flag",
  `mineDetectedBy=${wf.mineDetectedBy}`,
);
rec(
  "只留我发的 1 条（对方 2 条被跳过；表情包与系统消息被丢）",
  wf.items.length === 1 && wf.items[0].text.includes("长沙"),
  wf.items.map((i) => i.text.slice(0, 24)).join(" ⏐ "),
);
rec(
  "认出会话对象（与「陈思婕」的私聊）",
  wf.session?.partnerName === "陈思婕" && wf.session?.type === "私聊",
  JSON.stringify(wf.session),
);
rec(
  "昵称填错时**如实告知**，而不是静默按错的过滤",
  wf.warnings.some((w) => w.includes("S·W") && w.includes("没有出现")),
  wf.warnings.find((w) => w.includes("没有出现")) ?? "(无)",
);
rec("系统消息整条丢弃", !wf.items.some((i) => i.text.includes("撤回")));

/* 没有 isSend、也没有昵称时，必须警告"会混入对方的特征" */
const noFlag = JSON.parse(weflow);
delete noFlag.session;
for (const m of noFlag.messages) delete m.isSend;
const nf = parseImportFile("wechat", "x.json", JSON.stringify(noFlag));
rec(
  "没有方向标记又没填昵称 → 明确警告会混入对方特征",
  nf.mineDetectedBy === "none" && nf.warnings.some((w) => w.includes("没有填昵称")),
  nf.warnings.join(" ⏐ ").slice(0, 110),
);

/* ── ⑤ 飞书：distilly feishu_parser.py 认的 JSON ─────────────────────── */
console.log("\n== 飞书 JSON（distilly 口径：data.messages + sender_name/content.text）==");
const feishuJson = JSON.stringify({
  code: 0,
  data: {
    messages: [
      {
        sender_name: "我",
        content: { text: "这个季度的目标我建议拆成两条线：一条保交付，一条做技术债清理" },
        timestamp: "1710000000",
      },
      { sender_name: "同事A", content: { text: "同意" }, timestamp: "1710000060" },
      { sender_name: "我", content: "[文件]", timestamp: "1710000120" },
    ],
  },
});
const f1 = parseImportFile("feishu", "feishu.json", feishuJson, { selfName: "我" });
rec("认出了 data.messages", f1.format.includes("data.messages"), f1.format);
rec("嵌套 content.text 被正确取出", f1.items.length === 1 && f1.items[0].text.includes("技术债"), f1.items[0]?.text);
rec("跳过 [文件]", !f1.items.some((i) => i.text.includes("[文件]")));

const feishuTxt = [
  "2024-05-01 09:30 我：这份方案的风险点我列了三条，最需要确认的是第二条",
  "2024-05-01 09:31 同事B：我看下",
].join("\n");
const f2 = parseImportFile("feishu", "messages.txt", feishuTxt, { selfName: "我" });
rec(
  "distilly 的 TXT 时间戳格式（`时间 昵称：内容`）能解析",
  f2.items.length === 1 && f2.items[0].text.includes("风险点"),
  f2.items[0]?.text,
);

/* ── ⑥ 钉钉：distilly 采集产物 ───────────────────────────────────────── */
console.log("\n== 钉钉 docs.txt（distilly `dingtalk_auto_collector.py` 的真实产物形态）==");
const dingtalkDocs = [
  "# 文档内容（钉钉自动采集）",
  "",
  "目标：张三",
  "",
  "---",
  "",
  "## 《Q3 技术规划》",
  "",
  "本季度重点是稳定性治理，先把告警收敛做掉，再谈新功能。",
  "",
  "## 《复盘：一次线上事故》",
  "",
  "根因不是代码，是发布流程缺少灰度环节。",
].join("\n");
const d1 = parseImportFile("dingtalk", "docs.txt", dingtalkDocs, { selfName: "张三" });
rec(
  "文档分段被解析成 2 条（`## 《标题》` 不当正文）",
  d1.items.length === 2,
  d1.items.map((i) => i.text.slice(0, 26)).join(" ⏐ "),
);
rec(
  "章节名带进了正文（保留出处）",
  d1.items.some((i) => i.text.includes("Q3 技术规划")),
  d1.items[0]?.text,
);
rec(
  "没有把 `# 文档内容（钉钉自动采集）` 当成一条内容",
  !d1.items.some((i) => i.text.includes("## ") || i.text.startsWith("# ")),
);
rec(
  "⚠️ 采集脚本的前言块（`目标：张三`）没被当成消息",
  !d1.items.some((i) => i.text.includes("目标")),
  d1.items.map((i) => i.text.slice(0, 14)).join(" ⏐ "),
);
rec(
  "⚠️ 没有发言人的文档段落**不会**因为填了昵称就被丢掉",
  d1.items.length === 2,
  `${d1.items.length} 条（填的是「张三」，而文件里没有署名）`,
);
rec("标为「工作记录」而不是「日常」", d1.items.every((i) => i.trait !== "日常"), d1.items.map((i) => i.trait).join(","));

console.log("\n== 钉钉 messages.txt（`[时间] 正文`，正文里自带冒号）==");
const dingtalkMsgs = [
  "# 消息记录（钉钉浏览器采集）",
  "目标：张三",
  "共 3 条",
  "注意：钉钉 API 不支持历史消息拉取，本内容通过浏览器采集",
  "",
  "---",
  "",
  "## 长消息（观点/决策/技术类）",
  "",
  "[2024-06-01 10:00] 注意：这次的排期要留出联调时间，不然又要延期",
  "",
  "[2024-06-01 10:05] 这个接口我建议加一层幂等，重复请求不会产生副作用，代价很小但收益明显",
  "",
  "---",
  "",
  "## 日常消息（风格参考）",
  "",
  "[2024-06-01 11:00] 收到，我看下",
].join("\n");
const d2 = parseImportFile("dingtalk", "messages.txt", dingtalkMsgs, { selfName: "张三" });
rec(
  "⚠️ 正文开头的「注意：」不会被当成发言人（否则填了昵称就会被静默丢掉）",
  d2.items.some((i) => i.text.startsWith("注意：")),
  d2.items.map((i) => i.text.slice(0, 16)).join(" ⏐ "),
);
rec(
  "填了昵称、但文件里没有发言人时**不误杀**（全部保留）",
  d2.items.length === 3,
  `${d2.items.length} 条`,
);
rec(
  "「共 3 条」「目标：张三」「注意：钉钉 API…」这些前言没被当成内容",
  !d2.items.some((i) => i.text.includes("共 3 条") || i.text.includes("目标：")),
  d2.items.map((i) => i.text.slice(0, 14)).join(" ⏐ "),
);

const dingtalkBitables = [
  "# 多维表格（钉钉自动采集）",
  "",
  "## 《项目跟进表》",
  "",
  "### 表：风险登记",
  "",
  "风险：第三方接口不稳定 / 等级：高 / 负责人：张三",
].join("\n");
const d3 = parseImportFile("dingtalk", "bitables.txt", dingtalkBitables);
rec("多维表格也能读成内容", d3.items.length >= 1, d3.items.map((i) => i.text.slice(0, 30)).join(" ⏐ "));

console.log("\n== ⚠️ 散文里的冒号不能被当成发言人（会吃掉半句话）==");
/* 这是真踩过的 bug：`本季度重点是稳定性治理：先把告警收敛做掉` 被拆成
   发言人「本季度重点是稳定性治理」+ 内容「先把告警收敛做掉」，前半句直接丢了。 */
const proseWithColon = [
  "## 《Q3 规划》",
  "",
  "本季度重点是稳定性治理：先把告警收敛做掉，再谈新功能。",
].join("\n");
const p1 = parseImportFile("dingtalk", "prose.md", proseWithColon);
rec(
  "整句都在（前半句没被当成发言人吃掉）",
  p1.items.length === 1 && p1.items[0].text.includes("本季度重点是稳定性治理") && p1.items[0].text.includes("先把告警收敛做掉"),
  p1.items[0]?.text,
);
rec("没有凭空造出发言人", p1.speakers.length === 0, p1.speakers.join("、") || "（无）");

/* 聊天记录里的昵称会反复出现，所以要照样认出来 */
const chatRepeated = [
  "小明：今天加班到十点",
  "小红：辛苦了",
  "小明：明天还得继续",
].join("\n");
const p2 = parseImportFile("wechat", "chat.txt", chatRepeated, { selfName: "小明" });
rec(
  "聊天里反复出现的昵称仍被认成发言人（过滤照常生效）",
  p2.items.length === 2 && !p2.items.some((i) => i.text.includes("辛苦了")),
  p2.items.map((i) => i.text).join(" ⏐ "),
);

/* ── ⑦ 编码 ──────────────────────────────────────────────────────────── */
console.log("\n== 编码：UTF-8 与 GBK（微信/QQ 导出常见 GBK）==");
const utf8Bytes = new TextEncoder().encode("张三：今天天气不错");
const dUtf8 = decodeBytes(utf8Bytes);
rec("UTF-8 正常解码", dUtf8.text === "张三：今天天气不错" && dUtf8.encoding === "utf-8", dUtf8.encoding);

/* "张三：今天天气不错" 的 GBK 字节（手工构造，避免依赖环境编码器） */
const gbkBytes = new Uint8Array([
  0xd5, 0xc5, 0xc8, 0xfd, 0xa3, 0xba, 0xbd, 0xf1, 0xcc, 0xec, 0xcc, 0xec, 0xc6, 0xf8, 0xb2,
  0xbb, 0xb4, 0xed,
]);
const dGbk = decodeBytes(gbkBytes);
rec(
  "GBK 字节被正确解码（不是满屏乱码）",
  dGbk.text === "张三：今天天气不错",
  `${dGbk.encoding} → ${dGbk.text}`,
);
rec("并如实告知用户换了编码", Boolean(dGbk.warning), dGbk.warning ?? "(无)");

const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("你好")]);
rec("UTF-8 BOM 被剥掉", decodeBytes(bom).text === "你好", JSON.stringify(decodeBytes(bom).text));

/* ── ⑧ 坏输入 ────────────────────────────────────────────────────────── */
console.log("\n== 坏输入：不崩、且给出可操作的提示 ==");
const bad = parseImportFile("wechat", "chat.json", "{这不是 json");
rec("非法 JSON → 不抛异常，提示改后缀", bad.items.length === 0 && bad.warnings[0].includes("不是合法的 JSON"), bad.warnings[0].slice(0, 60));
const unknown = parseImportFile("wechat", "x.json", JSON.stringify({ foo: "bar", n: 1 }));
rec("JSON 结构不识别 → 说清支持哪些键", unknown.items.length === 0 && unknown.warnings[0].includes("messages"), unknown.warnings[0].slice(0, 70));
const empty = parseImportFile("wechat", "x.txt", "   \n  \n");
rec("空文件 → 明确报空", empty.items.length === 0 && empty.warnings[0].includes("空"), empty.warnings[0]);
const onlyNoise = parseImportFile("wechat", "x.txt", "[图片]\n[表情]\n[语音]\n");
rec("只有图片/表情 → 说明「过滤后没有可用内容」", onlyNoise.items.length === 0, onlyNoise.warnings.join(" ⏐ ").slice(0, 80));

/* ── ⑨ 分源解析：聊天数据的口径（im profile）───────────────────────── */
console.log("\n== 分源解析：聊天/文档要用 im 口径，不许量错东西 ==");
const chatContents = [
  { text: "这个方案我建议先把风险列出来再决定要不要推进，不然容易返工" },
  { text: "我最近在读一些关于技术伦理的书，也在写长文，想把这些想法系统化" },
  { text: "同意" },
  { text: "同意" },
  { text: "同意" },
  { text: "先做小范围灰度，出问题也好回滚" },
];

const im = facetFromContents("wechat", "微信 · 私域生活", chatContents, {
  noHeat: true,
  profile: "im",
});
rec(
  "⚠️ 聊天短文本**不会**被误判成「只有标题」（旧逻辑会把三个维度整组丢掉）",
  im && im.titleOnly === false && typeof im.values.stability === "number",
  `titleOnly=${im?.titleOnly} keys=${Object.keys(im?.values ?? {}).join("、")}`,
);
rec(
  "social 缺失（没有互动量，不是 1%）",
  typeof im.values.social !== "number",
);
rec(
  "learning 缺失（聊天里没有可靠的「学习成长」信号，不硬算）",
  typeof im.values.learning !== "number",
);
rec(
  "creation = 1 - 重复率（6 条里有 2 条是重复的「同意」→ 2/3）",
  Math.abs(im.values.creation - 2 / 3) < 1e-9,
  `creation=${im.values.creation}（重复率 ${(1 - im.values.creation).toFixed(3)}）`,
);
rec(
  "stability / autonomy 照常算出",
  typeof im.values.stability === "number" && typeof im.values.autonomy === "number",
  `stability=${im.values.stability} autonomy=${im.values.autonomy}`,
);
rec(
  "所有值都在 [0.01, 0.99]（产品要求不出现 0%/100%）",
  Object.values(im.values).every((v) => v >= 0.01 && v <= 0.99),
  JSON.stringify(im.values),
);
rec(
  "缺维原因写成了人话，交给界面照念",
  typeof im.partialReason === "string" && im.partialReason.includes("学习成长"),
  im.partialReason,
);
rec("summary 写清了实际量了什么", im.summary.includes("重复率"), im.summary);

const longForm = facetFromContents("wechat", "微信 · 私域生活", chatContents, {
  noHeat: true,
});
rec(
  "对照：不加 profile 时，聊天文本会被「只有标题」判定误伤（这就是要修的 bug）",
  longForm && longForm.titleOnly === true && typeof longForm.values.learning !== "number",
  `titleOnly=${longForm?.titleOnly}`,
);

/* 知乎口径不能被改坏 */
const zhihuContents = Array.from({ length: 6 }, (_, i) => ({
  text: "长".repeat(200 + i * 10) + `标题化正文 ${i}`,
  heat: 120,
}));
const zf = facetFromContents("zhihu", "知乎 · 公共表达", zhihuContents);
rec(
  "长文源（默认 long-form）仍然算出 learning/creation/stability/social/autonomy",
  ["learning", "creation", "stability", "social", "autonomy"].every(
    (k) => typeof zf.values[k] === "number",
  ),
  Object.keys(zf.values).join("、"),
);
rec(
  "长文源 social 由点赞数算出（有互动量时不能缺席）",
  typeof zf.values.social === "number" && zf.values.social > 0.01,
  `social=${zf.values.social}`,
);

/* ── ⑩ 上限 ──────────────────────────────────────────────────────────── */
console.log("\n== 上限常量 ==");
rec("单文件上限 ≤ 4MB（Vercel 请求体上限 4.5MB）", IMPORT_MAX_BYTES <= 4 * 1024 * 1024, `${IMPORT_MAX_BYTES}`);

console.log("\n" + "=".repeat(80));
console.log(`合计 ${pass + fail} 项：通过 ${pass}，失败 ${fail}`);
assert.ok(fail === 0, "有失败项");
