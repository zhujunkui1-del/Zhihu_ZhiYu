import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";
import { dingtalkPullDocs, feishuPullMessages, type PulledItem } from "@/lib/oauth/clients";
import { isOAuthProvider, PROVIDER_META, type OAuthProvider } from "@/lib/oauth/platforms";
import { readAccessToken } from "@/lib/oauth/store";
import { facetFromContents, interestsFromTexts } from "@/lib/persona/fusion";
import { persistSourceFacet } from "@/lib/persona/source-facets";
import { topEvidence, type ImportItem, type ImportSource } from "@/lib/import/parse";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 平台 → 人格数据源（飞书/钉钉都是一对一） */
const SOURCE_OF: Record<OAuthProvider, ImportSource> = {
  feishu: "feishu",
  dingtalk: "dingtalk",
};

const MAX_EVIDENCE_ROWS = 200;

type Params = { params: Promise<{ provider: string }> };

function json(error: string, extra: Record<string, unknown> = {}, status = 400) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/**
 * 用已授权的平台账号**自动拉取**数据（飞书消息 / 钉钉文档），写成人格证据。
 *
 * 与手动导入共用同一套落库逻辑（证据替换 + 分源解析刷新），
 * 差别只在"内容从哪来"：这里从官方 API 来，用户不用自己导文件。
 *
 * `mode` 与手动导入一致：`replace` 覆盖该源上次的数据，`append` 追加。
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    return await handle(req, params);
  } catch (e) {
    console.error("[oauth/sync] 未捕获异常", e);
    return NextResponse.json(
      { ok: false, code: "INTERNAL", error: `同步出错：${(e as Error).message}` },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest, params: Params["params"]) {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const { provider: raw } = await params;
  if (!isOAuthProvider(raw)) return json("未知平台", { code: "UNKNOWN_PROVIDER" });
  const provider: OAuthProvider = raw;
  const meta = PROVIDER_META[provider];
  const source = SOURCE_OF[provider];

  const me = await resolveIdentity();
  if (!me?.userId || !me.ownPersonaId) {
    return json("请先登录", { code: "UNAUTHENTICATED" }, 401);
  }
  /* 收窄成非空常量：后面在事务闭包里用，TS 不会保留上面的收窄 */
  const personaId: string = me.ownPersonaId;

  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "append" ? "append" : "replace";

  const auth = await readAccessToken(me.userId, provider);
  if (!auth) {
    return json(`还没有授权${meta.label}，请先点「${meta.connectLabel}」。`, {
      code: "NOT_LINKED",
    });
  }
  if (auth.expired || !auth.token) {
    return json(`${meta.label}的授权已过期，请重新点「${meta.connectLabel}」。`, {
      code: "TOKEN_EXPIRED",
    });
  }

  /* ── 拉取 ── */
  let pulled: PulledItem[] = [];
  let detail: Record<string, unknown> = {};
  try {
    if (provider === "feishu") {
      const r = await feishuPullMessages(auth.token, auth.externalId ?? "");
      pulled = r.items;
      detail = { chats: r.chats, scanned: r.scanned };
    } else {
      const r = await dingtalkPullDocs(auth.token);
      pulled = r.items;
      detail = { workspaces: r.workspaces, docs: r.docs };
    }
  } catch (e) {
    console.error(`[oauth/${provider}] 拉取失败`, e);
    return json(
      `调用${meta.label}接口失败：${(e as Error).message}。` +
        `数据没有写入。可能是授权已失效或权限不足（请确认已开通：${meta.scope}）。`,
      { code: "PULL_FAILED" },
    );
  }

  if (pulled.length === 0) {
    const why =
      provider === "feishu"
        ? "没有从你的飞书会话里读到**你自己发出**的文字消息。可能是：这些会话里你还没发过消息、或应用缺少 im:message 权限。"
        : "没有从你的钉钉里读到文档正文。可能是：你没有创建过文档、或应用缺少文档读权限。";
    return json(why, { code: "NO_CONTENT", detail, capability: meta.capability });
  }

  const items: ImportItem[] = pulled.map((p) => ({
    text: p.text,
    trait: p.trait,
    url: p.url ?? null,
  }));
  const evidenceRows = topEvidence(items, MAX_EVIDENCE_ROWS);

  /* ── 落库（与手动导入同一口径）── */
  let toAppend = evidenceRows;
  let skippedDuplicates = 0;
  if (mode === "append") {
    const existing = await prisma.personaEvidence.findMany({
      where: { personaId: personaId, source },
      select: { note: true },
    });
    const seen = new Set(existing.map((e) => (e.note ?? "").slice(0, 120)));
    toAppend = evidenceRows.filter((it) => !seen.has(it.text.slice(0, 120)));
    skippedDuplicates = evidenceRows.length - toAppend.length;
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
      if (mode === "replace") {
        await tx.personaEvidence.deleteMany({ where: { personaId: personaId, source } });
      }
      if (toAppend.length) {
        await tx.personaEvidence.createMany({
          data: toAppend.map((it) => ({
            personaId: personaId,
            source,
            trait: it.trait,
            value: it.heat ?? null,
            note: it.text.slice(0, 2000),
            url: it.url ?? null,
          })),
        });
      }
      await tx.personaSource.upsert({
        where: { personaId_type: { personaId: personaId, type: source } },
        update: {
          status: "injected",
          importedAt: new Date(),
          meta: { via: "oauth", provider, mode, ...detail } as never,
        },
        create: {
          personaId: personaId,
          type: source,
          status: "injected",
          importedAt: new Date(),
          meta: { via: "oauth", provider, mode, ...detail } as never,
        },
      });
      await tx.persona.update({
        where: { id: personaId },
        data: { interests: merged as never },
      });
    },
    { maxWait: 20000, timeout: 60000 },
  );

  /* 分源解析用该源**全部**证据重算（追加模式下不能只算本批） */
  const all = await prisma.personaEvidence.findMany({
    where: { personaId: personaId, source },
    select: { note: true },
  });
  const facet = facetFromContents(
    source,
    provider === "feishu" ? "飞书 · 职场协作" : "钉钉 · 职场沟通",
    all.map((r) => ({ text: (r.note ?? "").trim() })).filter((c) => c.text.length > 0),
    { noHeat: true, profile: "im" },
  );
  if (facet) await persistSourceFacet(personaId, facet);

  return NextResponse.json({
    ok: true,
    provider,
    mode,
    source,
    counts: { pulled: pulled.length, evidence: toAppend.length, total: all.length },
    skippedDuplicates,
    detail,
    warning:
      mode === "append"
        ? `本次是添加：上次的数据保留，现在这个源共有 ${all.length} 条证据。`
        : `本次是覆盖：该源上次的数据已被这一批替换。`,
  });
}
