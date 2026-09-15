/**
 * 「同步数据」的共用实现：拉平台数据 → 写成人格证据 → 刷新分源解析。
 *
 * 两个调用方共用它，所以抽出来：
 *   · `POST /api/oauth/[provider]/sync` —— 用户点「同步数据」按钮
 *   · `GET  /api/oauth/[provider]/callback` —— 授权回来**自动**同步（用户不用再点）
 * 各写一份的话，两条路径的落库口径迟早会飘。
 *
 * 写入方式固定为 **append（只加不删）**：用户明确要求同步是"添加功能，
 * 只加不删不覆盖"。要清空请用「手动导入」里的覆盖，或先把源清掉。
 */

import { prisma } from "@/lib/db";
import {
  dingtalkFetchUserInfo,
  dingtalkPullDocs,
  feishuFetchUserInfo,
  feishuPullDocs,
  feishuPullMessages,
  type PulledItem,
} from "./clients";
import { PROVIDER_META, type OAuthProvider } from "./platforms";
import { readAccessToken, readP2pChatIds } from "./store";
import { facetFromContents, interestsFromTexts } from "@/lib/persona/fusion";
import { persistSourceFacet } from "@/lib/persona/source-facets";
import { topEvidence, type ImportItem, type ImportSource } from "@/lib/import/parse";

const SOURCE_OF: Record<OAuthProvider, ImportSource> = {
  feishu: "feishu",
  dingtalk: "dingtalk",
};

const LABEL_OF: Record<OAuthProvider, string> = {
  feishu: "飞书 · 职场协作",
  dingtalk: "钉钉 · 职场沟通",
};

const MAX_EVIDENCE_ROWS = 200;

export class SyncError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SyncResult {
  pulled: number;
  written: number;
  /** 本次跳过多少条"库里已经有的一模一样的内容" */
  skipped: number;
  /** 该源现有证据总数 */
  total: number;
  detail: Record<string, unknown>;
  /** 没拉到的那几步的原因（如权限未开通） */
  warnings: string[];
}

/**
 * 按平台分步拉数据（只取本人发出的内容）。
 *
 * ⚠️ **每一步单独 try/catch**：飞书有 4 类数据（群聊/私聊消息、文档、Wiki、表格），
 * 各有各的权限。某一步因为某个权限没开会**抛错**（见 clients.ts 的 assertOk）。
 * 之前是整体 try/catch —— 一个权限缺失就把整次同步判死，其它步本来能拿到的数据
 * 也一起丢了，而且用户只看到一句笼统的"没有读到内容"。
 * 现在改成：**能拿的先拿，拿不到的如实列出来**。
 */
async function pull(
  provider: OAuthProvider,
  token: string,
  externalId: string | null,
  displayName: string | null,
  p2pChatIds: string[],
): Promise<{ items: PulledItem[]; detail: Record<string, unknown>; warnings: string[] }> {
  const warnings: string[] = [];

  if (provider === "feishu") {
    const detail: Record<string, unknown> = {};
    const items: PulledItem[] = [];

    /* ① 消息：群聊（/im/v1/chats）+ 用户提供了 ID 的私聊 */
    try {
      const msgs = await feishuPullMessages(token, externalId ?? "", { extraChatIds: p2pChatIds });
      items.push(...msgs.items);
      Object.assign(detail, {
        chats: msgs.chats,
        p2p: msgs.p2p,
        scanned: msgs.scanned,
        messages: msgs.items.length,
      });
    } catch (e) {
      warnings.push(`消息没拉到：${(e as Error).message}`);
      Object.assign(detail, { messages: 0 });
    }

    /* ② 云文档：文档 / Wiki / 多维表格 —— 调用链与 distilly 一致 */
    try {
      const docs = await feishuPullDocs(token, externalId ?? "", displayName ?? "");
      items.push(...docs.items);
      Object.assign(detail, {
        docs: docs.docs,
        docsFound: docs.found,
        docChunks: docs.items.length,
      });
    } catch (e) {
      warnings.push(`云文档没拉到：${(e as Error).message}`);
      Object.assign(detail, { docs: 0, docsFound: 0, docChunks: 0 });
    }

    return { items, detail, warnings };
  }

  const r = await dingtalkPullDocs(token, { keyword: displayName ?? "" });
  return {
    items: r.items,
    detail: { workspaces: r.workspaces, docs: r.docs, bitables: r.bitables },
    warnings: r.warnings,
  };
}

/**
 * 执行一次同步。
 *
 * @throws SyncError（未授权 / 授权过期 / 平台接口失败 / 没读到内容）
 */
export async function syncProvider(
  userId: string,
  personaId: string,
  provider: OAuthProvider,
  mode: "replace" | "append" = "append",
): Promise<SyncResult> {
  const meta = PROVIDER_META[provider];
  const source = SOURCE_OF[provider];

  if (!personaId) throw new SyncError("NO_PERSONA", "找不到你的人格");

  const auth = await readAccessToken(userId, provider);
  if (!auth) {
    throw new SyncError("NOT_LINKED", `还没有授权${meta.label}`);
  }
  if (auth.expired || !auth.token) {
    throw new SyncError("TOKEN_EXPIRED", `${meta.label}的授权已过期，请重新授权`);
  }

  /**
   * 自愈：早期授权时没存下 open_id / 昵称（那时还没接 `user_info` 那一步），
   * 而拉消息要靠 open_id 判断"哪条是我发的"、搜文档要用昵称当关键词。
   * 这里用已有的 token 补一次并回写 —— 用户**不需要重新授权**。
   */
  let externalId = auth.externalId;
  let displayName = auth.displayName;
  if (!externalId || !displayName) {
    try {
      const u =
        provider === "feishu"
          ? await feishuFetchUserInfo(auth.token)
          : await dingtalkFetchUserInfo(auth.token);
      externalId = externalId ?? u.openId;
      displayName = displayName ?? u.name;
      if (externalId || displayName) {
        await prisma.linkedAccount.updateMany({
          where: { userId, provider },
          data: { externalId, displayName },
        });
      }
    } catch {
      /* 补不到就按没有处理：下面会给出可读的失败原因，而不是静默读到 0 条 */
    }
  }

  if (provider === "feishu" && !externalId) {
    throw new SyncError(
      "NO_OPEN_ID",
      "拿不到你在飞书的 open_id（无法区分哪些消息是你发的）。请重新授权一次。",
    );
  }

  /* 用户手工提供的私聊会话 ID（飞书专属；没有就是空数组） */
  const p2pChatIds = await readP2pChatIds(userId, provider);

  let pulled: PulledItem[];
  let detail: Record<string, unknown>;
  let warnings: string[];
  try {
    const r = await pull(provider, auth.token, externalId, displayName, p2pChatIds);
    pulled = r.items;
    detail = r.detail;
    warnings = r.warnings;
  } catch (e) {
    throw new SyncError(
      "PULL_FAILED",
      `调用${meta.label}接口失败：${(e as Error).message}（需要权限：${meta.scope}）`,
    );
  }

  /**
   * 一条都没拿到 → 不写库、不标"已注入"（那是诚实的：确实没数据）。
   * 但**原因必须说清楚**：把分步收集到的报错原样带出去，
   * 而不是给一句"可能是你还没发过话"这种推测 —— 用户按那句话无从下手。
   */
  if (pulled.length === 0) {
    const base =
      provider === "feishu"
        ? "没有读到你的飞书数据。"
        : "没有读到你的钉钉数据（文档 / 多维表格）。";
    throw new SyncError(
      "NO_CONTENT",
      base + (warnings.length ? warnings.join("；") : "接口都调通了，但确实没有任何内容可拉。"),
    );
  }

  const items: ImportItem[] = pulled.map((p) => ({
    text: p.text,
    trait: p.trait,
    url: p.url ?? null,
  }));
  const evidenceRows = topEvidence(items, MAX_EVIDENCE_ROWS);

  /* append：跳过库里已有的一模一样的内容（重复同步不会堆垃圾） */
  let toWrite = evidenceRows;
  let skipped = 0;
  if (mode === "append") {
    const existing = await prisma.personaEvidence.findMany({
      where: { personaId, source },
      select: { note: true },
    });
    const seen = new Set(existing.map((e) => (e.note ?? "").slice(0, 120)));
    toWrite = evidenceRows.filter((it) => !seen.has(it.text.slice(0, 120)));
    skipped = evidenceRows.length - toWrite.length;
  }

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { interests: true },
  });
  const detected = interestsFromTexts(items.map((i) => i.text));
  const old = Array.isArray(persona?.interests)
    ? (persona.interests as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const merged = [...new Set([...old, ...detected])].slice(0, 40);

  await prisma.$transaction(
    async (tx) => {
      if (mode === "replace" && toWrite.length) {
        await tx.personaEvidence.deleteMany({ where: { personaId, source } });
      }
      if (toWrite.length) {
        await tx.personaEvidence.createMany({
          data: toWrite.map((it) => ({
            personaId,
            source,
            trait: it.trait,
            value: it.heat ?? null,
            note: it.text.slice(0, 2000),
            url: it.url ?? null,
          })),
        });
      }
      await tx.personaSource.upsert({
        where: { personaId_type: { personaId, type: source } },
        update: {
          status: "injected",
          importedAt: new Date(),
          meta: { via: "oauth", provider, mode, ...detail } as never,
        },
        create: {
          personaId,
          type: source,
          status: "injected",
          importedAt: new Date(),
          meta: { via: "oauth", provider, mode, ...detail } as never,
        },
      });
      await tx.persona.update({ where: { id: personaId }, data: { interests: merged as never } });
    },
    { maxWait: 20000, timeout: 60000 },
  );

  /* 分源解析用该源**全部**证据重算（只算本批会"忘掉"以前同步过的） */
  const all = await prisma.personaEvidence.findMany({
    where: { personaId, source },
    select: { note: true },
  });
  const facet = facetFromContents(
    source,
    LABEL_OF[provider],
    all.map((r) => ({ text: (r.note ?? "").trim() })).filter((c) => c.text.length > 0),
    { noHeat: true, profile: "im" },
  );
  if (facet) await persistSourceFacet(personaId, facet);

  return {
    pulled: pulled.length,
    written: toWrite.length,
    skipped,
    total: all.length,
    detail,
    /** 有哪一步没拉到（权限缺失等）—— 界面要如实显示，不能因为"部分成功"就闭嘴 */
    warnings,
  };
}
