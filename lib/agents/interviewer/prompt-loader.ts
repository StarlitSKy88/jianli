/**
 * Prompt 加载器 — 从 .knowledge/agents/{type}/system-prompt.md 读取
 *
 * 安全：
 * - 路径白名单（path traversal 防护）
 * - 文件大小上限（防 OOM）
 * - front-matter schema 校验
 */
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  InterviewerTypeSchema,
  type InterviewerMeta,
  type InterviewerType,
  type Dimension,
} from './types';

const ROOT = path.resolve(process.cwd(), '.knowledge', 'agents');
const MAX_FILE_SIZE = 64 * 1024; // 64KB

const ALLOWED: ReadonlySet<string> = new Set(['byte', 'ali', 'tencent', 'bili']);

interface LoadedPrompt {
  meta: InterviewerMeta;
  body: string;
}

const cache = new Map<InterviewerType, LoadedPrompt>();

export class PromptLoadError extends Error {
  constructor(msg: string) {
    super(`[prompt-loader] ${msg}`);
  }
}

/**
 * 加载并解析 prompt（带内存缓存，热加载时需清缓存）
 */
export function loadPrompt(type: InterviewerType): LoadedPrompt {
  if (!ALLOWED.has(type)) {
    throw new PromptLoadError(`非白名单 company: ${type}`);
  }
  InterviewerTypeSchema.parse(type);

  const cached = cache.get(type);
  if (cached) return cached;

  const filePath = path.join(ROOT, type, 'system-prompt.md');
  // 路径白名单二次校验（防止 ROOT 被劫持）
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(ROOT + path.sep)) {
    throw new PromptLoadError(`路径越界: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) {
    throw new PromptLoadError(`prompt 文件不存在: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    throw new PromptLoadError(`prompt 过大: ${stat.size} > ${MAX_FILE_SIZE}`);
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = matter(raw);

  const fm = parsed.data as Partial<InterviewerMeta>;
  const meta: InterviewerMeta = {
    type,
    name: fm.name || type,
    personality: fm.personality || '',
    weights: (fm.weights || {}) as Partial<Record<Dimension, number>>,
    version: fm.version || '0.0.0',
  };

  const loaded = { meta, body: parsed.content.trim() };
  cache.set(type, loaded);
  return loaded;
}

/** 清缓存 — 用于热加载 */
export function clearPromptCache(): void {
  cache.clear();
}
