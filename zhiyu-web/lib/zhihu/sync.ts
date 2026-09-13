/**
 * 把知乎公开数据融进 Persona。
 *
 * 这是「知乎 · 公共表达」这一源的**真实实现** ——
 * 在此之前 `personaSource(status: "injected")` 是硬写的，没有真的读过数据。
 *
 * 做法：拉用户的创作 / 关注 / 收藏 → 抽出可比较的标签与文本 →
 * 合并进 Persona 的 interests / topics（**并集，不覆盖用户已有数据**），
 * 同时写入 PersonaEvidence 保留出处（这是"可解释性"的基础）。
 */

import { prisma } from "@/lib/db";
import {
  fetchContents,
  fetchFollowees,
  fetchFavlists,
  fetchFavlistContents,
  type ZhihuContentItem,
} from "@/lib/zhihu/user-api";

export interface SyncResult {
  ok: boolean;
  /** 各接口取到的条数 */
  counts: { contents: number; followees: number; favlists: number; favlistContents: number };
  /** 新加入 interests 的标签 */
  addedInterests: string[];
  /** 新加入 topics 的标签 */
  addedTopics: string[];
  /** 命中的接口（失败的不阻断整体） */
  errors: string[];
  /** 取到的创作原文（用于页面展示"读过什么"） */
  samples: { title: string; url: string; likes: number; type: string }[];
}

/** 从创作内容里抽标签：优先用标题/摘要里的关键词，其次用内容类型 */
function tagsFromContents(items: ZhihuContentItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    /* 标题里常带话题，如「#知乎黑客松」 */
    for (const m of it.title.matchAll(/#([^#\s]{2,20})#/g)) out.push(m[1]);
    const t = it.title.trim();
    if (t && t.length <= 24) out.push(t);
  }
  return out;
}

export async function syncZhihuToPersona(params: {
  personaId: string;
  accessSecret: string;
  /** 代表某个已授权用户访问时要传 */
  oauthToken?: string | null;
}): Promise<SyncResult> {
  const { personaId, accessSecret, oauthToken } = params;
  const opts = { accessSecret, oauthToken: oauthToken ?? undefined };

  const errors: string[] = [];
  let contents: ZhihuContentItem[] = [];
  let followees: { name: string; headline: string }[] = [];
  let favlists: { title: string; urlToken: string }[] = [];
  let favlistContents: Record<string, unknown>[] = [];

  /* 五个接口互相独立：任何一个失败都不该让整次同步失败，
     但要如实记进 errors（页面据此提示"部分来源没取到"）。 */
  try {
    contents = await fetchContents(opts, 20, "like_count");
  } catch (e) {
    errors.push(`创作：${(e as Error).message}`);
  }
  try {
    followees = await fetchFollowees(opts, 20);
  } catch (e) {
    errors.push(`关注：${(e as Error).message}`);
  }
  try {
    favlists = await fetchFavlists(opts, 10);
  } catch (e) {
    errors.push(`收藏夹：${(e as Error).message}`);
  }
  /* 收藏内容依赖第一条收藏夹的 UrlToken（官方说明）；
     没有收藏夹算空数据，不算失败。 */
  if (favlists[0]?.urlToken) {
    try {
      favlistContents = await fetchFavlistContents(opts, favlists[0].urlToken, 20);
    } catch (e) {
      errors.push(`收藏内容：${(e as Error).message}`);
    }
  }

  /* ── 抽标签 ── */
  const newInterests = new Set<string>();
  for (const t of tagsFromContents(contents)) newInterests.add(t);
  for (const f of followees) if (f.name) newInterests.add(f.name);
  for (const fl of favlists) if (fl.title) newInterests.add(fl.title);

  const newTopics = new Set<string>();
  /* 内容类型是很可靠的"表达方式"信号 */
  for (const it of contents) {
    const label: Record<string, string> = {
      answer: "知乎问答",
      article: "长文写作",
      zvideo: "视频表达",
      pin: "想法短评",
      question: "提问",
    };
    if (label[it.contentType]) newTopics.add(label[it.contentType]);
  }
  for (const f of followees) if (f.headline) newTopics.add(f.headline.slice(0, 20));

  /* ── 合并进 Persona（并集，不覆盖） ── */
  const persona = await prisma.persona.findUnique({ where: { id: personaId } });
  if (!persona) throw new Error("Persona 不存在");

  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const oldInterests = asArr(persona.interests);
  const oldTopics = asArr(persona.topics);
  const mergedInterests = [...new Set([...oldInterests, ...newInterests])].slice(0, 40);
  const mergedTopics = [...new Set([...oldTopics, ...newTopics])].slice(0, 40);

  const addedInterests = mergedInterests.filter((x) => !oldInterests.includes(x));
  const addedTopics = mergedTopics.filter((x) => !oldTopics.includes(x));

  await prisma.$transaction(async (tx) => {
    await tx.persona.update({
      where: { id: personaId },
      data: {
        interests: mergedInterests as never,
        topics: mergedTopics as never,
      },
    });

    /* 出处：每条创作作为一条证据，这样"为什么认为你对这些感兴趣"可追溯 */
    for (const it of contents.slice(0, 20)) {
      await tx.personaEvidence.create({
        data: {
          personaId,
          source: "zhihu",
          trait: it.contentType || "content",
          value: it.likeCount,
          note: it.title.slice(0, 200),
          url: it.url || null,
        },
      });
    }

    /* 标记该源已注入 */
    await tx.personaSource.upsert({
      where: { personaId_type: { personaId, type: "zhihu" } },
      update: { status: "injected", importedAt: new Date() },
      create: {
        personaId,
        type: "zhihu",
        status: "injected",
        importedAt: new Date(),
        meta: {
          contents: contents.length,
          followees: followees.length,
          favlists: favlists.length,
          favlistContents: favlistContents.length,
        } as never,
      },
    });
  });

  return {
    ok: true,
    counts: {
      contents: contents.length,
      followees: followees.length,
      favlists: favlists.length,
      favlistContents: favlistContents.length,
    },
    addedInterests,
    addedTopics,
    errors,
    samples: contents.slice(0, 5).map((c) => ({
      title: c.title,
      url: c.url,
      likes: c.likeCount,
      type: c.contentType,
    })),
  };
}
