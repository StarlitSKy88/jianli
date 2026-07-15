/**
 * robots.txt — Next.js 14 App Router 约定式生成
 *
 * 策略：
 * - 公共页面 Allow
 * - /api/* /admin/* Disallow（搜索引擎不需要爬）
 * - /interview/[id]* 高基数动态页也 Disallow（防 sitemap 爆 + 防 dirty URL 收录）
 * - sitemap 指向 /sitemap.xml
 */

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jianli.taomyst.top';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/legal/', '/register', '/login', '/interview/new'],
        disallow: ['/api/', '/admin/', '/interview/*/report', '/interview/*/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
