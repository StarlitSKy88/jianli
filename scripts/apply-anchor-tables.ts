import { prisma } from '../lib/db/client';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const sqlPath = path.join(
    process.cwd(),
    'prisma/migrations/20260722000000_score_anchor_drift_detection/migration.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('[apply-anchor-tables] 准备执行 migration.sql ...');
  // Prisma $executeRawUnsafe 不支持多语句，按 `;\n` 切分（保留每条语句的完整 SQL）
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim() + ';')
    .filter((s) => {
      // 移除纯注释段
      const withoutComments = s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
      return withoutComments.length > 5; // 至少有一条语句
    });

  let applied = 0;
  for (const stmt of statements) {
    if (!stmt) continue;
    try {
      await prisma.$executeRawUnsafe(stmt);
      applied++;
      const firstLine = stmt.split('\n')[0].slice(0, 60);
      console.log(`  ✅ ${firstLine}...`);
    } catch (e) {
      const msg = (e as Error).message;
      // 1050 = table already exists, 1061 = index already exists — 容忍
      if (msg.includes('1050') || msg.includes('1061') || msg.includes('already exists')) {
        console.log(`  ⏭️  已存在，跳过: ${stmt.slice(0, 50)}`);
      } else {
        console.error(`  ❌ 失败: ${msg.slice(0, 200)}`);
        throw e;
      }
    }
  }
  console.log(`\n[apply-anchor-tables] 完成，共应用 ${applied} 条 DDL`);

  // 验证
  const tables =
    await prisma.$queryRawUnsafe<Array<{ Tables_in_interview_buddy: string }>>('SHOW TABLES');
  const hasAnchor = tables.some((t) => Object.values(t)[0] === 'score_anchors');
  const hasEval = tables.some((t) => Object.values(t)[0] === 'anchor_evaluations');
  const hasAlert = tables.some((t) => Object.values(t)[0] === 'anchor_drift_alerts');
  console.log(
    `[apply-anchor-tables] 验证: score_anchors=${hasAnchor} anchor_evaluations=${hasEval} anchor_drift_alerts=${hasAlert}`
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
