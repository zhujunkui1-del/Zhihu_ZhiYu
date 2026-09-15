import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfCrossSite } from "@/lib/auth/csrf";
import { resolveIdentity } from "@/lib/auth/current-user";
import {
  IMPORT_EXTENSIONS,
  IMPORT_MAX_BYTES,
  IMPORT_SOURCE_LABEL,
  decodeBytes,
  isImportSource,
  parseImportFile,
  topEvidence,
  type ImportSource,
} from "@/lib/import/parse";
import { facetFromContents, interestsFromTexts } from "@/lib/persona/fusion";
import { persistSourceFacet } from "@/lib/persona/source-facets";

export const dynamic = "force-dynamic";
/** 解析大文件可能超过默认 10s（Vercel Hobby 上限 60s） */
export const maxDuration = 60;

/** 证据表里最多写多少条（解析仍用全部内容，见 lib/import/parse.ts） */
const MAX_EVIDENCE_ROWS = 200;

function bad(error: string, extra: Record<string, unknown> = {}, status = 400) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/**
 * 手动导入数据（微信 / QQ / 飞书 / 钉钉）。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「接入数据一栏，微信、QQ、飞书、钉钉的导入数据按键点击后无交互。
 *     马上补齐功能。……现在只要实现微信、QQ 的数据手动导入，点击按钮后要能
 *     跳出用户的电脑窗口，然后让用户把 json、txt 等文件格式的产品支持的
 *     可以用于蒸馏的文件数据导入到网站上。」
 *
 * ── 为什么是"上传文件"而不是"网页授权自动抓取"─────────────────────────
 * 知乎能自动同步是因为它有开放平台 OAuth；微信/QQ 没有可用的官方导出接口，
 * 飞书/钉钉的自动采集（distilly 的 `*_auto_collector.py`）依赖**本机浏览器
 * 登录态 + Python 脚本**，而本产品是 Vercel 单体、没有常驻进程，
 * 服务端跑不了这类采集。所以这四源走手动导入 —— 这也是需求里明确给的路径
 * （"或是用户手动提供数据就跟微信、QQ 的网页端操作一样"）。
 * 飞书/钉钉的**文件格式与 distilly 采集脚本的产物完全对齐**，
 * 用户直接用 distilly 采完把文件拖进来即可，见 lib/import/parse.ts 的说明。
 *
 * ── 安全与边界 ─────────────────────────────────────────────────────────
 *   · 只能导入到**自己**的人格（越权保护，与 SBTI 提交一致）
 *   · CSRF 同源校验
 *   · 扩展名白名单 + 单文件 4MB 上限（Vercel 请求体上限 4.5MB）
 *   · 重新导入会**替换**该源的旧证据，不累加 —— 文件才是该源的事实来源
 */
export async function POST(req: NextRequest) {
  /**
   * 整个流程包一层。
   *
   * 为什么必须包：Next 在 route handler 抛未捕获异常时会回一个
   * **空响应体**的 500，前端 `res.json()` 只能报
   * "Unexpected end of JSON input" —— 用户完全不知道发生了什么
   * （真实案例：事务超时那次，页面上就只有这行英文）。
   * 只要还活着，就一定要回一个带人话原因的 JSON。
   */
  try {
    return await handleImport(req);
  } catch (e) {
    const err = e as Error;
    console.error("[import] 未捕获异常", err);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        error:
          `服务器处理这个文件时出错了：${err.message}。` +
          `数据**没有**写入或者已完整回滚，可以重试；若反复失败请把这个文件的情况反馈给我们。`,
      },
      { status: 500 },
    );
  }
}

async function handleImport(req: NextRequest): Promise<NextResponse> {
  const blocked = denyIfCrossSite(req);
  if (blocked) return blocked;

  const me = await resolveIdentity();
  if (!me?.ownPersonaId) {
    return bad("请先登录后再导入数据", { code: "UNAUTHENTICATED" }, 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("请求不是合法的文件上传（multipart/form-data）。");
  }

  const sourceRaw = String(form.get("source") ?? "");
  if (!isImportSource(sourceRaw)) {
    return bad(`不支持的数据源：${sourceRaw || "（空）"}`, { code: "BAD_SOURCE" });
  }
  const source: ImportSource = sourceRaw;

  const file = form.get("file");
  if (!(file instanceof File)) {
    return bad("没有收到文件。", { code: "NO_FILE" });
  }

  const name = file.name || "未命名文件";
  const ext = (/\.[^./\\]+$/.exec(name.toLowerCase())?.[0] ?? "") as string;
  if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
    return bad(
      `不支持的文件格式「${ext || "无扩展名"}」。` +
        `目前支持：${IMPORT_EXTENSIONS.join(" / ")}。`,
      { code: "BAD_EXT" },
    );
  }
  if (file.size === 0) return bad("文件是空的。", { code: "EMPTY_FILE" });
  if (file.size > IMPORT_MAX_BYTES) {
    return bad(
      `文件 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过上限 ` +
        `${IMPORT_MAX_BYTES / 1024 / 1024}MB。请拆分后再导入（例如按月导出）。`,
      { code: "TOO_LARGE" },
      413,
    );
  }

  /* 越权保护：导入 = 往某个 persona 写人格数据，只能写自己的 */
  const personaId = String(form.get("personaId") ?? "") || me.ownPersonaId;
  if (personaId !== me.ownPersonaId) {
    return bad("只能往自己的人格导入数据。", { code: "FORBIDDEN" }, 403);
  }

  const selfName = String(form.get("selfName") ?? "").trim() || null;

  /* ── 解码 + 解析 ── */
  const bytes = await file.arrayBuffer();
  const decoded = decodeBytes(bytes);
  const parsed = parseImportFile(source, name, decoded.text, { selfName });

  const warnings = [...parsed.warnings];
  if (decoded.warning) warnings.push(decoded.warning);

  if (parsed.items.length === 0) {
    return bad("没能从这个文件里读出可用于蒸馏的内容。", {
      code: "NO_CONTENT",
      warnings,
      format: parsed.format,
      speakers: parsed.speakers,
      rawCount: parsed.rawCount,
    });
  }

  const contents = parsed.items.map((it) => ({ text: it.text, heat: it.heat }));
  const totalChars = parsed.items.reduce((s, it) => s + it.text.length, 0);
  const evidenceRows = topEvidence(parsed.items, MAX_EVIDENCE_ROWS);

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, interests: true },
  });
  if (!persona) return bad("Persona 不存在", { code: "NO_PERSONA" }, 404);

  /* ── 落库：替换该源旧证据 + 标记已注入 + 合并兴趣 ── */
  const detectedInterests = interestsFromTexts(parsed.items.map((it) => it.text));
  const oldInterests = Array.isArray(persona.interests)
    ? (persona.interests as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const mergedInterests = [...new Set([...oldInterests, ...detectedInterests])].slice(0, 40);
  const addedInterests = detectedInterests.filter((x) => !oldInterests.includes(x));

  const meta = {
    files: 1,
    fileName: name,
    format: parsed.format,
    encoding: decoded.encoding,
    rawCount: parsed.rawCount,
    items: parsed.items.length,
    evidenceRows: evidenceRows.length,
    chars: totalChars,
    selfName,
  };

  await prisma.$transaction(
    async (tx) => {
      /* 重新导入 = 替换。累加会让"条数/平均字数"这类统计无限膨胀，
         而文件本身就是这个源的事实来源。 */
      await tx.personaEvidence.deleteMany({ where: { personaId, source } });

      /**
       * ⚠️ 用 `createMany`（一条 SQL），**不要** for 循环逐条 create。
       *
       * 真实文件实测炸过：608 条消息的文件会挑出 200 条证据，
       * 逐条 create 就是 200 次往返 —— Neon 在 ap-southeast-1，
       * 每次约 150ms，累计 30 秒，而 Prisma 交互式事务**默认 5 秒超时**，
       * 于是抛 `A query cannot be executed on an expired transaction`，
       * 接口 500 且**响应体为空**，前端只看到
       * "Unexpected end of JSON input"（用户报的就是这个）。
       * 小文件（3 条）测不出来，必须有大数据量的用例才暴露。
       */
      if (evidenceRows.length) {
        await tx.personaEvidence.createMany({
          data: evidenceRows.map((it) => ({
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
        update: { status: "injected", importedAt: new Date(), meta: meta as never },
        create: {
          personaId,
          type: source,
          status: "injected",
          importedAt: new Date(),
          meta: meta as never,
        },
      });

      await tx.persona.update({
        where: { id: personaId },
        data: { interests: mergedInterests as never },
      });
    },
    /* 事务超时同样要显式给足：默认 5 秒对"删旧证据 + 写新证据"这种
       多语句事务太紧（Neon 单趟往返就有 100~200ms）。 */
    { maxWait: 20000, timeout: 60000 },
  );

  /* ── 刷新分源解析 ──
     产品要求："拿到某个源的数据后第一时间就该能解析出这个源里的人格特征"。
     两个选项都是必须的，且都是踩过坑才加的：
       · `noHeat: true` —— 聊天记录没有点赞数这类互动量。不标记的话
         `social` 会被算成"1%（社交连接极弱）"，把"量不到"当成"量出来很低"。
       · `profile: "im"` —— 默认口径是按知乎长文校准的。中文聊天消息天然只有
         十几到几十字，会触发"只有标题"的自动判定、把三个维度整组丢掉
         （实测就是这么丢的）；而且"平均字数/600"量到的是聊天习惯不是学习倾向。
         im 口径只算量得准的三维，缺的那两维在人话里说明原因。 */
  const facet = facetFromContents(source, IMPORT_SOURCE_LABEL[source], contents, {
    noHeat: true,
    profile: "im",
  });
  if (facet) {
    try {
      await persistSourceFacet(personaId, facet);
    } catch (e) {
      /* 证据已经写进去了，只是分源解析没刷新。如实回报，不假装成功。 */
      warnings.push(`分源解析刷新失败（数据已保存）：${(e as Error).message}`);
      console.error("[import] persistSourceFacet 失败", e);
    }
  }

  return NextResponse.json({
    ok: true,
    source,
    counts: {
      raw: parsed.rawCount,
      items: parsed.items.length,
      evidence: evidenceRows.length,
      chars: totalChars,
    },
    format: parsed.format,
    encoding: decoded.encoding,
    speakers: parsed.speakers,
    /* 会话信息 + "我发的"是怎么判定的：用户据此判断结果可不可信 */
    session: parsed.session,
    mineDetectedBy: parsed.mineDetectedBy,
    addedInterests,
    warnings,
    facet: facet
      ? {
          itemCount: facet.itemCount,
          values: facet.values,
          summary: facet.summary,
        }
      : null,
    samples: evidenceRows.slice(0, 5).map((it) => ({
      trait: it.trait,
      text: it.text.slice(0, 80),
    })),
  });
}
