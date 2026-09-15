/**
 * 平台授权（飞书 / 钉钉）的**能力声明与配置**。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「你不是老早就确认过 distilly 有自动化协助用户调取飞书、钉钉数据的功能吗，
 *     现在你就放个"导入飞书、钉钉数据"让用户自己手动导入是什么意思？！
 *     你要引导用户允许授权网站使用他们的飞书、钉钉账号的数据呀。」
 *
 * ── 为什么不能"照抄 distilly 就完事"────────────────────────────────────
 * distilly 的采集脚本有两种取数方式，**都不是网页能直接用的**：
 *   ① 本机浏览器登录态（`feishu_browser.py` / 钉钉消息采集用 playwright 打开
 *      你自己电脑上的 Chrome）—— 需要一台常驻的机器，而本产品是 Vercel 单体，
 *      服务端没有浏览器、也没有常驻进程。
 *   ② 应用凭证 + 用户 OAuth（`feishu_auto_collector.py` 的 user_access_token、
 *      钉钉的 appKey/appSecret）—— **这条网页端能走**，前提是有人先在平台上
 *      注册一个应用并把凭证配到环境变量里。
 *
 * 所以本模块做的事就是：把第 ② 条真正接起来 —— 引导用户授权 → 拿 token →
 * 服务端调官方 API 拉数据。同时**如实声明每个平台拉得到什么、拉不到什么**：
 * 钉钉的开放平台**根本不提供历史消息接口**（distilly 的注释里也写着这一点，
 * 它因此退回浏览器抓取），所以钉钉只能自动拉文档 / 多维表格，
 * 消息记录只能手动导入 —— 这不是偷懒，是平台限制。
 */

export type OAuthProvider = "feishu" | "dingtalk";

export const OAUTH_PROVIDERS: OAuthProvider[] = ["feishu", "dingtalk"];

export function isOAuthProvider(v: string): v is OAuthProvider {
  return (OAUTH_PROVIDERS as string[]).includes(v);
}

/** 平台能力声明 —— 界面照这个念，不夸大也不隐瞒 */
export interface ProviderCapability {
  /** 授权后**能**自动拉到的数据 */
  canPull: string[];
  /** 授权也**拉不到**的，以及原因（必须展示给用户，否则等于骗他授权） */
  cannotPull: { what: string; why: string }[];
}

export interface ProviderMeta {
  provider: OAuthProvider;
  /** 界面上的平台名 */
  label: string;
  /** 授权按钮文案 */
  connectLabel: string;
  /** 一句话说明授权后网站会读什么 */
  summary: string;
  capability: ProviderCapability;
  /** 需要在平台开放平台做的准备工作（逐条展示给用户） */
  setupSteps: string[];
  /** 需要配置的环境变量名 */
  envKeys: { appId: string; appSecret: string; redirectUri: string };
  /** 申请入口 */
  consoleUrl: string;
  /** 该平台 OAuth 要求的 scope（写在这里便于对照平台后台配置） */
  scope: string;
}

export const PROVIDER_META: Record<OAuthProvider, ProviderMeta> = {
  feishu: {
    provider: "feishu",
    label: "飞书",
    connectLabel: "授权飞书并同步",
    summary: "授权后，网站会以你自己的身份读取你的飞书群聊消息与云文档，用于生成你的人格画像。",
    capability: {
      canPull: [
        "你所在**群聊**里你发出的消息",
        "你的飞书文档与 Wiki 正文",
        "你的多维表格记录",
      ],
      cannotPull: [
        {
          what: "**私聊**消息",
          why:
            "飞书没有「列出我的私聊」接口 —— `GET /im/v1/chats` 只返回群聊，这是平台限制。distilly 的办法是「向对方发一条消息、从返回值里取 chat_id」，那会在对方聊天框里留痕，属于打扰行为，本站不擅自做。",
        },
      ],
    },
    setupSteps: [
      "打开飞书开放平台 → 开发者后台 → 创建「企业自建应用」",
      "在「权限管理」里开通下面列出的权限（消息 / 云文档 / 多维表格）",
      "在「安全设置 → 重定向 URL」里加入本站回调地址（下方有确切值）",
      "回到本页把 App ID / App Secret 粘进向导第 3 步即可",
    ],
    envKeys: {
      appId: "FEISHU_APP_ID",
      appSecret: "FEISHU_APP_SECRET",
      redirectUri: "FEISHU_OAUTH_REDIRECT_URI",
    },
    consoleUrl: "https://open.feishu.cn/app",
    scope:
      "im:message im:chat search:message docx:document:readonly wiki:wiki:readonly bitable:app:readonly",
  },
  dingtalk: {
    provider: "dingtalk",
    label: "钉钉",
    connectLabel: "授权钉钉并同步",
    summary:
      "授权后，网站会以你自己的身份读取你的钉钉文档与多维表格，用于生成你的人格画像。",
    capability: {
      canPull: ["你创建的钉钉文档（知识库 / 团队空间里的文件）", "多维表格（字段与记录）"],
      cannotPull: [
        {
          what: "钉钉聊天消息",
          why:
            "钉钉开放平台不提供历史消息拉取接口（官方限制）。distilly 的采集脚本也因此退回浏览器抓取 —— 那需要你本机的登录态，网站服务端做不到。消息记录请用下方的「手动导入」（可用 distilly 在本机采集后把 messages.txt 传上来）。",
        },
      ],
    },
    setupSteps: [
      "打开钉钉开放平台 → 应用开发 → 创建「企业内部应用」",
      "在「权限管理」里开通：文档（Document）、多维表格（Bitable）相关读权限",
      "在「登录与分享 → 回调域名」里加入本站回调地址（下方有确切值）",
      "把 AppKey / AppSecret 填进 Vercel 环境变量：DINGTALK_APP_KEY / DINGTALK_APP_SECRET / DINGTALK_OAUTH_REDIRECT_URI",
      "回到本页点「授权钉钉并同步」，在钉钉页面扫码同意即可",
    ],
    envKeys: {
      appId: "DINGTALK_APP_KEY",
    appSecret: "DINGTALK_APP_SECRET",
      redirectUri: "DINGTALK_OAUTH_REDIRECT_URI",
    },
    consoleUrl: "https://open-dev.dingtalk.com",
    scope: "openid",
  },
};

export interface ProviderEnv {
  provider: OAuthProvider;
  appId: string;
  appSecret: string;
  redirectUri: string;
}

/** 从环境变量读某个平台的配置（读不到就是"还没配置"，界面要显示配置指引） */
export function readProviderEnv(provider: OAuthProvider): ProviderEnv | null {
  const meta = PROVIDER_META[provider];
  const appId = (process.env[meta.envKeys.appId] ?? "").trim();
  const appSecret = (process.env[meta.envKeys.appSecret] ?? "").trim();
  const redirectUri = (process.env[meta.envKeys.redirectUri] ?? "").trim();
  if (!appId || !appSecret || !redirectUri) return null;
  return { provider, appId, appSecret, redirectUri };
}

/** 只判有没有配好，不返回任何秘密 —— 供界面查询（绝不把 secret 送到前端） */
export function providerConfigStatus(): Record<
  OAuthProvider,
  { configured: boolean; redirectUri: string; envKeys: { appId: string; appSecret: string; redirectUri: string } }
> {
  const out = {} as Record<
    OAuthProvider,
    { configured: boolean; redirectUri: string; envKeys: ProviderMeta["envKeys"] }
  >;
  for (const p of OAUTH_PROVIDERS) {
    const env = readProviderEnv(p);
    out[p] = {
      configured: env !== null,
      /* 回调地址不是秘密，展示出来用户才能照着填进平台后台 */
      redirectUri: env?.redirectUri ?? "",
      envKeys: PROVIDER_META[p].envKeys,
    };
  }
  return out;
}

/** OAuth 授权页地址（state 由调用方生成并落库） */
export function buildAuthorizeUrl(provider: OAuthProvider, env: ProviderEnv, state: string): string {
  if (provider === "feishu") {
    const u = new URL("https://open.feishu.cn/open-apis/authen/v1/authorize");
    u.searchParams.set("app_id", env.appId);
    u.searchParams.set("redirect_uri", env.redirectUri);
    u.searchParams.set("scope", PROVIDER_META.feishu.scope);
    u.searchParams.set("state", state);
    return u.toString();
  }
  const u = new URL("https://login.dingtalk.com/oauth2/auth");
  u.searchParams.set("redirect_uri", env.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.appId);
  u.searchParams.set("scope", PROVIDER_META.dingtalk.scope);
  u.searchParams.set("state", state);
  /* prompt=consent 每次显式展示授权页，避免静默通过导致用户不知道被读了什么 */
  u.searchParams.set("prompt", "consent");
  return u.toString();
}
