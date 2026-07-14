/**
 * Scorer prompt 加载器 — 从 .knowledge/agents/scorer/{company}/{dimension}.md 读取
 *
 * 与 interviewer/prompt-loader 同款：白名单 + 大小限制 + front-matter + 缓存
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';

export const COMPANY_VALUES = ['byte', 'ali', 'tencent', 'bili'] as const;
export type ScorerCompany = (typeof COMPANY_VALUES)[number];

const DIMENSION_VALUES = [
  'tech',
  'project',
  'sysdesign',
  'algo',
  'cs',
  'culture',
  'star',
  'pressure',
] as const;
export type ScorerDimension = (typeof DIMENSION_VALUES)[number];

const ROOT = path.resolve(process.cwd(), '.knowledge', 'agents', 'scorer');
const MAX_FILE_SIZE = 64 * 1024; // 64KB

const COMPANY_SET: ReadonlySet<string> = new Set(COMPANY_VALUES);
const DIMENSION_SET: ReadonlySet<string> = new Set(DIMENSION_VALUES);

const MetaSchema = z.object({
  company: z.enum(COMPANY_VALUES),
  dimension: z.enum(DIMENSION_VALUES),
  name: z.string().max(100),
  version: z.string().default('1.0.0'),
  weight: z.number().min(0).max(1),
});

export interface ScorerPromptMeta {
  company: ScorerCompany;
  dimension: ScorerDimension;
  name: string;
  version: string;
  weight: number;
}

interface LoadedScorerPrompt {
  meta: ScorerPromptMeta;
  body: string;
}

const cache = new Map<string, LoadedScorerPrompt>();

export class ScorerPromptLoadError extends Error {
  constructor(msg: string) {
    super(`[scorer-prompt-loader] ${msg}`);
  }
}

export function loadScorerPrompt(
  company: ScorerCompany,
  dimension: ScorerDimension
): LoadedScorerPrompt {
  if (!COMPANY_SET.has(company)) {
    throw new ScorerPromptLoadError(`非白名单 company: ${company}`);
  }
  if (!DIMENSION_SET.has(dimension)) {
    throw new ScorerPromptLoadError(`非白名单 dimension: ${dimension}`);
  }

  const key = `${company}/${dimension}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const filePath = path.join(ROOT, company, `${dimension}.md`);
  // 路径白名单二次校验（防止 ROOT 被劫持或 symlink 跳出）
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT + path.sep)) {
    throw new ScorerPromptLoadError(`路径越界: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new ScorerPromptLoadError(`找不到评分 prompt: ${company}/${dimension}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    throw new ScorerPromptLoadError(`评分 prompt 过大: ${stat.size}B (max ${MAX_FILE_SIZE}B)`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed = matter(raw);
  const meta = MetaSchema.parse(parsed.data);
  if (meta.company !== company || meta.dimension !== dimension) {
    throw new ScorerPromptLoadError(
      `front-matter 与路径不一致: 路径=${company}/${dimension}, 声明=${meta.company}/${meta.dimension}`
    );
  }
  const loaded: LoadedScorerPrompt = { meta, body: parsed.content.trim() };
  cache.set(key, loaded);
  return loaded;
}

/** 清缓存（热加载时调用，测试用） */
export function clearScorerPromptCache(): void {
  cache.clear();
}
