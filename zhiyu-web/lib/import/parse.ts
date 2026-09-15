/**
 * 手动导入数据的**解析层**（纯函数，不碰数据库、不碰 Next）。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「接入数据一栏，微信、QQ、飞书、钉钉的导入数据按键点击后无交互。
 *     马上补齐功能。……现在只要实现微信、QQ 的数据手动导入，点击按钮后要能
 *     跳出用户的电脑窗口，然后让用户把 json、txt 等文件格式的产品支持的
 *     可以用于蒸馏的文件数据导入到网站上。钉钉、飞书的数据则利用 distilly
 *     的能力，或是网站自动抓取，或是用户手动提供数据就跟微信、QQ 的网页端
 *     操作一样。」
 *
 * ── 为什么解析放在这一层 ────────────────────────────────────────────────
 * 导出格式五花八门（微信/QQ 各家导出工具、飞书官方导出、distilly 采集脚本的
 * 产物），而这些差异**全是纯文本处理**。抽成纯函数后可以直接拿真实样例文件
 * 跑断言（`scripts/test-import-parse.mjs`），不必起浏览器、不必连库 ——
 * 之前吃过的亏就是"解析逻辑埋在 route 里"，只能靠手点页面验，回归一次要几分钟。
 *
 * ── 兼容性来源 ─────────────────────────────────────────────────────────
 * 飞书 / 钉钉 的格式**对齐 distilly**（`开源项目/distilly`）：
 *   · `tools/feishu_parser.py`：JSON 取 `messages|records|data` 数组，
 *     字段 `sender_name|sender|from|user_name` + `content|text|message|body`
 *     + `timestamp|create_time|time`；content 可能是嵌套对象/富文本数组；
 *     TXT 形如 `2024-01-01 10:00 张三：内容`。
 *   · `tools/dingtalk_auto_collector.py`：产出 `docs.txt` / `bitables.txt` /
 *     `messages.txt`，是带 `#`/`##`/`###` 标题与 `---` 分隔的 markdown 风格文本。
 *   · 消息分级也沿用它的口径：长消息（>50 字）= 观点/方案，权重最高；
 *     含决策关键词（同意/建议/风险…）= 决策类；其余 = 日常。
 * 所以"用 distilly 采集 → 把产物拖进网页"这条路是**逐字可用**的，
 * 不需要用户自己去转换格式。
 */

/** 可以手动导入的四个源（知乎走 OAuth、SBTI 走问卷，都不在此列） */
export const IMPORT_SOURCES = ["wechat", "qq", "feishu", "dingtalk"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export function isImportSource(s: string): s is ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(s);
}

export const IMPORT_SOURCE_LABEL: Record<ImportSource, string> = {
  wechat: "微信 · 私域生活",
  qq: "QQ · 私域表达",
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
};

/** 允许的文件扩展名（与 distilly 的"上传文件"口径一致，去掉它那边的 PDF/图片） */
export const IMPORT_EXTENSIONS = [".json", ".txt", ".md", ".csv", ".log"] as const;

/** 单文件上限。Vercel 单体函数请求体上限 4.5MB，留出 multipart 开销余量 */
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;

/** 一次解析的上限，防止超大文件把解析卡住（超出会在 warnings 里如实说明） */
const MAX_PARSE_ITEMS = 3000;

export interface ImportItem {
  text: string;
  /** 私域/职场数据没有公开互动量，所以一般不带 heat（见 noHeat 说明） */
  heat?: number;
  /** 这条证据属于哪一类（长消息 / 决策类 / 日常 / 文档），直接显示在溯源里 */
  trait: string;
  url?: string | null;
}

export interface ParseResult {
  items: ImportItem[];
  /** 过滤前读到的原始条数（用来解释"为什么只剩这么点"） */
  rawCount: number;
  /** 文件里出现的发言者（最多列 6 个，帮用户确认昵称填对了没） */
  speakers: string[];
  /** 实际用的解析路径，如实回报给用户 */
  format: string;
  /** 需要用户知道的事（没填昵称、跳过了多少条噪声…） */
  warnings: string[];
  /** 本次解析使用的昵称过滤条件 */
  selfName: string | null;
}

const NOISE = new Set([
  "[图片]",
  "[文件]",
  "[语音]",
  "[视频]",
  "[表情]",
  "[动画表情]",
  "[位置]",
  "[链接]",
  "[转账]",
  "[红包]",
  "[撤回了一条消息]",
  "[表情包]",
  "[聊天记录]",
  "[音乐]",
  "[名片]",
  "[收藏]",
  "[卡券]",
  "[小程序]",
  "[视频号]",
  "[群收款]",
  "[拍一拍]",
  "[合并转发]",
]);

/** 决策类关键词 —— 与 distilly `feishu_parser.py` 的列表保持一致 */
const DECISION_KEYWORDS = [
  "同意", "不行", "觉得", "建议", "应该", "不应该", "可以", "不可以",
  "方案", "思路", "考虑", "决定", "确认", "拒绝", "推进", "暂缓",
  "没问题", "有问题", "风险", "评估", "判断",
];

const LONG_MESSAGE_CHARS = 50;

/** 按 distilly 的口径给一条内容分类 */
function classify(text: string, fallback = "日常"): string {
  if (text.length > LONG_MESSAGE_CHARS) return "长消息";
  if (DECISION_KEYWORDS.some((k) => text.includes(k))) return "决策类";
  return fallback;
}

function isNoise(text: string): boolean {
  const t = text.trim();
  if (t.length < 2) return true;
  if (NOISE.has(t)) return true;
  /* 形如 "[图片]xxx" 或纯表情符号的消息 */
  if (/^\[[^\]]{1,8}\]$/.test(t)) return true;
  if (/^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u.test(t)) return true;
  return false;
}

/* ── 解码：UTF-8 / GBK ──────────────────────────────────────────────────── */

/**
 * 把上传文件解码成文本。
 *
 * 为什么需要这一步：微信/QQ 的导出工具在 Windows 上大量使用 **GBK**，
 * 直接按 UTF-8 读会得到满屏乱码，用户看到的是"导入了但全是问号"。
 * 浏览器的 `File.text()` 固定按 UTF-8 解码，没有退路，所以这里自己处理：
 *   ① 先按 UTF-8 **严格**解码（`fatal: true`）—— 失败说明不是 UTF-8
 *   ② 再试 GBK（Node/浏览器 ICU 都支持）
 *   ③ 都不行就按 UTF-8 有损解码，并在 warnings 里说明
 */
export function decodeBytes(buf: ArrayBuffer | Uint8Array): {
  text: string;
  encoding: string;
  warning?: string;
} {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: stripBom(t), encoding: "utf-8" };
  } catch {
    /* 不是合法 UTF-8，继续试 GBK */
  }

  try {
    const t = new TextDecoder("gbk").decode(bytes);
    return {
      text: stripBom(t),
      encoding: "gbk",
      warning: "文件不是 UTF-8，已按 GBK（GB18030）解码 —— 微信/QQ 导出常见此编码。",
    };
  } catch {
    /* 环境不支持 GBK，退回有损 UTF-8 */
    const t = new TextDecoder("utf-8").decode(bytes);
    return {
      text: stripBom(t),
      encoding: "utf-8-lossy",
      warning: "文件编码无法识别，已按 UTF-8 有损解码，可能有个别乱码字符。",
    };
  }
}

/* ── JSON 适配 ─────────────────────────────────────────────────────────── */

const SENDER_KEYS = [
  "sender_name", "senderName", "sender", "from", "fromName", "user_name", "userName",
  "talker", "nickName", "nickname", "displayName", "name", "accountName", "wxid", "uin",
];
const CONTENT_KEYS = [
  "content", "text", "message", "msg", "body", "plainText", "msgContent",
  "value", "Content", "Text",
];
const TIME_KEYS = [
  "timestamp", "create_time", "createTime", "time", "msgTime", "date", "Time",
  "sendTime", "createdAt",
];
const HEAT_KEYS = ["likeCount", "likes", "heat", "score"];

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** 把任意形态的 content 拍平成一句话（富文本数组、嵌套对象都覆盖） */
function flattenContent(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          return flattenContent(o.text ?? o.content ?? o.value ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return flattenContent(o.text ?? o.content ?? o.value ?? o.msg ?? "");
  }
  return "";
}

/**
 * 从任意 JSON 里找出"消息数组"。
 *
 * 尝试顺序参考 distilly 的 `feishu_parser.py`（messages → records → data），
 * 再补上微信/QQ 导出工具常见的容器键。
 */
function findMessageArray(root: unknown): { arr: unknown[]; path: string } | null {
  if (Array.isArray(root)) return { arr: root, path: "根数组" };
  if (!root || typeof root !== "object") return null;

  const o = root as Record<string, unknown>;
  const CANDIDATES: [string, string][] = [
    ["messages", "messages"],
    ["records", "records"],
    ["data", "data"],
    ["msgList", "msgList"],
    ["messageList", "messageList"],
    ["list", "list"],
    ["items", "items"],
    ["result", "result"],
    ["chat", "chat"],
  ];

  for (const [key, path] of CANDIDATES) {
    const v = o[key];
    if (Array.isArray(v) && v.length) return { arr: v, path };
    /* 嵌套一层：{ data: { messages: [...] } } / { chat: { messages: [...] } } */
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = findMessageArray(v);
      if (inner) return { arr: inner.arr, path: `${path}.${inner.path}` };
    }
  }

  /* 兜底：把顶层第一个"像消息数组"的数组当作消息（元素是对象且含 content/text） */
  for (const [key, v] of Object.entries(o)) {
    if (!Array.isArray(v) || !v.length) continue;
    const first = v[0];
    if (first && typeof first === "object") {
      const fo = first as Record<string, unknown>;
      if (pick(fo, CONTENT_KEYS) !== undefined) return { arr: v, path: key };
    }
  }
  return null;
}

interface RawMsg {
  sender: string;
  content: string;
  time: string;
  heat?: number;
}

function messagesFromArray(arr: unknown[]): RawMsg[] {
  const out: RawMsg[] = [];
  for (const raw of arr) {
    if (typeof raw === "string") {
      out.push({ sender: "", content: raw, time: "" });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;

    /* 有些导出把消息包在 { message: {...} } / { msg: {...} } 里 */
    const inner =
      o.message && typeof o.message === "object"
        ? (o.message as Record<string, unknown>)
        : o.msg && typeof o.msg === "object"
          ? (o.msg as Record<string, unknown>)
          : o;

    const sender = flattenContent(pick(inner, SENDER_KEYS) ?? pick(o, SENDER_KEYS));
    const content = flattenContent(pick(inner, CONTENT_KEYS) ?? pick(o, CONTENT_KEYS));
    const time = flattenContent(pick(inner, TIME_KEYS) ?? pick(o, TIME_KEYS));

    const heatRaw = pick(inner, HEAT_KEYS) ?? pick(o, HEAT_KEYS);
    const heat = typeof heatRaw === "number" && Number.isFinite(heatRaw) ? heatRaw : undefined;

    if (!content.trim()) continue;
    out.push({ sender: sender.trim(), content: content.trim(), time: time.trim(), heat });
  }
  return out;
}

/* ── TXT / MD 适配 ─────────────────────────────────────────────────────── */

/* ⚠️ 用**编号**捕获组而不是命名组：tsconfig 的 target 低于 ES2018 时
   TypeScript 会直接报 TS1503（`?<name>` 不可用）。改这里前先确认 target。 */

/**
 * 带时间戳的整行：`2024-01-01 10:00 张三：内容`（distilly feishu TXT 口径）。
 *
 * ⚠️ 两个约束都是踩过坑才加的：
 *   · 时间部分要**整体匹配**（`(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?`），
 *     不能写成 `[\s\d:]*` —— 那样 `2024-03-05 21:00:00 阿强` 这种
 *     **两行式的头部行**会被匹配成「发言人 = 21、内容 = 00:00 阿强」，
 *     于是发言人认错、昵称过滤全部失效（实测就是这么错的）。
 *   · 发言人不能以数字开头（`[^\s:：\d]`），否则上面那种时钟数字仍会被当名字。
 */
const LINE_WITH_TIME =
  /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+([^\s:：\d][^\s:：]{0,23})\s*[:：]\s*(.+)$/;
/** 只有时间+名字的一行，内容在**下一行**（QQ / TIM 导出的两行式） */
const HEADER_ONLY = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+([^\s:：]{1,24})$/;
/** 名字在前、时间在后的一行（部分微信导出工具的格式），内容在下一行 */
const NAME_THEN_TIME =
  /^([^\s:：]{1,24})\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$/;
/** `张三：内容` */
const LINE_SENDER_ONLY = /^([^\s:：]{1,24})\s*[:：]\s*(.+)$/;
/** `[2024-01-01 10:00] 张三: 内容` 或 `[2024-01-01 10:00] 内容` */
const BRACKET_TIME = /^\[([^\]]{4,30})\]\s*(.+)$/;
/** 句中标点：用来判断"括号后那截是名字还是正文" */
const SENTENCE_PUNCT = /[，。！？；、,.!?;]/;
/** markdown 标题（distilly 钉钉采集产物的章节标题） */
const MD_HEADING = /^#{1,6}\s*(.+?)\s*$/;
const BOOK_TITLE = /^《(.+)》$/;
const MD_NOISE = /^(\*{3,}|-{3,}|={3,}|`{3,}.*|>.*)$/;

interface TxtParse {
  msgs: RawMsg[];
  /** 章节标题（文档/多维表格里的《标题》），作为证据前缀 */
  sections: number;
}

/**
 * 按行解析出来的**中间结果**。
 *
 * `cand` 是"冒号前那一截" —— 它**可能**是发言人，也可能是句子的一部分
 * （"本季度重点是稳定性治理：先把告警收敛做掉"）。所以先不下结论，
 * 等整篇扫完用"名字是否反复出现"来判定（见 `messagesFromText` 的说明）。
 */
type TextEntry =
  | { t: "msg"; sender: string; content: string; time: string; section: string }
  | { t: "cand"; cand: string; rest: string; full: string; time: string; section: string };

function messagesFromText(text: string): TxtParse {
  const lines = text.split(/\r?\n/);
  const entries: TextEntry[] = [];
  let section = "";
  const sections = { n: 0 };

  /**
   * 文档模式：整篇是"分区文档"，不是聊天记录。
   *
   * 判据：出现 markdown 标题或 `《》` 章节名（distilly 的 docs.txt / bitables.txt 就是这样）。
   * 文档里**没有发言人**，冒号是句子的一部分 —— 这时绝不能按冒号拆，
   * 否则「本季度重点是稳定性治理：先把告警收敛做掉」会被拆成
   * 发言人"本季度重点是稳定性治理" + 内容"先把告警收敛做掉"，
   * **前半句直接丢掉**（实测踩过）。
   */
  const docMode = /^\s*#{1,6}\s/m.test(text) || /《.+?》/.test(text);

  let pending: { sender: string; time: string } | null = null;

  /**
   * 跳过"前言块"。
   *
   * distilly 的采集产物长这样（`docs.txt` / `messages.txt` 都一样）：
   *   `# 文档内容（钉钉自动采集）`  ← 标题
   *   `目标：张三` / `共 3 条` / `注意：钉钉 API 不支持历史消息拉取…`  ← 元信息
   *   `---`
   *   `## 《Q3 技术规划》` …         ← 正文才开始
   * 这些元信息按行解析会被当成消息（"目标：张三" 甚至会被拆出个叫"目标"的发言人）。
   * 所以从一级标题之后开始跳过，直到 `---` / `##` / 连续若干行后自动结束 ——
   * 最后那条兜底是为了防止"用户自己写的 txt 只有一个 # 标题"时把正文全跳掉。
   */
  let skipFrontMatter = false;
  let frontMatterLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const h = MD_HEADING.exec(line);
    if (h) {
      const level = (line.match(/^#+/)?.[0] ?? "#").length;
      const t = (h[1] ?? "").trim();
      const b = BOOK_TITLE.exec(t);
      const title = (b?.[1] ?? t).trim();
      if (level === 1 && !section) {
        /* 一级标题 = 文件标题，其后的元信息块要跳过 */
        section = title;
        sections.n += 1;
        skipFrontMatter = true;
        frontMatterLines = 0;
      } else {
        section = title;
        sections.n += 1;
        skipFrontMatter = false;
      }
      pending = null;
      continue;
    }

    if (skipFrontMatter) {
      if (line === "---" || line === "***" || line === "===") {
        skipFrontMatter = false;
        pending = null;
        continue;
      }
      frontMatterLines += 1;
      if (frontMatterLines > 8) skipFrontMatter = false; // 兜底：别把正文跳掉
      else continue;
    }

    if (!line) {
      pending = null;
      continue;
    }
    if (MD_NOISE.test(line)) continue;

    const b2 = BOOK_TITLE.exec(line);
    if (b2) {
      section = (b2[1] ?? "").trim();
      sections.n += 1;
      pending = null;
      continue;
    }

    /* 两行式：上一行是"时间 发言人"，这一行是内容。
       这种头部行**结构上无歧义**（整行只有时间 + 名字），直接当发言人。 */
    if (pending) {
      entries.push({ t: "msg", sender: pending.sender, content: line, time: pending.time, section });
      pending = null;
      continue;
    }

    const withTime = LINE_WITH_TIME.exec(line);
    if (withTime) {
      entries.push({
        t: "msg",
        sender: (withTime[2] ?? "").trim(),
        content: (withTime[3] ?? "").trim(),
        time: (withTime[1] ?? "").trim(),
        section,
      });
      continue;
    }

    const headerOnly = HEADER_ONLY.exec(line);
    if (headerOnly) {
      pending = {
        sender: (headerOnly[2] ?? "").trim(),
        time: (headerOnly[1] ?? "").trim(),
      };
      continue;
    }

    const nameFirst = NAME_THEN_TIME.exec(line);
    if (nameFirst) {
      pending = {
        sender: (nameFirst[1] ?? "").trim(),
        time: (nameFirst[2] ?? "").trim(),
      };
      continue;
    }

    /**
     * `[时间] 张三` 或 `[时间] 正文`。
     *
     * ⚠️ 这里**故意不按冒号拆发言人**：distilly 的钉钉采集脚本产出的就是
     * `[时间] 正文`（见 `dingtalk_auto_collector.py`），而正文经常自带冒号
     * （"注意：…"、"方案：…"）。若按冒号拆，"注意"会被当成发言人，
     * 用户一旦填了昵称过滤，这些消息就会被**静默丢掉**。
     * 所以只在"括号后那一截明显是个人名"时才当头部，其余整段都是正文。
     */
    const bracket = BRACKET_TIME.exec(line);
    if (bracket) {
      const rest = (bracket[2] ?? "").trim();
      const time = (bracket[1] ?? "").trim();
      if (rest.length <= 24 && !SENTENCE_PUNCT.test(rest) && !rest.includes("：") && !rest.includes(":")) {
        pending = { sender: rest, time };
        continue;
      }
      entries.push({ t: "msg", sender: "", content: rest, time, section });
      continue;
    }

    const senderOnly = LINE_SENDER_ONLY.exec(line);
    if (senderOnly) {
      entries.push({
        t: "cand",
        cand: (senderOnly[1] ?? "").trim(),
        rest: (senderOnly[2] ?? "").trim(),
        full: line,
        time: "",
        section,
      });
      continue;
    }

    /* 既没有时间也没有发言人：当作正文（文档段落就是这种） */
    entries.push({ t: "msg", sender: "", content: line, time: "", section });
  }

  /**
   * 第二步：把"冒号候选"落实成发言人还是正文。
   *
   * 判据（踩过两次坑才收敛到这三条）：
   *   ① **文档模式**（出现 `#` 标题或 `《》` 章节名）：绝不拆。文档里没有发言人，
   *      冒号是句子的一部分。
   *   ② 候选**长度 ≤ 8 且不含句中标点** → 像人名。整篇的候选都像人名、
   *      且不止一个候选 → 这是一份聊天记录，全部认定为发言人
   *      （聊天里有人只说过一句话是常态，不能要求他重复出现）。
   *   ③ 否则只在候选**反复出现（≥2 次）**时才认定为发言人 ——
   *      散文里的"本季度重点是稳定性治理："只出现一次。
   * 任何一步不成立就整行原样当正文：**宁可少认一个发言人，也不能把半句话吃掉**。
   * （代价：一份没有标题、又只有两行"短前缀：内容"的纯文本，
   *   可能被误当成聊天记录而拆掉前缀 —— 相比丢掉半句话，这个代价更小。）
   */
  const candCount = new Map<string, number>();
  for (const e of entries) {
    if (e.t === "cand") candCount.set(e.cand, (candCount.get(e.cand) ?? 0) + 1);
  }
  const nameLike = (s: string) => s.length <= 8 && !SENTENCE_PUNCT.test(s);
  const cands = [...candCount.keys()];
  const looksLikeChat = !docMode && cands.length >= 2 && cands.every(nameLike);

  const msgs: RawMsg[] = [];
  for (const e of entries) {
    if (e.t === "msg") {
      /* 章节前缀只加给"文档段落"（既没有发言人、也没有时间戳的行）。
         `[时间] 内容` 这类是真正的消息，加了前缀反而不好读。 */
      const isProse = !e.sender && !e.time;
      msgs.push({
        sender: e.sender,
        content: isProse && e.section ? `${e.section}：${e.content}` : e.content,
        time: e.time,
      });
      continue;
    }
    const n = candCount.get(e.cand) ?? 0;
    const confirmed = !docMode && (n >= 2 || (looksLikeChat && nameLike(e.cand)));
    if (confirmed) {
      msgs.push({ sender: e.cand, content: e.rest, time: e.time });
    } else {
      msgs.push({
        sender: "",
        content: e.section ? `${e.section}：${e.full}` : e.full,
        time: e.time,
      });
    }
  }

  return { msgs, sections: sections.n };
}

/* ── CSV 适配 ──────────────────────────────────────────────────────────── */

/** 极简 CSV：支持双引号包裹与 "" 转义（够用即可，不追求完整 RFC4180） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function messagesFromCsv(text: string): RawMsg[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const header = rows[0].map((c) => c.trim().toLowerCase());
  const findCol = (names: string[]) =>
    header.findIndex((h) => names.some((n) => h.includes(n)));

  const senderCol = findCol(["sender", "from", "talker", "nickname", "name", "发送", "昵称", "发言人"]);
  const contentCol = findCol(["content", "text", "message", "msg", "内容", "消息"]);
  const timeCol = findCol(["time", "date", "timestamp", "时间"]);

  /* 认不出表头就当作"无表头：第一列人名、第二列内容" */
  const hasHeader = contentCol >= 0 || senderCol >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  const sc = senderCol >= 0 ? senderCol : 0;
  const cc = contentCol >= 0 ? contentCol : 1;

  const out: RawMsg[] = [];
  for (const r of body) {
    const content = (r[cc] ?? "").trim();
    if (!content) continue;
    out.push({
      sender: (r[sc] ?? "").trim(),
      content,
      time: timeCol >= 0 ? (r[timeCol] ?? "").trim() : "",
    });
  }
  return out;
}

/* ── 主入口 ────────────────────────────────────────────────────────────── */

function extOf(filename: string): string {
  const m = /\.[^./\\]+$/.exec(filename.toLowerCase());
  return m ? m[0] : "";
}

export interface ParseOptions {
  /** 文件里代表"我自己"的昵称；给了就只提取这个人发的内容 */
  selfName?: string | null;
}

/**
 * 解析一个导入文件。
 *
 * @param source 目标源（决定 trait 兜底文案与提示语气）
 * @param filename 原始文件名（决定走 JSON / 文本 / CSV 哪条路）
 * @param text 已解码的文本
 */
export function parseImportFile(
  source: ImportSource,
  filename: string,
  text: string,
  opts: ParseOptions = {},
): ParseResult {
  const warnings: string[] = [];
  const selfName = (opts.selfName ?? "").trim() || null;
  const ext = extOf(filename);

  if (!text.trim()) {
    return {
      items: [],
      rawCount: 0,
      speakers: [],
      format: "空文件",
      warnings: ["文件是空的（或者解码后没有任何字符）。"],
      selfName,
    };
  }

  let msgs: RawMsg[] = [];
  let format = "";

  if (ext === ".json") {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return {
        items: [],
        rawCount: 0,
        speakers: [],
        format: "JSON 解析失败",
        warnings: [
          `这不是合法的 JSON（${(e as Error).message}）。` +
            `如果文件其实是纯文本，请把后缀改成 .txt 再导入。`,
        ],
        selfName,
      };
    }
    const found = findMessageArray(data);
    if (!found) {
      /* 只有一层对象、没有消息数组：若它本身像一条消息就当一条，否则如实报错 */
      const single = messagesFromArray([data]);
      if (single.length) {
        msgs = single;
        format = "JSON 单条对象";
        warnings.push("这个 JSON 里没有消息数组，只读到了 1 条内容 —— 请确认导出的是聊天记录文件。");
      } else {
        return {
          items: [],
          rawCount: 0,
          speakers: [],
          format: "JSON 结构不识别",
          warnings: [
            "JSON 里找不到消息数组（支持的键：messages / records / data / msgList / chat.messages）。" +
              "请确认导出的是聊天记录或文档导出文件。",
          ],
          selfName,
        };
      }
    } else {
      msgs = messagesFromArray(found.arr);
      format = `JSON · ${found.path}`;
    }
  } else if (ext === ".csv") {
    msgs = messagesFromCsv(text);
    format = "CSV";
  } else {
    const parsed = messagesFromText(text);
    msgs = parsed.msgs;
    format = parsed.sections > 0 ? "文本 · 文档/消息分区" : "文本 · 逐行";
  }

  const rawCount = msgs.length;

  /* 发言者统计（在过滤前统计，这样"昵称填错"能一眼看出来） */
  const speakerCount = new Map<string, number>();
  for (const m of msgs) {
    if (!m.sender) continue;
    speakerCount.set(m.sender, (speakerCount.get(m.sender) ?? 0) + 1);
  }
  const speakers = [...speakerCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s, n]) => `${s}（${n} 条）`);

  /* 只留"我"发的 —— 但**没有发言人的内容一律保留**。
     聊天记录里每条都有发言人，文档/段落类导出则没有（distilly 的 docs.txt
     就是纯段落）。若把"没发言人"也当成"不是我发的"过滤掉，
     用户填了昵称就会把整个文档导成空 —— 实测踩过。 */
  let filtered = msgs;
  let noiseDropped = 0;
  let senderlessKept = 0;

  if (selfName) {
    filtered = msgs.filter((m) => !m.sender || m.sender.includes(selfName));
    const dropped = rawCount - filtered.length;
    if (filtered.length === 0) {
      return {
        items: [],
        rawCount,
        speakers,
        format,
        warnings: [
          `没有找到「${selfName}」发出的内容。文件里出现的发言者是：${
            speakers.join("、") || "（没读到发言者）"
          }。请核对昵称后重试；如果这是单人文档（没有发言人），把昵称留空即可。`,
        ],
        selfName,
      };
    }
    senderlessKept = filtered.filter((m) => !m.sender).length;
    if (dropped > 0) {
      warnings.push(
        `按昵称「${selfName}」过滤：保留 ${filtered.length} 条、跳过 ${dropped} 条别人发的内容` +
          `（只蒸馏你自己说的话，避免把对方的人格算到你头上）。`,
      );
    }
    if (senderlessKept > 0) {
      warnings.push(
        `其中 ${senderlessKept} 条没有发言人（文档/段落类），已按你的内容保留 —— ` +
          `文件里没有署名时无法区分是谁写的。`,
      );
    }
  } else if (speakerCount.size > 1) {
    warnings.push(
      `文件里有 ${speakerCount.size} 个发言者，而你**没有填昵称** —— ` +
        `本次把所有人的话都当成了你的（会混入对方的特征）。` +
        `建议重新导入并在「你在文件里的昵称」里填上你自己。`,
    );
  }

  const items: ImportItem[] = [];
  let truncated = false;

  for (const m of filtered) {
    const t = m.content.trim();
    if (isNoise(t)) {
      noiseDropped += 1;
      continue;
    }
    /* ⚠️ 这里**不去重**：重复率本身是有用的人格信号
       （"在说新东西"还是"复读"），`facetFromContents` 的 im 口径要用它。
       证据表的去重与截断在 route 里做。 */
    items.push({
      text: t,
      trait: classify(t, source === "feishu" || source === "dingtalk" ? "工作记录" : "日常"),
      url: null,
      ...(m.heat != null ? { heat: m.heat } : {}),
    });
    if (items.length >= MAX_PARSE_ITEMS) {
      truncated = true;
      break;
    }
  }

  if (noiseDropped > 0) {
    warnings.push(`过滤掉 ${noiseDropped} 条噪声（图片/表情/撤回提示、过短消息）。`);
  }
  if (truncated) {
    warnings.push(`文件内容很多，本次只取前 ${MAX_PARSE_ITEMS} 条用于解析。`);
  }
  if (items.length === 0) {
    warnings.push(
      "过滤之后没有剩下任何可用内容 —— 这个文件里可能只有图片/表情/系统提示。" +
        "请换一个包含文字消息的导出文件。",
    );
  }

  /* 证据表里只放最有信息量的那些（长消息 > 决策类 > 日常），
     与 distilly 的权重口径一致；分源解析仍然用**全部**内容计算。 */
  const TIER: Record<string, number> = { 长消息: 0, 文档: 0, 工作记录: 1, 决策类: 1 };
  items.sort((a, b) => {
    const ta = TIER[a.trait] ?? 2;
    const tb = TIER[b.trait] ?? 2;
    if (ta !== tb) return ta - tb;
    return b.text.length - a.text.length;
  });

  return { items, rawCount, speakers, format, warnings, selfName };
}

/**
 * 给证据表挑前 N 条：按信息量排序（长消息 > 决策/工作记录 > 日常），
 * 并**在这里去重** —— 分源解析需要重复率（见上），但证据表里放 20 条
 * 一样的"收到"没有意义。
 */
export function topEvidence(items: ImportItem[], n = 200): ImportItem[] {
  const seen = new Set<string>();
  const unique: ImportItem[] = [];
  for (const it of items) {
    const key = it.text.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  return unique.slice(0, n);
}
