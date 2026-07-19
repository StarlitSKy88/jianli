---
id: bug-2026-07-20-027
title: 缺 og:image / Twitter Card / iOS Safari meta
category: bug
severity: medium
tags: [seo, og-image, twitter-card, ios-safari, pwa]
created_at: 2026-07-20
project: interview-buddy

problem: |
  E2E agent #6 报告：分享到微信/微博/X 时无预览图（缺 og:image），
  Twitter 不识别为 summary_large_image，分享卡片空白。
  iOS Safari 添加到主屏无标题/状态栏样式。

root_cause: |
  app/layout.tsx metadata 只配了 openGraph 但缺 images 字段。
  twitter / appleWebApp / themeColor / formatDetection 全缺失。

solution: |
  补全 layout.tsx metadata：
  - openGraph.images: /og-image.png (1200×630)
  - twitter.card: summary_large_image
  - appleWebApp.capable / title / statusBarStyle
  - themeColor: #0a0a0a
  - applicationName: Interview Buddy
  - formatDetection: { telephone: false, email: false, address: false }

  生成 public/og-image.png (1200×630 PNG，6.6KB)：
  用 scripts/gen-og-image.js（纯 Node zlib + 自制 5x7 bitmap font，无外部依赖）

verification:
  file: file og-image.png → PNG image data, 1200x630, 8-bit/color RGB
  build: next build 通过（/public 自动服务）
  preview: 待 Phase 15+ Facebook Sharing Debugger + Twitter Card Validator 验证

learned_from:
  - file: app/layout.tsx
  - file: public/og-image.png
  - file: /tmp/gen-og-image.js（可挪到 scripts/）

prevention:
  - 上线前必查 og:image / twitter.card / appleWebApp 三件套
  - 用 https://www.opengraph.xyz/ 验证分享卡片预览
  - iOS Safari 添加到主屏后必测 statusBarStyle 生效