// Persona 完整度：按“生活私域 / 职场 / 公共 / 显性”四类来源统计覆盖，
// 而不是简单按来源数量相加（见 v2.0 §23）。

export type PersonaSourceType = "wechat" | "qq" | "feishu" | "dingtalk" | "zhihu" | "sbti";

export const SOURCE_CATEGORY: Record<PersonaSourceType, "life" | "work" | "public" | "explicit"> = {
  wechat: "life",
  qq: "life",
  feishu: "work",
  dingtalk: "work",
  zhihu: "public",
  sbti: "explicit",
};

export const CATEGORY_LABELS: Record<string, string> = {
  life: "生活私域（微信 / QQ）",
  work: "职场（飞书 / 钉钉）",
  public: "公共（知乎）",
  explicit: "显性（SBTI）",
};

export interface PersonaCompleteness {
  percent: number; // 0-100
  coveredCategories: number; // 0-4
  categories: Record<
    string,
    { covered: boolean; label: string; injected: PersonaSourceType[] }
  >;
}

export function computeCompleteness(
  sourceTypes: PersonaSourceType[],
): PersonaCompleteness {
  const injected = new Set(sourceTypes);
  const categories: PersonaCompleteness["categories"] = {
    life: { covered: false, label: CATEGORY_LABELS.life, injected: [] },
    work: { covered: false, label: CATEGORY_LABELS.work, injected: [] },
    public: { covered: false, label: CATEGORY_LABELS.public, injected: [] },
    explicit: { covered: false, label: CATEGORY_LABELS.explicit, injected: [] },
  };

  for (const type of sourceTypes) {
    const cat = SOURCE_CATEGORY[type];
    if (cat) {
      categories[cat].covered = true;
      categories[cat].injected.push(type);
    }
  }

  const coveredCategories = Object.values(categories).filter((c) => c.covered).length;
  return {
    percent: Math.round((coveredCategories / 4) * 100),
    coveredCategories,
    categories,
  };
}
