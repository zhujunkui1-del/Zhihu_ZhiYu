"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IMPORT_EXTENSIONS,
  IMPORT_MAX_BYTES,
  type ImportSource,
} from "@/lib/import/parse";
import { toDisplayPercent, toDisplayPercentText } from "@/lib/score";
import styles from "./ImportDataDialog.module.css";

/**
 * 「导入数据」弹窗 —— 手动导入微信 / QQ / 飞书 / 钉钉的数据文件。
 *
 * ── 需求（用户原话）────────────────────────────────────────────────────
 *   「点击按钮后要能跳出用户的电脑窗口，然后让用户把 json、txt 等文件格式的
 *     产品支持的可以用于蒸馏的文件数据导入到网站上。」
 *
 * 所以这个组件只做三件事：
 *   ① 文件选择（OS 原生窗口）—— 由隐藏的 `<input type="file">` 触发
 *   ② 导入前如实说清"这个源支持什么、会怎么解析"（含 distilly 的采集命令）
 *   ③ 导入后把结果摊开给用户看（读了多少条、识别到哪些发言者、
 *      跳过了什么、分源解析算出了什么），而不是一句"导入成功"
 *
 * 不做的事：不假装能自动抓取。飞书/钉钉的自动采集需要**本机浏览器登录态 +
 * Python 脚本**（distilly 的 `*_auto_collector.py`），本站是 Vercel 单体、
 * 没有常驻进程跑不了，所以给的是"在你自己电脑上跑 distilly → 把产物拖进来"。
 */

export interface ImportFileResult {
  ok: boolean;
  error?: string;
  code?: string;
  /** 成功时后端回报写入了哪个源 */
  source?: string;
  counts?: { raw: number; items: number; evidence: number; chars: number };
  format?: string;
  encoding?: string;
  speakers?: string[];
  /** 会话信息（对方名字 / 私聊还是群聊） */
  session?: { partnerName: string | null; type: string | null } | null;
  /** "我发的"是怎么判定的：flag=文件自带方向标记，nickname=靠昵称 */
  mineDetectedBy?: "flag" | "nickname" | "none";
  addedInterests?: string[];
  warnings?: string[];
  facet?: {
    itemCount: number;
    values: Record<string, number>;
    summary: string;
  } | null;
  samples?: { trait: string; text: string }[];
}

/** 每个源的"支持什么文件、怎么拿到"的说明。文案即契约，不夸大。 */
const GUIDE: Record<
  ImportSource,
  {
    title: string;
    accept: string;
    hint: string;
    formats: { name: string; desc: string }[];
    steps: string[];
  }
> = {
  wechat: {
    title: "导入微信聊天记录",
    accept: ".json,.txt,.csv,.md,.log",
    hint: "只提取**你自己**发的内容 —— 别人的话不会算进你的人格。",
    formats: [
      { name: "JSON", desc: "留痕 / 聊天记录导出工具导出的 JSON（含 sender、content 字段）" },
      { name: "TXT", desc: "形如 `2024-01-01 10:00 张三：内容`，或 `张三：内容`" },
      { name: "CSV", desc: "带 sender / content 表头，或两列（人名、内容）" },
    ],
    steps: [
      "在微信电脑版里选中聊天 → 导出/备份为文件（或用你惯用的导出工具）",
      "把导出的 json / txt / csv 拖到这里",
      "填上你在文件里的昵称，只会提取你发的内容",
    ],
  },
  qq: {
    title: "导入 QQ 聊天记录",
    accept: ".json,.txt,.csv,.md,.log",
    hint: "支持 QCE / TIM 等工具导出的 txt 与 json，群聊私聊都可以。",
    formats: [
      { name: "TXT", desc: "两行式（`时间 昵称` 换行接内容）或单行式（`昵称：内容`）" },
      { name: "JSON", desc: "message / msgList / messages 数组，字段名自动识别" },
      { name: "CSV", desc: "带 sender / content 表头" },
    ],
    steps: [
      "用消息管理器导出为 txt（推荐）或 json",
      "拖进这里，填上你的 QQ 昵称",
      "群聊记录也可以，但一定要填昵称，否则会把群友的话算给你",
    ],
  },
  feishu: {
    title: "导入飞书工作数据",
    accept: ".json,.txt,.md,.csv,.log",
    hint: "格式与 distilly 的飞书解析器逐字对齐：官方消息导出 JSON、或整理好的 TXT。",
    formats: [
      {
        name: "JSON",
        desc: "飞书官方导出：messages / records / data 数组，含 sender、content、timestamp",
      },
      { name: "TXT", desc: "形如 `2024-01-01 10:00 张三：内容`" },
      { name: "MD", desc: "distilly 采集产出的 messages.txt / docs.txt" },
    ],
    steps: [
      "方式一：飞书里导出消息记录（JSON），直接拖进来",
      "方式二：在本机跑 distilly 采集 —— python3 tools/feishu_auto_collector.py --name \"你的名字\" --output-dir ./knowledge/me",
      "把 knowledge/me 下的 messages.txt / docs.txt 拖进来",
    ],
  },
  dingtalk: {
    title: "导入钉钉工作数据",
    accept: ".json,.txt,.md,.csv,.log",
    hint: "格式与 distilly 的钉钉采集脚本产物逐字对齐：docs.txt / bitables.txt / messages.txt。",
    formats: [
      { name: "TXT/MD", desc: "distilly 产物：`# 文档内容`、`## 《文档名》`、`### 表：xxx` 分区文本" },
      { name: "JSON", desc: "含 messages / records / data 数组的导出文件" },
      { name: "TXT", desc: "聊天记录：`时间 昵称：内容`" },
    ],
    steps: [
      "在本机跑 distilly 采集 —— python3 tools/dingtalk_auto_collector.py --name \"你的名字\" --output-dir ./knowledge/me",
      "钉钉 API 不支持历史消息，脚本会自动切浏览器采集（首次需登录）",
      "把 knowledge/me 下的 docs.txt / bitables.txt / messages.txt 拖进来（可分多次导入）",
    ],
  },
};

const VALUE_LABEL: Record<string, string> = {
  learning: "学习成长",
  creation: "创造表达",
  career: "事业成就",
  social: "社交连接",
  stability: "稳定安全",
  autonomy: "独立自主",
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ImportDataDialog({
  source,
  personaId,
  onClose,
  onImported,
}: {
  source: ImportSource;
  personaId: string;
  onClose: () => void;
  /** 导入成功后的回调（父组件据此刷新服务端数据） */
  onImported: (result: ImportFileResult) => void;
}) {
  const guide = GUIDE[source];
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selfName, setSelfName] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ImportFileResult | null>(null);
  const [localError, setLocalError] = useState("");

  /* 弹窗打开即弹出系统文件选择窗口 —— 需求："点击按钮后要能跳出用户的电脑窗口" */
  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.click(), 60);
    return () => window.clearTimeout(t);
  }, []);

  /* Esc 关闭 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const pick = useCallback(
    (f: File | null | undefined) => {
      setLocalError("");
      setResult(null);
      if (!f) return;
      const ext = (/\.[^./\\]+$/.exec(f.name.toLowerCase())?.[0] ?? "") as string;
      if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
        setLocalError(
          `不支持「${ext || "无扩展名"}」。可用格式：${IMPORT_EXTENSIONS.join(" / ")}。`,
        );
        return;
      }
      if (f.size > IMPORT_MAX_BYTES) {
        setLocalError(
          `文件 ${humanSize(f.size)} 超过 ${humanSize(IMPORT_MAX_BYTES)} 上限，` +
            `请拆分后再导入（例如按月导出）。`,
        );
        return;
      }
      setFile(f);
    },
    [],
  );

  const submit = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setLocalError("");
    try {
      const fd = new FormData();
      fd.append("source", source);
      fd.append("personaId", personaId);
      fd.append("file", file);
      if (selfName.trim()) fd.append("selfName", selfName.trim());

      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "x-silent-error": "1" },
        body: fd,
      });

      /**
       * ⚠️ 先取文本再解析，不能直接 `res.json()`。
       *
       * 实测：serverless/route handler 抛未捕获异常或请求被平台拦下时，
       * 响应体**是空的**，`res.json()` 只会抛
       * "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
       * —— 用户看到的就是这行英文，完全不知道发生了什么。
       * 这里把状态码与响应片段如实带出来，至少能定位。
       */
      const raw = await res.text();
      let r: ImportFileResult;
      if (!raw) {
        r = {
          ok: false,
          error:
            `服务器返回了空响应（HTTP ${res.status}）—— ` +
            `通常是文件太大、处理超时或服务端出错。数据未写入，可以重试；` +
            `若文件很大，请先按月/按会话拆分再导入。`,
        };
      } else {
        try {
          r = JSON.parse(raw) as ImportFileResult;
        } catch {
          r = {
            ok: false,
            error: `服务器返回的不是 JSON（HTTP ${res.status}）：${raw.slice(0, 160)}`,
          };
        }
      }

      setResult(r);
      if (r.ok) onImported(r);
    } catch (e) {
      setLocalError(`上传失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [file, onImported, personaId, selfName, source]);

  const dims = useMemo(() => {
    const v = result?.facet?.values ?? {};
    return Object.entries(v).filter(([, x]) => typeof x === "number");
  }, [result]);

  return (
    <div
      className={styles.wrap}
      data-import-dialog={source}
      role="dialog"
      aria-modal="true"
      aria-label={guide.title}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.backdrop} onClick={() => !busy && onClose()} aria-hidden="true" />

      <div className={styles.dialog}>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          disabled={busy}
          aria-label="关闭"
        >
          ✕
        </button>

        <p className={styles.eyebrow}>手动导入 · 本地文件</p>
        <h3 className={styles.title} data-import-title="1">
          {guide.title}
        </h3>
        <p className={styles.hint}>{guide.hint}</p>

        <input
          ref={inputRef}
          type="file"
          className={styles.fileInput}
          accept={guide.accept}
          data-import-input="1"
          onChange={(e) => pick(e.target.files?.[0])}
        />

        {/* ① 选文件 */}
        <div
          className={`${styles.drop} ${dragging ? styles.dropOn : ""}`}
          data-import-drop="1"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer?.files?.[0]);
          }}
        >
          {file ? (
            <div className={styles.fileBox} data-import-file="1">
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileMeta}>
                {humanSize(file.size)} · {file.type || "未知类型"}
              </span>
              <button
                type="button"
                className={styles.reselect}
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                重新选择
              </button>
            </div>
          ) : (
            <>
              <p className={styles.dropBig}>把文件拖到这里</p>
              <button
                type="button"
                className="btn btnPrimary"
                data-import-choose="1"
                onClick={() => inputRef.current?.click()}
              >
                选择文件
              </button>
              <p className={styles.dropNote}>
                支持 {IMPORT_EXTENSIONS.join(" / ")}，单文件 ≤ {humanSize(IMPORT_MAX_BYTES)}
              </p>
            </>
          )}
        </div>

        {/* ② 昵称：只蒸馏"我"说的话 */}
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            你在文件里的昵称
            <em>建议填 —— 填了只提取你发的内容</em>
          </span>
          <input
            type="text"
            className={styles.input}
            data-import-selfname="1"
            placeholder="例如：小明 / 你的微信昵称"
            value={selfName}
            onChange={(e) => setSelfName(e.target.value)}
            disabled={busy}
          />
        </label>

        {/* ③ 支持的格式 + 怎么拿到数据 */}
        <details className={styles.details}>
          <summary>支持哪些格式？怎么导出？</summary>
          <ul className={styles.formatList}>
            {guide.formats.map((f) => (
              <li key={f.name}>
                <b>{f.name}</b>
                <span>{f.desc}</span>
              </li>
            ))}
          </ul>
          <ol className={styles.steps}>
            {guide.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </details>

        {localError ? (
          <p className={styles.error} data-import-error="1">
            {localError}
          </p>
        ) : null}

        {/* ④ 结果：如实摊开读到了什么 */}
        {result ? (
          <div
            className={result.ok ? styles.result : styles.resultBad}
            data-import-result={result.ok ? "ok" : "fail"}
          >
            {result.ok ? (
              <>
                <p className={styles.resultHead}>
                  导入完成：读到 <b>{result.counts?.raw ?? 0}</b> 条原始内容，
                  其中 <b>{result.counts?.items ?? 0}</b> 条可用于蒸馏，
                  写入证据 <b>{result.counts?.evidence ?? 0}</b> 条
                  （共 {result.counts?.chars ?? 0} 字）。
                </p>
                <p className={styles.resultMeta}>
                  按「{result.format}」解析 · 编码 {result.encoding}
                  {result.session?.partnerName
                    ? ` · 会话对象 ${result.session.partnerName}${
                        result.session.type ? `（${result.session.type}）` : ""
                      }`
                    : ""}
                </p>

                {/* "我发的"是靠什么判定的 —— 直接决定这份数据可不可信，必须说 */}
                <p className={styles.resultMeta} data-import-mine-by={result.mineDetectedBy}>
                  {result.mineDetectedBy === "flag"
                    ? "只提取了你自己发出的消息（依据文件里自带的发送方向标记）"
                    : result.mineDetectedBy === "nickname"
                      ? "只提取了你自己发出的消息（依据你填的昵称）"
                      : "⚠️ 没能判断哪些是你发的，本次把文件里所有人的话都算进来了"}
                </p>

                {result.speakers?.length ? (
                  <p className={styles.resultMeta}>
                    文件里的发言者：{result.speakers.join("、")}
                  </p>
                ) : null}

                {result.addedInterests?.length ? (
                  <p className={styles.resultTags}>
                    新增兴趣标签：
                    {result.addedInterests.slice(0, 12).map((t) => (
                      <span key={t} className="badge">
                        {t}
                      </span>
                    ))}
                  </p>
                ) : null}

                {dims.length ? (
                  <div className={styles.dims}>
                    <p className={styles.dimsHead}>这个源解析出的特征</p>
                    {dims.map(([k, v]) => (
                      <div key={k} className={styles.dimRow}>
                        <span className={styles.dimLabel}>{VALUE_LABEL[k] ?? k}</span>
                        <span className="track">
                          <i
                            className="trackFill"
                            style={{ width: `${toDisplayPercent(v) ?? 0}%` }}
                          />
                        </span>
                        <span className={`num ${styles.dimVal}`}>
                          {toDisplayPercentText(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {result.samples?.length ? (
                  <div className={styles.samples}>
                    <p className={styles.dimsHead}>读到的内容（前几条）</p>
                    <ul>
                      {result.samples.map((s, i) => (
                        <li key={i}>
                          <span className="badge">{s.trait}</span>
                          <span className={styles.sampleText}>{s.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <p className={styles.resultHead}>
                没能导入：{result.error ?? "未知错误"}
              </p>
            )}

            {result.warnings?.length ? (
              <ul className={styles.warns}>
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className={styles.foot}>
          <button type="button" className="btn btnSecondary" onClick={onClose} disabled={busy}>
            {result?.ok ? "完成" : "取消"}
          </button>
          <button
            type="button"
            className="btn btnPrimary"
            data-import-submit="1"
            onClick={() => void submit()}
            disabled={!file || busy}
          >
            {busy ? "正在解析并写入…" : "开始导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
