import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
