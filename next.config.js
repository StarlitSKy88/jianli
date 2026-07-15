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

  // Phase 14.7: output: 'standalone' 默认只追踪 native binary，
  // 其它 3 个 linux engine binary 不会被 copy 进 .next/standalone，
  // → EdgeOne 部署后 throw "could not locate Query Engine for runtime rhel-openssl-1.1.x"
  // 必须显式声明追踪所有 engine binary：
  // pnpm 把真实文件放在 .pnpm/@prisma+client*/node_modules/.prisma/client/
  // node_modules/.prisma/client/ 是软链接，但 outputFileTracing 不解析 symlink
  // → 用 .pnpm 通配直接抓真实路径
  outputFileTracingIncludes: {
    '**': [
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node',
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node',
      './node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/.prisma/client/schema.prisma',
      './node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-darwin-arm64.dylib.node',
      './node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-linux-musl-openssl-3.0.x.so.node',
      './node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/libquery_engine-rhel-openssl-3.0.x.so.node',
    ],
  },
};

module.exports = nextConfig;
