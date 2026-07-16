/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // 复利工程：开启 typedRoutes（强类型路由）
  experimental: {
    typedRoutes: true,
    serverActions: {
      bodySizeLimit: '10mb', // 简历上传 5MB + 缓冲
    },
  },

  // ============================================
  // EdgeOne Pages 兼容
  // ============================================
  output: 'standalone', // 独立部署，减小函数包
  poweredByHeader: false, // 安全：不暴露 X-Powered-By
  compress: true, // 启用 gzip
  productionBrowserSourceMaps: false, // EdgeOne 不需要 sourcemap，减小部署体积

  // SSE 流式响应配置（关键：面试 chat 流）
  async headers() {
    return [
      {
        source: '/api/interview/:id/message',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-transform' },
          { key: 'X-Accel-Buffering', value: 'no' }, // 关闭 Nginx 缓冲
          { key: 'Connection', value: 'keep-alive' },
        ],
      },
    ];
  },
  // Phase 14.22 ROOT CAUSE 修复：EdgeOne Pages cloud-functions 128MiB 上限
  // Prisma + bcryptjs 不打包进 webpack bundle（运行时从 node_modules 解析）
  // 注意：Next.js 14.2 用 serverComponentsExternalPackages（15.x 才改成 serverExternalPackages）
  serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs'],
};

module.exports = nextConfig;
