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

  // EdgeOne Edge Functions 兼容（Prisma + bcrypt 不要打包）
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],

  // Phase 14.12 ROOT CAUSE 修复：
  //   EdgeOne Pages 镜像 = Amazon Linux 2 + OpenSSL 1.1.1
  //   prisma 客户端探测 runtime → 要求 libquery_engine-rhel-openssl-1.1.x.so.node
  //   之前 binaryTargets 只有 3.0.x → 永远找不到 → throw 500
  // 必须显式追踪所有 engine binary（含 rhel-openssl-1.1.x）：
  // pnpm 把真实文件放在 .pnpm/@prisma+client*/node_modules/.prisma/client/
  // node_modules/.prisma/client/ 是软链接，但 outputFileTracing 不解析 symlink
  // → 用 .pnpm 通配直接抓真实路径
  outputFileTracingIncludes: {
    '**': [
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-1.1.x.so.node',
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node',
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/schema.prisma',
    ],
  },
};

module.exports = nextConfig;
