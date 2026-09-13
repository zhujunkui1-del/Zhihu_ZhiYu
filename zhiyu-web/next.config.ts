import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 开发期允许的额外来源。
   *
   * Next.js 16 默认**拦截跨源请求 dev 资源**（/_next/hmr 等）。
   * dev server 以 `localhost` 启动，而自动化脚本/浏览器常用 `127.0.0.1`
   * 访问——两者源不同，会被拦截，表现为**整站 hydration 静默失效**：
   * 页面 HTML 正常渲染，但客户端 JS 不执行、事件不绑定、零报错。
   * 这个症状极易被误判成"我的组件写错了"。
   *
   * 只影响开发模式，不影响任何生产行为。
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
