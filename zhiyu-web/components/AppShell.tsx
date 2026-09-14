"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import NavProgress from "./NavProgress";
import type { SidebarUser } from "@/lib/sidebar-user";
import { characterAvatar } from "@/lib/sidebar-user";
import styles from "./AppShell.module.css";

/** 主导航项。顺序与原型侧栏一致。 */
const NAV = [
  { href: "/home", label: "首页", icon: <path d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" /> },
  {
    href: "/find",
    label: "发现",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m15.8 8.2-2.6 5.2-5.2 2.6 2.6-5.2z" />
      </>
    ),
  },
  {
    href: "/persona",
    label: "我的人格",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-3.9 3.6-6 8-6s8 2.1 8 6" />
      </>
    ),
  },
  {
    href: "/agent-match",
    label: "Agent 匹配",
    icon: (
      <>
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8.5 9.5h7M8.5 13h4" />
      </>
    ),
  },
  {
    href: "/notify",
    label: "通知",
    icon: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
  },
];

const SETTINGS = {
  href: "/settings",
  label: "设置",
  icon: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M2 14h4M10 8h4M18 16h4" />
    </>
  ),
};

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

interface Props {
  children: React.ReactNode;
  /**
   * 导航项「Agent 匹配」是否显示"后台有会话进行中"的小圆点。
   * 因为「让我的 Agent 先聊聊」不再跳页，需要这个提示补偿进度线索。
   */
  agentRunning?: boolean;
  /** 侧栏底部展示的用户身份（头像 + 名称），由 layout 在服务端解析好 */
  user: SidebarUser;
}

/**
 * 应用外壳：侧栏 + 主内容区。
 * 登录页不使用本组件（它有自己的全屏布局）。
 */
export default function AppShell({ children, agentRunning = false, user }: Props) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const [avatarFailed, setAvatarFailed] = useState(false);

  /* 知乎头像挂在 zhimg.com，加载失败时退到本地角色插画，绝不留裂图 */
  const avatarSrc =
    user.kind === "zhihu" && avatarFailed ? characterAvatar("self") : user.avatar;

  return (
    <div className={`app-shell ${styles.shell}`}>
      {/* 顶部导航进度条：fixed 定位，不占布局、不挡点击 */}
      <NavProgress />
      <aside className={styles.sidebar}>
        <Link className={styles.sideBrand} href="/home" aria-label="知遇首页">
          <span className={styles.brandRow}>
            <span className={styles.brandPlate}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/assets/logo/logo-104.png"
                srcSet="/assets/logo/logo-52.png 1x, /assets/logo/logo-104.png 2x, /assets/logo/logo-256.png 4x"
                width={104}
                height={104}
                alt=""
              />
            </span>
            <span>
              <span className={styles.brandWord}>知遇</span>
              <span className={styles.brandTag}>先认识，再相遇</span>
            </span>
          </span>
        </Link>

        <nav className={styles.sideNav} aria-label="主导航">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                aria-current={active ? "page" : undefined}
              >
                <NavIcon>{item.icon}</NavIcon>
                <span>{item.label}</span>
                {item.href === "/agent-match" && agentRunning ? (
                  <span className={styles.navRunningDot} aria-label="后台有进行中的 Agent 对话" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className={styles.sideFoot}>
          {/* 用户身份：圆形头像 + 名称，**无交互**（不是按钮、不跳转）。
              知乎头像抓不到时用 assets/characters 的随机插画 + zhiyu000000 兜底。 */}
          <div className={styles.sideUser} data-side-user="1">
            <span className={styles.sideUserAvatar}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarSrc}
                width={72}
                height={72}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setAvatarFailed(true)}
              />
            </span>
            <span className={styles.sideUserName} title={user.name}>
              {user.name}
            </span>
          </div>

          <Link
            href={SETTINGS.href}
            className={`${styles.navItem} ${isActive(SETTINGS.href) ? styles.navItemActive : ""}`}
            aria-current={isActive(SETTINGS.href) ? "page" : undefined}
          >
            <NavIcon>{SETTINGS.icon}</NavIcon>
            <span>{SETTINGS.label}</span>
          </Link>
        </div>

        <div className={styles.sideStory} aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/decor/signboard.png" alt="" />
          <p>认识有趣的人和世界</p>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.mainInner}>{children}</div>
      </main>
    </div>
  );
}
