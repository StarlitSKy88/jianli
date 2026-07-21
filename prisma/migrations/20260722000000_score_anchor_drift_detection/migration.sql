-- ============================================
-- ScoreAnchor + AnchorEvaluation 表
-- Phase 14.24 — 评分漂移检测基础设施
-- ============================================
--
-- 目的：
--   1. 维护一份"金标准"评分锚点集（ScoreAnchor）
--   2. 每次跑 AI 评分时随机抽几个锚点做"对照实验"
--   3. 记录 AI 评分结果（AnchorEvaluation），计算 driftDelta
--   4. driftDelta 超过阈值时报警 → 提示 prompt 可能需要调整
--
-- 为什么用单独两张表而不是扩展 AgentScore？
--   - AgentScore 绑定 Report（每次面试一个），锚点评估是"无面试的对照实验"
--   - 锚点数据长期稳定（一旦设定不轻易改），评估数据每天都在涨
--   - 拆分后查询/索引更精准
--
-- 字段说明：
--   - referenceAnswer: 人工撰写的参考答案（标定 truth）
--   - expectedScoreRange: [min, max] 期望分数区间（人工打分容忍度）
--   - humanScore: 人工最终打分（用于对比 AI）
--   - driftThreshold: 单条超过此 delta 视为漂移（默认 5 分）
--
-- 关键索引：
--   - (company, dimension, isActive): 抽样查询锚点
--   - (anchorId, evaluatedAt DESC): 评估历史
-- ============================================

-- 1. ScoreAnchor — 评分锚点（金标准）
CREATE TABLE `score_anchors` (
  `id`              VARCHAR(191) NOT NULL,
  `company`         VARCHAR(32)  NOT NULL,    -- byte / ali / tencent / bili
  `role`            VARCHAR(64)  NOT NULL,    -- 后端工程师 / 前端 / 算法 ...
  `level`           VARCHAR(16)  NOT NULL,    -- P5 / P6 / P7
  `dimension`       VARCHAR(32)  NOT NULL,    -- tech / project / sysdesign / algo / cs / culture / star / pressure
  `questionText`    TEXT         NOT NULL,    -- 锚点对应的面试问题
  `referenceAnswer` TEXT         NOT NULL,    -- 人工撰写的"标准"回答
  `humanScore`      INT          NOT NULL,    -- 人工最终打分（0-100）
  `expectedScoreMin` INT         NOT NULL,    -- 期望分数下限（容忍区间下界）
  `expectedScoreMax` INT         NOT NULL,    -- 期望分数上限（容忍区间上界）
  `driftThreshold`  INT          NOT NULL DEFAULT 5,  -- 单条 driftDelta 超过此值视为漂移
  `tags`            JSON         NULL,        -- 标签：["hot", "深度系统设计", "高频考点"]
  `isActive`        BOOLEAN      NOT NULL DEFAULT true,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `score_anchors_company_dimension_active_idx`(`company`, `dimension`, `isActive`),
  INDEX `score_anchors_active_idx`(`isActive`)
);

-- 2. AnchorEvaluation — 锚点评估历史（AI 每次跑评分时的对照结果）
CREATE TABLE `anchor_evaluations` (
  `id`              VARCHAR(191) NOT NULL,
  `anchorId`        VARCHAR(191) NOT NULL,
  `agentName`       VARCHAR(64)  NOT NULL,    -- 谁评的（minimax / claude / mock ...）
  `agentVersion`    VARCHAR(32)  NOT NULL,    -- prompt 版本号（commit hash 或时间戳）
  `aiScore`         INT          NOT NULL,    -- AI 给出的分数（0-100）
  `driftDelta`      INT          NOT NULL,    -- |aiScore - humanScore|
  `isDrift`         BOOLEAN      NOT NULL,    -- driftDelta > anchor.driftThreshold
  `aiReasoning`     TEXT         NULL,        -- AI 评分理由（用于诊断）
  `evaluatedAt`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `durationMs`      INT          NOT NULL,    -- 评分耗时
  PRIMARY KEY (`id`),
  INDEX `anchor_evaluations_anchor_time_idx`(`anchorId`, `evaluatedAt` DESC),
  INDEX `anchor_evaluations_drift_time_idx`(`isDrift`, `evaluatedAt` DESC),
  INDEX `anchor_evaluations_agent_time_idx`(`agentName`, `evaluatedAt` DESC),
  CONSTRAINT `anchor_evaluations_anchor_fk`
    FOREIGN KEY (`anchorId`) REFERENCES `score_anchors`(`id`) ON DELETE CASCADE
);

-- 3. AnchorDriftAlert — 漂移告警（累积到阈值时记录一条）
-- 为什么要单独建表而不是直接 alert？
--   - 一个 alert 可能对应多条 evaluation（同一 hour 内多次 drift）
--   - 报警去重 + 状态机（NEW → ACKNOWLEDGED → RESOLVED）
CREATE TABLE `anchor_drift_alerts` (
  `id`              VARCHAR(191) NOT NULL,
  `company`         VARCHAR(32)  NOT NULL,
  `dimension`       VARCHAR(32)  NOT NULL,
  `agentName`       VARCHAR(64)  NOT NULL,
  `windowStart`     DATETIME(3)  NOT NULL,    -- 统计窗口起点
  `windowEnd`       DATETIME(3)  NOT NULL,    -- 统计窗口终点
  `sampleCount`     INT          NOT NULL,    -- 窗口内 evaluation 总数
  `driftCount`      INT          NOT NULL,    -- 窗口内 isDrift=true 数量
  `driftRate`       FLOAT        NOT NULL,    -- driftCount / sampleCount
  `avgDelta`        FLOAT        NOT NULL,    -- 平均 |driftDelta|
  `maxDelta`        INT          NOT NULL,    -- 最大 |driftDelta|
  `severity`        VARCHAR(16)  NOT NULL,    -- LOW / MEDIUM / HIGH
  `status`          VARCHAR(16)  NOT NULL DEFAULT 'NEW',  -- NEW / ACKNOWLEDGED / RESOLVED
  `acknowledgedBy`  VARCHAR(191) NULL,
  `acknowledgedAt`  DATETIME(3)  NULL,
  `createdAt`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `anchor_drift_alerts_company_dimension_time_idx`(`company`, `dimension`, `windowEnd` DESC),
  INDEX `anchor_drift_alerts_status_time_idx`(`status`, `createdAt` DESC)
);