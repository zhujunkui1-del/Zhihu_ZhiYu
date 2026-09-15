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
  type ImportItem,
  type ImportSource,
  type SessionInfo,
} from "@/lib/import/parse";
import { facetFromContents, interestsFromTexts } from "@/lib/persona/fusion";
import { persistSourceFacet } from "@/lib/persona/source-facets";

export const dynamic = "force-dynamic";
/** 解析大文件可能超过默认 10s（Vercel Hobby 上限 60s） */
export const maxDuration = 60;

/** 证据表里最多写多少条（解析仍用全部内容，见 lib/import/parse.ts） */
const MAX_EVIDENCE_ROWS = 200;
/** 一次最多几个文件（多个聊天记录一起导入是常态，但也要有个上限） */
const MAX_FILES = 20;
/** 一批文件合计上限。Vercel 请求体上限 4.5MB，留 multipart 开销余量 */
const IMPORT_MAX_BYTES_TOTAL = 4 * 1024 * 1024;

/** 单个文件的解析结果（如实回报给用户，便于定位是哪一份出了问题） */
interface ImportFileReport {
  name: string;
  size: number;
  format: string;
  encoding: string;
  rawCount: number;
  items: number;
  session: SessionInfo | null;
  mineDetectedBy: "flag" | "nickname" | "none";
}

/** 写入方式：覆盖 / 添加 */
export type ImportMode = "replace" | "append";

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

  /**
   * 一次可以传**多个文件**，它们合起来构成这个源的全部数据。
   *
   * 为什么要支持多选：这个接口是**替换**语义（见下面的 deleteMany），
   * 一次只给一个文件的话，用户导入第二个聊天记录时就会把第一份冲掉。
   * 而"我和好几个人的聊天记录"才是常态 —— 所以让用户一次选完，
   * 这一批文件共同定义这个源；要增删就重新选一遍。
   */
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return bad("没有收到文件。", { code: "NO_FILE" });
  }
  if (files.length > MAX_FILES) {
    return bad(
      `一次最多导入 ${MAX_FILES} 个文件（收到 ${files.length} 个）。请分批导入。`,
      { code: "TOO_MANY_FILES" },
    );
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  if (totalSize > IMPORT_MAX_BYTES_TOTAL) {
    return bad(
      `这批文件合计 ${(totalSize / 1024 / 1024).toFixed(1)}MB，超过 ` +
        `${IMPORT_MAX_BYTES_TOTAL / 1024 / 1024}MB 上限。请分批导入。`,
      { code: "TOTAL_TOO_LARGE" },
      413,
    );
  }

  /* 逐个文件先做格式与大小校验，任何一个不合格就整体拒绝 ——
     部分成功会让"这批文件 = 这个源"的语义变得含糊。 */
  for (const f of files) {
    const n = f.name || "未命名文件";
    const e = (/\.[^./\\]+$/.exec(n.toLowerCase())?.[0] ?? "") as string;
    if (!(IMPORT_EXTENSIONS as readonly string[]).includes(e)) {
      return bad(
        `「${n}」的格式不支持（${e || "无扩展名"}）。` +
          `目前支持：${IMPORT_EXTENSIONS.join(" / ")}。`,
        { code: "BAD_EXT", file: n },
      );
    }
    if (f.size === 0) return bad(`「${n}」是空文件。`, { code: "EMPTY_FILE", file: n });
    if (f.size > IMPORT_MAX_BYTES) {
      return bad(
        `「${n}」${(f.size / 1024 / 1024).toFixed(1)}MB 超过单文件上限 ` +
          `${IMPORT_MAX_BYTES / 1024 / 1024}MB。请拆分后再导入（例如按月导出）。`,
        { code: "TOO_LARGE", file: n },
        413,
      );
    }
  }

  /* 越权保护：导入 = 往某个 persona 写人格数据，只能写自己的 */
  const personaId = String(form.get("personaId") ?? "") || me.ownPersonaId;
  if (personaId !== me.ownPersonaId) {
    return bad("只能往自己的人格导入数据。", { code: "FORBIDDEN" }, 403);
  }

  const selfName = String(form.get("selfName") ?? "").trim() || null;

  /**
   * 写入方式（用户明确要求分成两个按钮）：
   *   · `replace` —— **删除该源上次注入的全部数据**，换成这一批（「覆盖聊天记录」）
   *   · `append`  —— 追加到现有数据后面，**不删除**上次的（「添加聊天记录」）
   * 默认 replace：首次导入时两者等价，而"我以为在追加、其实覆盖了"比反过来更糟。
   */
  const modeRaw = String(form.get("mode") ?? "");
  const mode: ImportMode = modeRaw === "append" ? "append" : "replace";

  /* ── 解码 + 逐个解析，再合成一份 ── */
  const multi = files.length > 1;
  const items: ImportItem[] = [];
  const warnings: string[] = [];
  const fileReports: ImportFileReport[] = [];
  const speakerSet = new Map<string, number>();
  let rawTotal = 0;
  let emptyFiles = 0;

  for (const f of files) {
    const name = f.name || "未命名文件";
    const bytes = await f.arrayBuffer();
    const decoded = decodeBytes(bytes);
    const parsed = parseImportFile(source, name, decoded.text, { selfName });

    /* 多文件时把警告按文件归组，用户才知道是哪一份出的问题 */
    const tag = multi ? `【${name}】` : "";
    if (decoded.warning) warnings.push(`${tag}${decoded.warning}`);
    for (const w of parsed.warnings) warnings.push(`${tag}${w}`);

    for (const s of parsed.speakers) {
      const m = /^(.+?)（(\d+) 条）$/.exec(s);
      const who = m?.[1] ?? s;
      const n = Number(m?.[2] ?? 1);
      speakerSet.set(who, (speakerSet.get(who) ?? 0) + n);
    }

    rawTotal += parsed.rawCount;
    if (parsed.items.length === 0) emptyFiles += 1;
    items.push(...parsed.items);

    fileReports.push({
      name,
      size: f.size,
      format: parsed.format,
      encoding: decoded.encoding,
      rawCount: parsed.rawCount,
      items: parsed.items.length,
      session: parsed.session,
      mineDetectedBy: parsed.mineDetectedBy,
    });
  }

  const speakers = [...speakerSet.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([s, n]) => `${s}（${n} 条）`);

  if (items.length === 0) {
    return bad(
      multi
        ? `这 ${files.length} 个文件里都没读出可用于蒸馏的内容。`
        : "没能从这个文件里读出可用于蒸馏的内容。",
      {
        code: "NO_CONTENT",
        warnings,
        speakers,
        rawCount: rawTotal,
        files: fileReports,
      },
    );
  }
  if (emptyFiles > 0) {
    warnings.push(
      `有 ${emptyFiles} 个文件没读出内容（已跳过），其余文件照常导入。`,
    );
  }

  const contents = items.map((it) => ({ text: it.text, heat: it.heat }));
  const totalChars = items.reduce((s, it) => s + it.text.length, 0);
  const evidenceRows = topEvidence(items, MAX_EVIDENCE_ROWS);

  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { id: true, interests: true },
  });
  if (!persona) return bad("Persona 不存在", { code: "NO_PERSONA" }, 404);

  /* ── 落库：替换/追加该源证据 + 标记已注入 + 合并兴趣 ── */
  const detectedInterests = interestsFromTexts(items.map((it) => it.text));
  const oldInterests = Array.isArray(persona.interests)
    ? (persona.interests as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const mergedInterests = [...new Set([...oldInterests, ...detectedInterests])].slice(0, 40);
  const addedInterests = detectedInterests.filter((x) => !oldInterests.includes(x));

  /* 追加模式要跳过"库里已经有的一模一样的内容"，否则反复导入同一份
     会把证据表堆满重复行（0/1 之外的另一种浪费）。 */
  let toAppend = evidenceRows;
  let skippedDuplicates = 0;
  if (mode === "append") {
    const existing = await prisma.personaEvidence.findMany({
      where: { personaId, source },
      select: { note: true },
    });
    const seen = new Set(existing.map((e) => (e.note ?? "").slice(0, 120)));
    toAppend = evidenceRows.filter((it) => !seen.has(it.text.slice(0, 120)));
    skippedDuplicates = evidenceRows.length - toAppend.length;
  }

  const prevMeta =
    mode === "append"
      ? (((await prisma.personaSource.findUnique({
          where: { personaId_type: { personaId, type: source } },
          select: { meta: true },
        }))?.meta ?? null) as Record<string, unknown> | null)
      : null;

  const prevFiles = Array.isArray(prevMeta?.fileNames)
    ? (prevMeta.fileNames as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const prevCount =
    typeof prevMeta?.evidenceRows === "number" ? (prevMeta.evidenceRows as number) : 0;

  const meta = {
    mode,
    files: files.length + (mode === "append" ? prevFiles.length : 0),
    fileNames: [...prevFiles, ...fileReports.map((r) => r.name)],
    formats: [
      ...new Set([
        ...(Array.isArray(prevMeta?.formats)
          ? (prevMeta.formats as unknown[]).filter((x): x is string => typeof x === "string")
          : []),
        ...fileReports.map((r) => r.format),
      ]),
    ],
    /** 本次这批文件的统计（追加模式下不等于源总量） */
    batch: {
      rawCount: rawTotal,
      items: items.length,
      evidenceRows: evidenceRows.length,
      chars: totalChars,
    },
    /** 源总量（追加时累加，覆盖时等于本批） */
    rawCount: rawTotal + (mode === "append" ? Number(prevMeta?.rawCount ?? 0) : 0),
    items: items.length + (mode === "append" ? Number(prevMeta?.items ?? 0) : 0),
    evidenceRows: evidenceRows.length + (mode === "append" ? prevCount : 0),
    chars: totalChars + (mode === "append" ? Number(prevMeta?.chars ?? 0) : 0),
    selfName,
    lastImportedAt: new Date().toISOString(),
  };

  await prisma.$transaction(
    async (tx) => {
      /* 覆盖 = 删掉这个源上次注入的全部数据；添加 = 一行都不删。
         两者都**只动这一个源**，其它源不受影响。 */
      if (mode === "replace") {
        await tx.personaEvidence.deleteMany({ where: { personaId, source } });
      }

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
      if (toAppend.length) {
        await tx.personaEvidence.createMany({
          data: toAppend.map((it) => ({
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
     三个要点都是踩过坑才有的：
       · **用该源全部证据重算**，而不是只用本批 —— 追加模式下只算本批的话，
         分源解析会"忘掉"以前导入的记录（明明数据还在库里）。
       · `noHeat: true` —— 聊天记录没有点赞数这类互动量。不标记的话
         `social` 会被算成"1%（社交连接极弱）"，把"量不到"当成"量出来很低"。
       · `profile: "im"` —— 默认口径是按知乎长文校准的。中文聊天消息天然只有
         十几到几十字，会触发"只有标题"的自动判定、把三个维度整组丢掉
         （实测就是这么丢的）；而且"平均字数/600"量到的是聊天习惯不是学习倾向。
         im 口径只算量得准的三维，缺的那两维在人话里说明原因。 */
  const allRows = await prisma.personaEvidence.findMany({
    where: { personaId, source },
    select: { note: true, value: true },
  });
  const facetContents = allRows
    .map((r) => ({ text: (r.note ?? "").trim(), heat: r.value ?? undefined }))
    .filter((c) => c.text.length > 0);
  const facet = facetFromContents(source, IMPORT_SOURCE_LABEL[source], facetContents, {
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

  if (mode === "append" && skippedDuplicates > 0) {
    warnings.push(
      `追加时跳过 ${skippedDuplicates} 条与库里已有内容完全相同的证据（避免重复堆叠）。`,
    );
  }
  if (mode === "append") {
    warnings.push(
      `本次是**添加**：上次导入的数据保留，现在这个源共有 ${allRows.length + toAppend.length} 条证据。`,
    );
  } else if (prevCount > 0) {
    warnings.push(
      `本次是**覆盖**：已删除该源上次的 ${prevCount} 条证据，换成这一批 ${toAppend.length} 条。其它数据源未受影响。`,
    );
  }

  return NextResponse.json({
    ok: true,
    source,
    /** 写入方式：replace=覆盖（删旧的）| append=添加（保留旧的） */
    mode,
    counts: {
      raw: rawTotal,
      items: items.length,
      evidence: toAppend.length,
      chars: totalChars,
    },
    /** 覆盖模式下这是"被删掉的旧证据条数"，用于让用户确认覆盖了什么 */
    replacedCount: mode === "replace" ? prevCount : 0,
    totalEvidence: allRows.length + (mode === "replace" ? toAppend.length : 0),
    skippedDuplicates,
    /* 多文件时逐份回报，用户才知道每份读到了什么 */
    files: fileReports,
    format: fileReports.length === 1 ? fileReports[0].format : `${fileReports.length} 个文件`,
    encoding: fileReports[0]?.encoding ?? "utf-8",
    speakers,
    /* 会话信息 + "我发的"是怎么判定的：用户据此判断结果可不可信 */
    session: fileReports.length === 1 ? fileReports[0].session : null,
    mineDetectedBy: fileReports.every((r) => r.mineDetectedBy === "flag")
      ? "flag"
      : fileReports.some((r) => r.mineDetectedBy === "nickname")
        ? "nickname"
        : "none",
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