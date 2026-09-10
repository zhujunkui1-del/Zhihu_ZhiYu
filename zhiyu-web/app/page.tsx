import Link from "next/link";
import DemoLoginButton from "@/components/DemoLoginButton";
import Reveal from "@/components/Reveal";

export default function LandingPage() {
  return (
    <>
      <header className="topnav">
        <div className="wrap topnav-inner">
          <Link href="/" className="brand">
            <span className="brand-dot">知</span>
            知遇
          </Link>
          <nav className="nav-links">
            <a href="#product">产品理念</a>
            <a href="#steps">认识三步</a>
            <a href="#agent">Agent 先聊</a>
            <a href="#login">登录知遇</a>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero" id="product">
          <div className="wrap hero-grid">
            <Reveal>
              <p className="eyebrow">知遇 · AI 认识人</p>
              <h1>在你认识一个人之前，让 Agent 先认识 TA。</h1>
              <p className="hero-lead">
                知遇让代表你的 Agent，先去认识对方的 Agent：聊兴趣、聊观点、聊思维方式，再把真正同频的人带到你面前。
              </p>
              <div className="hero-points">
                <span className="pill">不贴标签，只理解你</span>
                <span className="pill">先聊，再认识</span>
                <span className="pill">兴趣 · 思维 · 价值观</span>
              </div>
              <div className="hero-actions">
                <a className="btn btn-primary" href="#agent">
                  先看看它怎么工作
                </a>
                <a className="btn btn-secondary" href="#login">
                  登录知遇
                </a>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="hero-card">
                <div className="chain">
                  <div className="chain-step">
                    <span className="idx">01</span> 你
                  </div>
                  <div className="chain-step highlight">
                    <span className="idx">02</span> 你的 Agent
                  </div>
                  <div className="chain-step highlight">
                    <span className="idx">03</span> TA 的 Agent
                  </div>
                  <div className="chain-step">
                    <span className="idx">04</span> TA
                  </div>
                </div>
                <p className="meta" style={{ marginTop: 14 }}>
                  中间这两步由你的 Agent 完成——先聊，再认识。
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <Reveal>
              <h2>一次认识方式的升级</h2>
              <p className="section-lead">
                认识一个人，不再从试探与尬聊开始。知遇把“人 → 人”的社交，升级为“人 → Agent → Agent →
                人”：先让了解你的 Agent 去见了解 TA 的 Agent。两个 Agent 聊完都觉得“这个人，好像挺有意思”时，才轮到你们真正认识彼此。
              </p>
            </Reveal>
          </div>
        </section>

        <section className="section" id="steps">
          <div className="wrap">
            <Reveal>
              <h2>三步，把“我”交给 Agent</h2>
              <p className="section-lead">
                每一步都在回答：它凭什么能代表我？多个人格来源可以任选其一，也可以全部完成；数据越丰富，Agent
                对你的理解就越完整。
              </p>
            </Reveal>
            <div className="cards">
              <Reveal delay={80}>
                <div className="card">
                  <div className="how-index">01</div>
                  <h3>把“我”交给 Agent</h3>
                  <p>从不同侧面认识真实的你：聊出来的、表达出来的，以及你眼中的自己。</p>
                  <div className="source-tags">
                    <span className="pill">微信 · 真实的我</span>
                    <span className="pill">QQ · 真实的我</span>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={160}>
                <div className="card">
                  <div className="how-index">02</div>
                  <h3>生成“我的 Agent”</h3>
                  <p>
                    把信息融成属于你的 Persona，不靠几个标签草率定义。它知道你为什么喜欢、怎么思考，以及和什么样的人聊得来。
                  </p>
                  <div className="source-tags">
                    <span className="pill">知乎 · 表达的我</span>
                    <span className="pill">SBTI · 认识的我</span>
                  </div>
                </div>
              </Reveal>
              <Reveal delay={240}>
                <div className="card">
                  <div className="how-index">03</div>
                  <h3>让 Agent 替你去认识</h3>
                  <p>两个 Agent 先围绕兴趣、价值观与思维方式聊一聊，聊完再决定你们要不要认识。</p>
                  <div className="source-tags">
                    <span className="pill">飞书 · 职场</span>
                    <span className="pill">钉钉 · 职场</span>
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="section" id="agent">
          <div className="wrap">
            <Reveal>
              <h2>先让两个 Agent 聊聊</h2>
              <p className="section-lead">
                两个 Agent 会围绕一些能够暴露兴趣、价值观和思维方式的话题进行交流，比如：“如果突然获得一周完全自由的时间，你会怎么安排？”
                “一个和你观点完全不同的人，你更愿意说服 TA，还是理解 TA？”
              </p>
            </Reveal>
            <div className="cards">
              <Reveal delay={80}>
                <div className="card">
                  <div className="how-index">兴趣同频</div>
                  <p>你们是否喜欢相似的事情，长期关注相似的领域。</p>
                </div>
              </Reveal>
              <Reveal delay={160}>
                <div className="card">
                  <div className="how-index">思维共振</div>
                  <p>理解问题的方式是否接近，是不是能接住彼此的思路。</p>
                </div>
              </Reveal>
              <Reveal delay={240}>
                <div className="card">
                  <div className="how-index">互补程度</div>
                  <p>不一定是最像的人，但可能是最能带来碰撞与成长的人。</p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        <section className="section" id="login">
          <div className="wrap">
            <Reveal>
              <div className="login-card">
                <h2>登录知遇</h2>
                <p style={{ marginTop: 10 }}>
                  用知乎账号开启你的 Agent 社交——它先从你的公开表达里，学习你是什么样的人。
                </p>
                <div className="login-actions">
                  <DemoLoginButton />
                </div>
                <p className="login-note">
                  演示状态：真实 OAuth 接入后，此处将跳转知乎授权页。知遇仅在你授权后读取知乎公开资料，用于生成你的 Agent。
                </p>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="section">
        <div className="wrap meta">
          © 2026 知遇 · 知乎黑客松「灵魂匹配局」赛道作品 · 让 Agent 先替你认识一个人
        </div>
      </footer>
    </>
  );
}
