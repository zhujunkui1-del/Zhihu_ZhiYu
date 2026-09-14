"use client";

/**
 * 全局错误总线。
 *
 * 为什么需要它：
 *   在此之前每个页面各自写一套 toast（4 个组件共 26 处），还有直接用 `alert()`
 *   的地方。后果是
 *     · 报错样式/时长/位置各不相同
 *     · **漏掉的报错完全不显示**（某个 fetch 忘了 catch，用户只看到"点了没反应"）
 *     · `alert()` 会阻塞页面，且移动端体验很差
 *
 * 本模块把所有报错汇到一个出口：界面下方的**弹幕式**提示条。
 *
 * 三层来源：
 *   ① 业务代码主动调 `reportError()` / `reportInfo()`（可带上下文与重试动作）
 *   ② **未捕获异常**（window.onerror / unhandledrejection）
 *   ③ **未处理的接口失败**（4xx/5xx 且调用方没标 `handled`）
 *
 * 为什么第③层要包 fetch：这是最容易漏的一层。调用方写 `await fetch(...)`
 * 却忘了检查 `resp.ok` 时，用户看到的是"没反应"而不是报错。
 */

export type ToastLevel = "error" | "warn" | "info" | "success";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  level: ToastLevel;
  /** 一句话说明发生了什么 */
  title: string;
  /** 细节（HTTP 状态、错误码、接口路径等） */
  detail?: string;
  /** 可选操作，例如「重试」 */
  action?: ToastAction;
  /** 自动消失时长（ms）；0 表示不自动消失 */
  ttl: number;
  at: number;
}

type Listener = (items: ToastItem[]) => void;

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

/** 相同内容在此时长内不重复弹（避免一次失败弹十条） */
const DEDUPE_WINDOW_MS = 4000;
const recent = new Map<string, number>();

function emit() {
  const snapshot = items;
  for (const l of listeners) l(snapshot);
}

function push(t: Omit<ToastItem, "id" | "at">) {
  const key = `${t.level}|${t.title}|${t.detail ?? ""}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return;
  recent.set(key, now);
  /* 清理过期的去重记录，避免 Map 无限增长 */
  for (const [k, v] of recent) if (now - v > DEDUPE_WINDOW_MS * 4) recent.delete(k);

  const item: ToastItem = { ...t, id: ++seq, at: now };
  /* 最多保留 4 条，新的在最后（弹幕自下而上） */
  items = [...items, item].slice(-4);
  emit();

  if (item.ttl > 0) {
    setTimeout(() => dismiss(item.id), item.ttl);
  }
}

export function dismiss(id: number) {
  const next = items.filter((x) => x.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

export function clearToasts() {
  items = [];
  emit();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  l(items);
  return () => listeners.delete(l);
}

/* ── 对外 API ──────────────────────────────────────────────────────────── */

export function reportError(err: unknown, opts?: { title?: string; detail?: string; action?: ToastAction }) {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();

  push({
    level: "error",
    title: opts?.title ?? humanize(msg),
    detail: opts?.detail ?? msg,
    action: opts?.action,
    ttl: 7000,
  });
}

export function reportWarn(title: string, detail?: string) {
  push({ level: "warn", title, detail, ttl: 6000 });
}

export function reportInfo(title: string, detail?: string) {
  push({ level: "info", title, detail, ttl: 4500 });
}

export function reportSuccess(title: string, detail?: string) {
  push({ level: "success", title, detail, ttl: 3500 });
}

/**
 * 兼容旧写法 `showToast(msg)` 的统一入口。
 *
 * 现有 4 个组件各自实现了 showToast，参数只有一个字符串。
 * 这里保留单参数可用，避免一次性改几十处调用点；
 * 需要区分层级时传第二个参数。
 */
export function showToast(msg: string, level: ToastLevel = "info", detail?: string) {
  push({ level, title: msg, detail, ttl: level === "error" ? 7000 : level === "warn" ? 6000 : 3500 });
}

/**
 * 把技术性错误信息翻成人话。
 *
 * 用户不该看到 `TypeError: Failed to fetch`。但也不该把原因藏起来 ——
 * 所以做成"人话标题 + 原始细节"两层。
 */
function humanize(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")) {
    return "网络连接失败";
  }
  if (m.includes("timeout") || m.includes("aborted")) return "请求超时";
  if (m.includes("401") || m.includes("unauthorized") || m.includes("未登录")) return "登录状态已失效";
  if (m.includes("403") || m.includes("forbidden")) return "没有权限执行这个操作";
  if (m.includes("404")) return "请求的资源不存在";
  if (m.includes("429")) return "操作太频繁，请稍后再试";
  if (/5\d\d/.test(m)) return "服务端出错了";
  return "操作失败";
}

/* ── ① 未捕获异常 ──────────────────────────────────────────────────────── */

let installed = false;

export function installGlobalHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e) => {
    /* 资源加载失败（img/script）不弹——太吵，且多数有本地兜底 */
    const t = e.target as HTMLElement | null;
    if (t && t !== (window as unknown as HTMLElement) && t.tagName && /IMG|SCRIPT|LINK/.test(t.tagName)) {
      return;
    }
    reportError(e.error ?? e.message, { title: "页面出错了" });
  });

  window.addEventListener("unhandledrejection", (e) => {
    reportError(e.reason, { title: "有一个操作没有完成" });
  });

  /* ── ③ 包一层 fetch：捕获**调用方忘了检查**的接口失败 ──
     只报告，不改行为（返回值原样透传），所以不会破坏任何调用方。 */
  const original = window.fetch;
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const resp = await original(...args);
    /* 业务代码可以用这个头声明"我自己会处理"，避免重复弹 */
    const silent = (() => {
      try {
        const init = args[1];
        const h = init?.headers;
        if (!h) return false;
        if (h instanceof Headers) return h.get("x-silent-error") === "1";
        if (Array.isArray(h)) return h.some(([k, v]) => k.toLowerCase() === "x-silent-error" && v === "1");
        return (h as Record<string, string>)["x-silent-error"] === "1";
      } catch {
        return false;
      }
    })();

    if (!resp.ok && !silent) {
      const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
      const path = (() => {
        try {
          return new URL(url, location.origin).pathname;
        } catch {
          return url;
        }
      })();
      /* 只在 5xx 与常见的 4xx 上报；400/422 往往是入参校验，由调用方给更准确的提示 */
      if (resp.status >= 500 || resp.status === 401 || resp.status === 403 || resp.status === 429) {
        reportError(`HTTP ${resp.status}`, { title: humanize(`HTTP ${resp.status}`), detail: `${path}　HTTP ${resp.status}` });
      }
    }
    return resp;
  };
}
