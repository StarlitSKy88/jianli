/**
 * sitemap.xml — Next.js 14 App Router 约定式生成
 *
 * 作用：让 Google / 百度 / Bing 在收录时知道哪些 URL 存在 + 优先级 + 更新频率
 *
 * 安全：
 * - baseUrl 严格用 NEXT_PUBLIC_APP_URL（环境变量注入，不允许从请求拼）
 * - 9 个路由静态列出来（不扫数据库，避免动态路由被注入伪 URL）
 *
 * 路径：
 * - /                      首页            priority 1.0  weekly
 * - /login                 登录           priority 0.6  monthly
 * - /register              注册           priority 0.8  monthly
 * - /interview/new         开始面试       priority 0.9  weekly
 * - /legal/privacy         隐私          priority 0.3  yearly
 * - /legal/terms           用户协议      priority 0.3  yearly
 *
 * 排除（不收录）：
 * - /admin/*              管理后台 — 蜘蛛爬了也没意义反而泄露
 * - /api/*                API 路由
 * - /interview/[id]/report 动态报告 — 高基数 URL 会让 sitemap 爆炸
 * - /interview/[id]        动态面试实例
 */

import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jianli.taomyst.top';
  const lastModified = new Date();

  return [
    {
      url: `${baseUrl}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/register`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/interview/new`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/login`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/legal/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/legal/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];
}
