-- Phase 13.8 修复 #134：Resume dedup 从全局唯一改为 per-user 复合唯一
--
-- 之前：fileHash @unique 全局唯一
-- 问题：不同 user 上传相同文件触发 P2002，race recovery 也找不到自己 user 的记录
-- 解决：删除全局唯一，添加 (userId, fileHash) 复合唯一
--
-- 数据安全：
-- - 现有数据中 user A 的 fileHash_A 和 user B 的 fileHash_A（如果存在）会冲突
-- - 但实际场景：fileHash 是 SHA256 哈希，正常用户不会撞到相同 hash
-- - 异常情况：upload/route.ts 的 try/catch P2002 会兜底处理

-- 1. 删除全局唯一索引
DROP INDEX `resumes_fileHash_key` ON `resumes`;

-- 2. 添加 (userId, fileHash) 复合唯一索引
CREATE UNIQUE INDEX `userId_fileHash_unique` ON `resumes`(`userId`, `fileHash`);