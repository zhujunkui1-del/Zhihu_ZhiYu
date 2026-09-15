"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Reveal from "@/components/Reveal";
import styles from "./login.module.css";

const STORAGE_KEY = "zhiyu_demo";

/**
 * 回调失败时 `?oauth=<原因>` 的中文说明。
 *
 * 为什么要有这张表：以前 oauth 参数被**完全忽略**，
 * 用户授权失败后只看到登录页原样不动，只能猜是不是自己点错了。
 *
 * 为什么三个 state_* 要分开写：它们的原因和用户该做的事完全不同。
 * 以前三条都被合并成「授权状态校验失败，请重新发起登录」，
 * 结果手机上连续失败时**无法判断到底卡在哪一步**（实测踩过的坑）。
 */
const OAUTH_ERROR_TEXT: Record<string, string> = {
  unconfigured: "服务端尚未配置知乎开放平台凭证，请稍后再试。",
  denied: "你在知乎授权页选择了拒绝，或授权被取消。",
  code_missing: "知乎没有回传授权码，请重新发起登录。",
  no_uid: "没有读取到知乎账号标识，请重新授权。",
  exchange_failed: "用授权码换取访问令牌失败，请重新登录。",
  state_mismatch: "这次授权不是本浏览器发起的（或授权链接已失效），请在本页重新点登录。",
  state_expired: "这次授权等待超过 10 分钟，已自动失效，请重新登录。",
  state_consumed: "这次授权已经完成过一次了（例如页面被刷新或重复打开），请重新登录。",
};

/** 把 `state_xxx` 之类的后缀原因转成人话 */
function oauthErrorText(code: string, detail: string | null): string {
  const base = OAUTH_ERROR_TEXT[code] ?? OAUTH_ERROR_TEXT[`state_${code}`];
  const msg = base ?? `授权未完成（${code}）。`;
  return detail ? `${msg}（${detail}）` : msg;
}

/* 认识三步：文案与原型一致 */
const STEPS = [
  {
    index: "01",
    title: "把“我”交给 Agent",
    desc: "从不同侧面认识真实的你：聊出来的、表达出来的，以及你眼中的自己。",
    sources: [
      ["微信聊天", "真实的我"],
      ["知乎数据", "表达的我"],
      ["SBTI 测试", "认识的我"],
    ],
  },
  {
    index: "02",
    title: "生成“我的 Agent”",
    desc: "把信息融成属于你的 Persona，不靠几个标签草率定义。",
    quote: "它知道你为什么喜欢、怎么思考，以及和什么样的人聊得来。",
  },
  {
    index: "03",
    title: "让 Agent 帮你找人",
    desc: "相遇时不只比较“你们有多像”，而是从五个维度判断彼此是否值得认识。",
    chips: ["兴趣同频", "思维共振", "价值观契合", "沟通适配", "互补程度"],
  },
] as const;

/* Agent 对话示意 */
const CHAT = [
  { who: "a", avatar: "/assets/characters/self.webp", text: "如果突然获得一周完全自由的时间，你会怎么安排？" },
  { who: "b", avatar: "/assets/characters/newfriend.webp", text: "如果重新选择一次专业，你还会选现在这个吗？" },
  { who: "a", avatar: "/assets/characters/self.webp", text: "一个和你观点完全不同的人——你更想说服 TA，还是理解 TA？" },
] as const;

/* 五维匹配报告示意 */
const REPORT = [
  ["兴趣同频", 91],
  ["思维共振", 84],
  ["价值观契合", 88],
  ["沟通适配", 79],
  ["互补程度", 94],
] as const;

const FLOW = ["你", "你的 Agent", "TA 的 Agent", "TA"];

/** `/api/auth/session` 的返回：已登录？知乎 OAuth 配好了吗？ */
type SessionProbe = { authenticated?: boolean; oauthConfigured?: boolean };

/** 点击登录后最多等多久探测结果，超过就直接走真实授权（见 startLogin） */
const PROBE_WAIT_MS = 1200;

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** 失败原因的原样代码（如 state_expired），显示出来便于截图排查 */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /**
   * 本次页面加载**出现过**授权失败吗。
   *
   * 为什么要用 ref 记住：React 19 的 StrictMode 会把 effect 跑两遍
   * （挂载 → 清理 → 再挂载），第二遍会重新读到 URL 并再次 setError，
   * 同时**必须**避免它顺手把用户送进 /home 把报错顶掉。
   * 用 ref 记住"这次加载报过错"，后续所有自动跳转都不做。
   */
  const sawAuthError = useRef(false);

  /**
   * `/api/auth/session` 只探一次，多处复用。
   *
   * 为什么：手机端首屏就等着这个请求，而它是一次跨洋 Serverless + 数据库往返。
   * 以前「按钮可用」和「点下去能不能走」都各自等它一次，网络一慢就又卡又点不动。
   * 现在挂载时探一次，登录点击复用同一个 Promise（或超时兜底）。
   */
  const probeRef = useRef<Promise<SessionProbe> | null>(null);
  const probeSession = useCallback((): Promise<SessionProbe> => {
    if (!probeRef.current) {
      probeRef.current = fetch("/api/auth/session", { cache: "no-store" })
        .then((r) => r.json() as Promise<SessionProbe>)
        .catch(() => ({}) as SessionProbe);
    }
    return probeRef.current;
  }, []);

  /**
   * 进来先看两件事：① 回调有没有带错误原因 ② 是不是已经登录了。
   *
   * **① 必须优先于 ②。** 否则会出现这种情况：用户其实是已登录的，
   * 但这次回调失败了（比如在知乎页点了「拒绝」），带 `?oauth=denied` 回来，
   * 结果被自动跳转直接送进 /home —— 用户永远看不到"授权失败"的原因。
   * 报错信息优先于便利性。
   *
   * ② **已登录就直接进 /home**。
   *    手机端"授权后又跳回登录页"的最后一段就是这个：回调已经把会话
   *    Cookie 种好了，即使中间某一步判定未登录把用户送回 `/`，
   *    这里也能立刻把他送回 `/home`，而不是停在登录页让人以为没登上。
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthErr = params.get("oauth");
    const detail = params.get("detail");

    /* ① 回调失败：先报错并留在登录页，不做自动跳转。
       报错优先于便利性 —— 否则"已登录但这次授权失败"的用户会被直接送进
       /home，永远看不到失败原因。 */
    if (oauthErr) {
      sawAuthError.current = true;
      setError(oauthErrorText(oauthErr, detail));
      setErrorCode(oauthErr);
      /* ⚠️ 不要用 replaceState 把 `?oauth=` 从地址栏抹掉。
         以前抹掉是为了"刷新不再被同一条错误拦住"，代价是失败原因彻底消失：
         用户来反馈时既看不到原因，服务端日志也没有细节，只能靠猜。
         现在保留参数（页面上也会显示错误代码），刷新会再次看到同一条提示，
         点一次登录即可重试。 */
    }

    /* ② 已登录：直接进主界面（除非本次加载报过错，见 sawAuthError 说明）。
       手机端"授权后又跳回登录页"的最后一段就是这个：回调已经把会话 Cookie
       种好了，即使中间某一步判定未登录把用户送回 `/`，这里也能立刻把他送回
       `/home`，而不是停在登录页让人以为没登上。

       ⚠️ 这一步**不再影响按钮可用性**：探测慢的时候按钮依然能点（见 startLogin）。 */
    let cancelled = false;
    if (!sawAuthError.current) {
      void (async () => {
        try {
          const s = await probeSession();
          /* 再次确认：等请求回来时若已出现过报错，就不要再跳走 */
          if (!cancelled && !sawAuthError.current && s?.authenticated) {
            router.replace("/home");
          }
        } catch {
          /* 查不到就当未登录，正常展示登录卡片 */
        }
      })();
    }

    /* ⚠️ 清理只做"别再 setState"，**不要**拦 router.replace。
       原因：React 19 的 StrictMode 会把 effect 跑两遍（挂载→清理→再挂载）。
       第一遍的清理会把 cancelled 置 true，真正生效的是第二遍；
       如果这里连替换路由一起拦掉，已登录用户就永远停在登录页。
       这是实际踩过的坑（症状：/ 明明已登录却不跳转）。 */
    return () => {
      cancelled = true;
    };
  }, [router, probeSession]);

  /**
   * 登录。
   *
   * 关键：**不要写死走哪条路**。先问服务端「知乎 OAuth 配置好了没有」：
   *   ① 配好了 → 跳到 `/api/auth/zhihu`，由服务端生成 state 并 302 到知乎授权页
   *   ② 没配好 → 非生产环境回退演示登录（本地开箱可用）
   *              生产环境则报错提示，**不静默降级**（否则演示数据会被当成真实登录）
   *
   * 之前这里写死调 `/api/auth/demo`，导致即便配好了 OAuth 也永远跳不到知乎授权页。
   *
   * ⚠️ 这里**不能无限等**探测结果。手机端这个请求可能要一两秒，
   *    按钮点下去毫无反应就会被当成"点不动"（用户实际反馈）。
   *    所以最多等 PROBE_WAIT_MS：超时按"已配置"处理，直接跳真实授权 ——
   *    万一真没配置，`/api/auth/zhihu` 会自己带 `?oauth=unconfigured` 回来，
   *    页面上仍然给出明确提示，不会变成死胡同。
   */
  const startLogin = useCallback(async () => {
    setBusy(true);
    setError("");
    setErrorCode(null);
    try {
      /* ① 探测服务端配置状态（复用挂载时那一次请求，超时兜底） */
      const probe = await Promise.race<SessionProbe>([
        probeSession(),
        new Promise<SessionProbe>((resolve) =>
          setTimeout(() => resolve({ oauthConfigured: true }), PROBE_WAIT_MS),
        ),
      ]);
      const oauthConfigured = probe?.oauthConfigured !== false;

      if (oauthConfigured) {
        /* ② 走真实知乎授权（服务端会 302 到 openapi.zhihu.com/authorize） */
        window.location.href = `/api/auth/zhihu?returnTo=${encodeURIComponent("/home")}`;
        return;
      }

      /* ③ 未配置：本地/预发用演示登录；生产环境明确报错，不静默降级 */
      const resp = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "知遇演示用户" }),
      });
      const data = (await resp.json()) as
        | { ok: true; userId: string; personaId: string }
        | { ok: false; error?: string; code?: string };
      if (!data.ok) {
        throw new Error(
          data.code === "DEMO_DISABLED"
            ? "知乎授权尚未配置完成，暂时无法登录。"
            : (data.error ?? "登录失败"),
        );
      }
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ userId: data.userId, personaId: data.personaId }),
        );
      } catch {
        /* 隐私模式下 localStorage 不可用，不影响本次会话 */
      }
      router.push("/home");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [router, probeSession]);

  return (
    <>
      <header className={styles.topnav}>
        <div className={`${styles.container} ${styles.topnavInner}`}>
          <a className={styles.brand} href="#login-hero" aria-label="知遇 回到顶部">
            <span className="brandPlate">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/logo/logo-104.png"
                srcSet="/assets/logo/logo-52.png 1x, /assets/logo/logo-104.png 2x, /assets/logo/logo-256.png 4x"
                width={104}
                height={104}
                alt=""
              />
            </span>
            <span className={styles.brandName}>知遇</span>
          </a>
          <nav aria-label="页内导航">
            <a href="#concept">产品理念</a>
            <a href="#how">认识三步</a>
            <a href="#agent-chat">Agent 先聊</a>
          </nav>
        </div>
      </header>

      <main id="content">
        {/* ① 登录视口 */}
        <section className={styles.loginHero} id="login-hero">
          <div className={`${styles.orb} ${styles.orb1}`} aria-hidden="true" />
          <div className={`${styles.orb} ${styles.orb2}`} aria-hidden="true" />

          <div className={`${styles.container} ${styles.loginInner}`}>
            <Reveal>
              <div className={styles.heroCopy}>
                <p className="eyebrow">知遇 · AI 认识人</p>
                <h1>在你认识一个人之前，让 Agent 先认识 TA。</h1>
                <p className={styles.lead}>
                  知遇让代表你的 Agent，先去认识对方的 Agent：聊兴趣、聊观点、聊思维方式，再把真正同频的人带到你面前。
                </p>
                <div className={styles.tagRow}>
                  <span className={styles.tag}>不贴标签，只理解你</span>
                  <span className={styles.tag}>先聊，再认识</span>
                  <span className={styles.tag}>兴趣 · 思维 · 价值观</span>
                </div>
                <a className="btn btnGhost btnArrow" href="#concept" style={{ marginTop: 30 }}>
                  先看看它怎么工作
                </a>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className={styles.authCardCol}>
                <section className={styles.authCard} aria-label="登录知遇">
                  <div className={styles.authHead}>
                    <span className="brandPlate brandPlateLg" style={{ margin: "0 auto 20px" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/assets/logo/logo-104.png"
                        srcSet="/assets/logo/logo-52.png 1x, /assets/logo/logo-104.png 2x, /assets/logo/logo-256.png 4x"
                        width={104}
                        height={104}
                        alt=""
                      />
                    </span>
                    <h2 className={styles.authTitle}>登录知遇</h2>
                    <p className={styles.authSub}>
                      用知乎账号开启你的 Agent 社交——它先从你的公开表达里，学习你是什么样的人。
                    </p>
                  </div>

                  <div className={styles.divider}>
                    <span>请选择登录方式</span>
                  </div>

                  <button
                    className={`btn oauthBtn ${styles.oauthBtn}`}
                    type="button"
                    onClick={startLogin}
                    disabled={busy}
                    aria-busy={busy}
                  >
                    {/* 知乎官方 logo 是白色描边，因此只放在知乎蓝实心按钮上 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className={styles.oauthGlyph}
                      src="/assets/brand/zhihu-logo.png"
                      width={88}
                      height={45}
                      alt=""
                    />
                    <span>{busy ? "正在登录…" : "使用知乎账号登录"}</span>
                  </button>

                  <p className={styles.terms}>
                    继续即表示你同意知遇的用户协议与隐私政策。知遇仅在你授权后读取知乎公开资料，用于生成你的 Agent。
                  </p>

                  {error ? (
                    <p className={styles.terms} role="alert" style={{ color: "var(--danger)" }}>
                      登录失败：{error}
                      {errorCode ? (
                        <span className="meta" style={{ display: "block", marginTop: 4 }}>
                          错误代码：{errorCode}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </section>
                <p className="meta" style={{ textAlign: "center", marginTop: 12 }}>
                  已接入知乎开放平台 · 授权后可同步你的公开内容
                </p>
              </div>
            </Reveal>
          </div>

          <a className={styles.scrollCue} href="#concept">
            下滑了解知遇
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </a>
        </section>

        {/* ② 概念流转 */}
        <section className={styles.section} id="concept">
          <div className={`${styles.container} ${styles.conceptGrid}`}>
            <Reveal>
              <div>
                <p className="eyebrow">一次认识方式的升级</p>
                <h2>认识一个人，不再从试探与尬聊开始。</h2>
                <p className={styles.lead} style={{ marginTop: 20 }}>
                  知遇把“人 → 人”的社交，升级为“人 → Agent → Agent → 人”：先让了解你的 Agent 去见了解 TA 的 Agent。
                </p>
                <p style={{ margin: "22px 0 0", color: "var(--fg)", fontSize: 15, lineHeight: 1.8 }}>
                  两个 Agent 聊完，都觉得
                  <em style={{ fontStyle: "normal", color: "var(--muted)" }}>
                    “这个人，好像挺有意思”
                  </em>
                  时，才轮到你们真正认识彼此。
                </p>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className={styles.flowCard}>
                <div className={styles.flow}>
                  {FLOW.map((label, i) => (
                    <span key={label} style={{ display: "contents" }}>
                      {i > 0 ? (
                        <span className={styles.flowArrow} aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </span>
                      ) : null}
                      <div className={styles.flowNode}>
                        <span className={`num ${styles.flowNum}`}>{`0${i + 1}`}</span>
                        <strong>{label}</strong>
                      </div>
                    </span>
                  ))}
                </div>
                <p className={styles.flowNote}>
                  中间这两步由你的 Agent 完成——
                  <strong style={{ fontWeight: 600, color: "var(--fg)" }}>先聊，再认识</strong>。
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ③ 三步机制 */}
        <section className={styles.section} id="how">
          <div className={`${styles.container} ${styles.stack}`} style={{ gap: 60 }}>
            <Reveal>
              <div className={styles.centerHead} style={{ maxWidth: "44ch" }}>
                <p className="eyebrow">三步，把“我”交给 Agent</p>
                <h2>每一步都在回答：它凭什么能代表我？</h2>
                <p className={styles.lead} style={{ margin: "18px auto 0" }}>
                  六种人格来源可以任选其一，也可以全部完成。数据越丰富，Agent 对你的理解就越完整。
                </p>
              </div>
            </Reveal>

            <div className={styles.grid3}>
              {STEPS.map((s, i) => (
                <Reveal key={s.index} delay={i * 80}>
                  <article className={styles.howCard}>
                    <span className={`num ${styles.howIndex}`}>{s.index}</span>
                    <h3>{s.title}</h3>
                    <p className={styles.howDesc}>{s.desc}</p>

                    {"sources" in s ? (
                      <ul className={styles.srcList}>
                        {s.sources.map(([name, side]) => (
                          <li key={name}>
                            <b>{name}</b>
                            <span>{side}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {"quote" in s ? (
                      <blockquote className={styles.miniQuote}>{s.quote}</blockquote>
                    ) : null}

                    {"chips" in s ? (
                      <div className={styles.matchChips}>
                        {s.chips.map((c) => (
                          <span key={c} className={styles.tag}>
                            {c}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ④ Agent 先聊 + 匹配报告 */}
        <section className={styles.section} id="agent-chat">
          <div
            className={`${styles.container} ${styles.stack}`}
            style={{ gap: "clamp(36px, 5vw, 56px)" }}
          >
            <Reveal>
              <div className={styles.centerHead}>
                <p className="eyebrow">先聊，再认识</p>
                <h2>如果你对 TA 感兴趣，让 Agent 先去聊。</h2>
                <p className={styles.lead} style={{ margin: "18px auto 0" }}>
                  两个 Agent 围绕能暴露兴趣、价值观与思维的话题交谈——聊完，再决定要不要认识本人。
                </p>
              </div>
            </Reveal>

            <div className={styles.chatGrid}>
              <Reveal>
                <div className={styles.surfaceCard}>
                  <div className={styles.chatHead}>
                    <div className={styles.agentMini}>
                      <span className={styles.agentAvatar}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/assets/characters/self.webp" alt="" />
                      </span>
                      <span className={styles.agentAvatar}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/assets/characters/newfriend.webp" alt="" />
                      </span>
                      <div>
                        <p className={styles.chatTitle}>你的 Agent × TA 的 Agent</p>
                        <p className={styles.chatSub}>
                          正在展开第一次对话
                          <span className={styles.typing} aria-label="对话中">
                            <i />
                            <i />
                            <i />
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {CHAT.map((line, i) => (
                    <div
                      key={i}
                      className={`${styles.chatLine} ${line.who === "b" ? styles.chatLineB : ""}`}
                    >
                      <span className={styles.agentAvatar}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={line.avatar} alt="" />
                      </span>
                      <p className={styles.bubble}>{line.text}</p>
                    </div>
                  ))}

                  <p className={styles.chatFootnote}>
                    以上为 Agent 对话示意；正式对话基于你的授权数据生成。
                  </p>
                </div>
              </Reveal>

              <Reveal delay={120}>
                <div className={styles.surfaceCard}>
                  <div className={styles.reportHead}>
                    <h3>Agent 匹配报告</h3>
                    <span className="meta">示例报告</span>
                  </div>

                  {REPORT.map(([label, val], i) => (
                    <div
                      key={label}
                      className={`${styles.reportRow} ${i === 0 ? styles.reportRowFirst : ""}`}
                    >
                      <span className={styles.reportLabel}>{label}</span>
                      <span className="track">
                        <i className="trackFill" style={{ width: `${val}%` }} />
                      </span>
                      <span className={`num ${styles.reportVal}`}>{val}%</span>
                    </div>
                  ))}

                  <div className={styles.reportTotal}>
                    <span style={{ fontSize: 14 }}>综合匹配度</span>
                    <strong className="num">87%</strong>
                  </div>

                  <p className={styles.reportNote}>
                    为什么推荐你认识 TA？—— 两个 Agent 都觉得：
                    <em style={{ fontStyle: "normal" }}>“这个人，好像挺有意思。”</em>
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ⑤ 金句 */}
        <section className={styles.section} id="quote">
          <div className={`${styles.container} ${styles.quoteWrap}`}>
            <Reveal>
              <p className="eyebrow" style={{ marginBottom: 24 }}>
                知遇的匹配观
              </p>
              <blockquote className={styles.quote}>
                “真正适合认识的人，不一定是最像你的人。”
              </blockquote>
              <p className={styles.quoteAuthor}>知遇 · 五维匹配理念</p>
            </Reveal>
          </div>
        </section>

        {/* ⑥ 收尾 CTA */}
        <section className={styles.section} id="cta-strip" style={{ paddingTop: 0 }}>
          <div className={styles.container} style={{ maxWidth: 880 }}>
            <Reveal>
              <div className={styles.ctaShell}>
                <p className="eyebrow">然后，由你们认识彼此</p>
                <h2>先让你的 Agent 认识 TA 的 Agent。</h2>
                <p className={styles.lead}>再由你们，真正认识彼此。</p>
                <button
                  className={`btn btnPrimary ${styles.ctaBtn}`}
                  type="button"
                  onClick={startLogin}
                  disabled={busy}
                >
                  {busy ? "正在登录…" : "使用知乎账号登录"}
                </button>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className={styles.pagefoot}>
        <div className={`${styles.container} ${styles.rowBetween}`}>
          <span>© 2026 知遇 · 知乎黑客松「灵魂匹配局」赛道作品</span>
          <span>让 Agent 先替你认识一个人</span>
        </div>
      </footer>
    </>
  );
}
