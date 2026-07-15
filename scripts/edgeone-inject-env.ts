/**
 * EdgeOne Pages 环境变量注入脚本
 *
 * 用法：
 *   1. 准备 .env.production，包含要注入的所有 key=value
 *   2. pnpm tsx scripts/edgeone-inject-env.ts
 *
 * 实际生产中 EdgeOne 控制台手动操作更稳，脚本用于：
 *   - 批量导入多个 key
 *   - CI 流水线部署
 *
 * 注：EdgeOne Pages CLI 命名可能变动，本脚本仅作为示例骨架；
 *     实际通过 `edgeone pages env set --key X --value Y` 一类 API 调用。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface EnvEntry {
  key: string;
  value: string;
}

function parseDotEnv(content: string): EnvEntry[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .filter((line) => line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      const key = line.slice(0, idx).trim();
      // 去掉尾部注释（如果有 ` # 注释`）
      const rawValue = line
        .slice(idx + 1)
        .replace(/\s+#.*$/, '')
        .trim();
      // 去掉首尾引号
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      return { key, value };
    });
}

function main() {
  const envFile = process.argv[2] || '.env.production';
  const path = resolve(process.cwd(), envFile);

  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (e) {
    console.error(`❌ 无法读取 ${path}: ${(e as Error).message}`);
    process.exit(1);
  }

  const entries = parseDotEnv(content);
  const secrets: string[] = [
    'SMTP_PASSWORD',
    'JWT_SECRET',
    'TURNSTILE_SECRET_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
    'MINIMAX_API_KEY',
    'OPENROUTER_API_KEY',
    'WECHAT_API_KEY',
  ];

  console.log(`📦 从 ${envFile} 解析出 ${entries.length} 个环境变量：\n`);
  entries.forEach(({ key, value }) => {
    const isSecret = secrets.includes(key);
    const display = isSecret ? '***' : value;
    console.log(`  ${key.padEnd(28)} ${display}`);
  });

  console.log(
    '\n🔐 标记为 Secret 的变量：',
    secrets.filter((s) => entries.some((e) => e.key === s))
  );
  console.log('\n📌 实际注入请到 EdgeOne 控制台执行：');
  console.log('   Pages → 项目 → 环境变量 → 粘贴以上 key/value');
  console.log('\n   或使用 EdgeOne CLI:');
  entries.forEach(({ key }) => {
    console.log(
      `   edgeone pages env set --key ${key} --secret ${secrets.includes(key) ? 'true' : 'false'}`
    );
  });
}

main();
