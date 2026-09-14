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

  experimental: {
    /**
     * 客户端路由缓存时长。
     *
     * 为什么必须配：本项目所有页面都用了 `export const dynamic = "force-dynamic"`
     * （因为要读会话 Cookie）。这类页面在文档里属于 "dynamic"，
     * 其 `staleTimes.dynamic` **默认是 0 秒 —— 即完全不缓存**。
     *
     * 后果（实测）：从 A 页跳到 B 页、再跳回 A 页，A 页仍要重新请求服务端
     * 并重新查库。实测"冷导航 753ms / 回访 740ms"，几乎一样慢。
     * 配上之后，短时间内回到已访问页面会直接命中客户端缓存。
     *
     * 取值权衡：
     *   · 太长 → 数据陈旧（比如刚同步完知乎，回首页还是旧数据）
     *   · 太短 → 失去意义
     * 30 秒对"浏览—返回"这种交互足够，且用户主动操作（同步、提交）
     * 后我们会调 `router.refresh()` 强制刷新，不依赖这个时长。
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
