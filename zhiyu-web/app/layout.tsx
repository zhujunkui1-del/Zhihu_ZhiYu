import type { Metadata } from "next";
import GlobalToasts from "@/components/GlobalToasts";
import "./globals.css";

export const metadata: Metadata = {
  title: "知遇｜让 Agent 先替你认识一个人",
  description:
    "知遇 ZhiYu：基于多源人格（微信 / QQ / 飞书 / 钉钉 / 知乎 / SBTI）与 AI Agent 的人格匹配与兴趣社交平台。",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {/* 全局报错弹幕：挂在根 layout，任何页面的报错都在这里出现。
            它同时负责安装「未捕获异常 / 未处理接口失败」的全局捕获。 */}
        <GlobalToasts />
      </body>
    </html>
  );
}
