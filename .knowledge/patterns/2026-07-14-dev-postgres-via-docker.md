id: pattern-2026-07-14-001
title: Mac 开发用 Docker 启 Postgres（避免端口冲突）
category: pattern
severity: medium
tags: [docker, postgres, dev-env, mac]
created_at: 2026-07-14
project: interview-buddy

problem: |
  启动本地 Postgres 有 3 种方式：
  1. brew install postgresql（全局污染）
  2. Docker Desktop + 容器（需 Docker daemon 运行）
  3. 用远程 DB（Neon / Supabase / RDS）

  本项目选 2，但 Mac 上的 Docker 常遇到：
  - Docker daemon 没启动
  - 端口 5432 被占（其他项目如 supabase / pgvector 经常占用）

solution: |
  **3 步启动**：

  1. 启动 Docker Desktop（如果 daemon 没跑）：
     ```bash
     open -g /Applications/Docker.app
     for i in 1 2 3 4 5; do
       docker ps >/dev/null 2>&1 && break
       sleep 3
     done
     ```

  2. 用**非默认端口**启动容器（避免与 supabase 等冲突）：
     ```bash
     docker run -d --name <project>-db \
       -e POSTGRES_USER=postgres \
       -e POSTGRES_PASSWORD=postgres \
       -e POSTGRES_DB=<db_name> \
       -p 5433:5432 \
       postgres:16-alpine
     ```

     ⚠️ 端口选择：
     - 5432 = 默认（高冲突）
     - 5433 = 备用
     - **54322** = supabase 已用（不可）
     - 各项目用独立端口（interview-buddy: 5433, opcone: 5434, ...）

  3. Prisma 跑迁移：
     ```bash
     DATABASE_URL="postgresql://postgres:postgres@localhost:5433/<db_name>?schema=public" \
       node node_modules/.pnpm/prisma@5.20.0/node_modules/prisma/build/index.js migrate dev --name init
     ```

  验证：
  ```bash
  docker exec <project>-db psql -U postgres -d <db_name> -c "\dt"
  # 应输出 11 张业务表 + _prisma_migrations
  ```

verification:
  docker_running: docker ps → CONTAINER ID 列出
  pg_ready: pg_isready -h localhost -p 5433 → "accepting connections"
  tables_created: psql \dt → 11 张业务表
  migrate_applied: ls prisma/migrations/ → 20260714061039_init/migration.sql

learned_from:
  - task: Phase 1.10
  - file: .env.local + prisma/schema.prisma
  - commit: (本次)

prevention:
  - 每个项目用独立端口（5443-5450）
  - 不污染 system Postgres（brew install postgresql）
  - 不与其他项目共用 DB

related:
  - pattern-2026-07-14-002 (待补：DB 健康检查脚本)
