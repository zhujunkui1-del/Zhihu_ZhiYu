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
import { dingtalkPullDocs, feishuPullMessages, type PulledItem } from "./clients";
import { PROVIDER_META, type OAuthProvider } from "./platforms";
import { readAccessToken } from "./store";
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
}

/** 按平台拉数据（只取本人发出的内容） */
async function pull(
  provider: OAuthProvider,
  token: string,
  externalId: string | null,
): Promise<{ items: PulledItem[]; detail: Record<string, unknown> }> {
  if (provider === "feishu") {
    const r = await feishuPullMessages(token, externalId ?? "");
    return { items: r.items, detail: { chats: r.chats, scanned: r.scanned } };
  }
  const r = await dingtalkPullDocs(token);
  return { items: r.items, detail: { workspaces: r.workspaces, docs: r.docs } };
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

  let pulled: PulledItem[];
  let detail: Record<string, unknown>;
  try {
    const r = await pull(provider, auth.token, auth.externalId);
    pulled = r.items;
    detail = r.detail;
  } catch (e) {
    throw new SyncError(
      "PULL_FAILED",
      `调用${meta.label}接口失败：${(e as Error).message}（请确认已开通 ${meta.scope}）`,
    );
  }

  if (pulled.length === 0) {
    throw new SyncError(
      "NO_CONTENT",
      provider === "feishu"
        ? "没有读到你发出的飞书消息（可能是这些会话里你还没发过话，或应用缺少 im:message 权限）"
        : "没有读到你的钉钉文档正文（可能是你没创建过文档，或应用缺少文档读权限）",
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

  return { pulled: pulled.length, written: toWrite.length, skipped, total: all.length, detail };
}
