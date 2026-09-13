import AppShell from "@/components/AppShell";

/**
 * 主应用外壳。登录页不在本组内，用自己的全屏布局。
 *
 * agentRunning 目前固定 false —— 后台会话状态等「让我的 Agent 先聊聊」
 * 的数据接线完成后，改为从服务端读取（localStorage 方案仅原型期使用）。
 */
export default function AppGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell agentRunning={false}>{children}</AppShell>;
}
