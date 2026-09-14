/**
 * 弹窗人格卡的数据契约。
 *
 * 为什么单独成文件：这个结构被**三处**共用 —— 服务端接口
 * （`app/api/persona/[id]/route.ts`）、弹窗组件、以及将来的页面复用。
 * 放在组件文件里会让服务端 import 客户端模块，放在接口文件里则相反。
 */

export interface CardAxis {
  key: string;
  label: string;
  /** null = 该维度还没有数据 */
  value: number | null;
}

export interface CardSource {
  type: string;
  label: string;
  status: string;
  injected: boolean;
  importedAt: string | null;
}

export interface CardSbti {
  codes?: string;
  type?: string;
  typeTitle?: string;
  similarity?: number;
  fallback?: boolean;
}

export interface CardEvidence {
  id: string;
  /** 来源：zhihu / sbti / distill … */
  source: string;
  /** 这条支撑的是哪个特征（兴趣 / 沟通风格 …） */
  trait: string;
  value: number | null;
  note: string | null;
  /** 原始内容链接，用来"点回原文核对" */
  url: string | null;
}

export interface PersonaCardData {
  id: string;
  displayName: string;
  kind: string;
  bio: string | null;
  completeness: number;
  coveredCategories: number;
  stage: string;
  sbti: CardSbti | null;
  axes: CardAxis[];
  /**
   * 五轴来源（必须如实展示）：
   *   self-report = 本人 SBTI 自评　observed = 公开内容观察推断　none = 无依据
   */
  axesSource: "self-report" | "observed" | "none";
  sources: CardSource[];
  traits: {
    interests: string[];
    topics: string[];
    communicationStyle: string[];
    thinkingStyle: string[];
    socialStyle: string[];
    /** 六维价值观，0~1 */
    values: Record<string, number>;
  };
  identity: {
    avatarUrl: string | null;
    headline: string | null;
  };
  region: { province: string | null; city: string | null };
  /** 知乎 urlToken，用于拼公开主页链接 */
  zhihuUrlToken: string | null;
  evidence: CardEvidence[];
}

/** 六源的展示名（与人格页保持一致） */
export const SOURCE_LABEL: Record<string, string> = {
  zhihu: "知乎 · 公共表达",
  wechat: "微信 · 私域生活",
  qq: "QQ · 私域表达",
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
  sbti: "SBTI · 显性自评",
};

export const SOURCE_SUB: Record<string, string> = {
  zhihu: "Observed · 公开内容推断",
  wechat: "Observed · 本地聊天分析",
  qq: "Observed · 本地群聊分析",
  feishu: "Observed · 官方 API / 文档",
  dingtalk: "Observed · 文档 API / 消息上传",
  sbti: "Self-reported · 你眼中的自己",
};

/** 价值观六维的中文名 */
export const VALUE_LABEL: Record<string, string> = {
  learning: "学习成长",
  creation: "创造表达",
  career: "事业成就",
  social: "社交连接",
  stability: "稳定安全",
  autonomy: "独立自主",
};

/** 证据来源的展示名 */
export const EVIDENCE_SOURCE_LABEL: Record<string, string> = {
  zhihu: "知乎公开内容",
  sbti: "SBTI 自评",
  distill: "Agent 蒸馏",
  profile: "公开资料",
  wechat: "微信",
  qq: "QQ",
  feishu: "飞书",
  dingtalk: "钉钉",
};
