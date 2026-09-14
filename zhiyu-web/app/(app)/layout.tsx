import AppShell from "@/components/AppShell";
import { resolveIdentity } from "@/lib/auth/current-user";
import { resolveSidebarUser } from "@/lib/sidebar-user";

/**
 * 主应用外壳。登录页不在本组内，用自己的全屏布局。
 *
 * 侧栏的用户头像 + 名称（#8）在这里解析：身份只来自 HttpOnly 会话，
 * 拿不到知乎信息时由 `resolveSidebarUser` 稳定兜底成
 * `zhiyu000000` 形态的用户名 + 本地角色插画。
 *
 * agentRunning 目前固定 false —— 后台会话状态等「让我的 Agent 先聊聊」
 * 的数据接线完成后，改为从服务端读取（localStorage 方案仅原型期使用）。
 */
export default async function AppGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await resolveIdentity();
  const user = resolveSidebarUser(
    me ? { id: me.userId, displayName: me.displayName, avatarUrl: me.avatarUrl } : null,
  );

  return (
    <AppShell agentRunning={false} user={user}>
      {children}
    </AppShell>
  );
}
