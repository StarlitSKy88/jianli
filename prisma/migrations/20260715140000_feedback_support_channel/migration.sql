-- Phase 13.5 客服通道 / 用户反馈（Feedback）
--
-- 设计目标：
-- - 匿名可用 + 已登录用户自动关联
-- - 联系方式 + 联系邮箱用于运营回复
-- - 同 IP / 邮箱 限流（应用层 anti-abuse 防刷）
-- - 邮件通知 support@taomyst.top
-- - admin 角色可标记 resolved
--
-- FeedbackCategory: BUG | UX | FEATURE | ACCOUNT | OTHER
-- FeedbackStatus:   PENDING | IN_PROGRESS | RESOLVED | SPAM
-- (MySQL 不支持 ENUM，用 String + 应用层校验)

-- 1. 新增 feedbacks 表
CREATE TABLE `feedbacks` (
  `id`           VARCHAR(30)  NOT NULL,
  `userId`       VARCHAR(30)  NULL,                 -- 匿名（null）/ 已登录用户（cuid）
  `category`     VARCHAR(20)  NOT NULL,             -- FeedbackCategory
  `content`      TEXT         NOT NULL,
  `contactEmail` VARCHAR(254) NULL,                 -- 用户留的联系方式（可空）
  `userAgent`    TEXT         NULL,                 -- 浏览器 UA，辅助排查问题
  `ipAddress`    VARCHAR(64)  NULL,                 -- 用户 IP（用于限流 + 反垃圾）
  `status`       VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  `resolvedAt`   DATETIME(3)  NULL,
  `resolvedBy`   VARCHAR(30)  NULL,                 -- admin userId
  `adminNote`    TEXT         NULL,
  `createdAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `feedbacks_status_createdAt_idx` (`status`, `createdAt`),
  KEY `feedbacks_ipAddress_createdAt_idx` (`ipAddress`, `createdAt`),
  KEY `feedbacks_userId_createdAt_idx` (`userId`, `createdAt`),
  CONSTRAINT `feedbacks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
