/**
 * SBTI 人格库的查询helper（**可在客户端使用**）。
 *
 * 单独成文件的原因：`lib/persona/source-facets.ts` 里那份查询依赖 Prisma，
 * 客户端组件 import 不了。而"按代码取解读文案"这件事服务端与客户端都要做
 * （刚测完用接口返回的、刷新后用库里的），所以把纯数据查询抽出来共用。
 *
 * 数据源就是随项目带的 `lib/sbti/data/personalities.json`（25 型）。
 */

import personalities from "./data/personalities.json";

export interface SbtiPersonalityRecord {
  id: string;
  /** 人格代码，如 MONK / CTRL（注意不是 id） */
  name: string;
  /** 中文名，如 僧人 / 拿捏者 */
  title: string;
  /** 15 位等级模式，如 HHL-LLH-LLM-MML-LHM */
  pattern: string;
  /** 一句话点睛 */
  greeting?: string;
  /** 完整解读 */
  description?: string;
}

const ALL = personalities as unknown as SbtiPersonalityRecord[];

/** 全部人格（供列表/调试用） */
export const SBTI_PERSONALITIES = ALL;

/**
 * 按代码查人格记录。代码存在 `name` 字段（`id` 是编号）——
 * 这两个字段很容易搞反，实测踩过。
 */
export function findSbtiByCode(code: string | null | undefined): SbtiPersonalityRecord | null {
  if (!code) return null;
  const want = code.trim().toUpperCase();
  return ALL.find((p) => String(p.name).trim().toUpperCase() === want) ?? null;
}

/** 人格代码 → 中文名（僧人 / 拿捏者 …） */
export function sbtiTitleOf(code: string | null | undefined): string | null {
  return findSbtiByCode(code)?.title?.trim() ?? null;
}

/** 人格代码 → 一句话点睛 */
export function sbtiGreetingOf(code: string | null | undefined): string | null {
  return findSbtiByCode(code)?.greeting?.trim() ?? null;
}

/** 人格代码 → 完整解读 */
export function sbtiDescriptionOf(code: string | null | undefined): string | null {
  return findSbtiByCode(code)?.description?.trim() ?? null;
}

/** 人格代码 → 头像路径。归一化只留字母数字：`WOC!` → `WOC.webp` */
export function sbtiAvatarOf(code: string | null | undefined): string {
  const norm = String(code ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `/assets/sbti/${norm}.webp`;
}
