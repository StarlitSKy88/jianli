/**
 * OpenRouter Provider — 免费 / 多模型路由
 *
 * 主要用途：连接 OpenRouter 统一 API（一个 key 访问 100+ 模型）
 * 当前默认模型：tencent/hy3:free（腾讯混元 Hy3，免费，2.6s 延迟，44 tps）
 *
 * ⚠️ 注意：tencent/hy3:free 会于 2026-07-21 下线，届时需切换到其他 free 模型
 *    或付费版（hy3 同样可用，按 token 计费）
 */
import { OpenAiCompatible } from './_openai-base';

let _instance: OpenAiCompatible | null = null;

export function getOpenRouterProvider(): OpenAiCompatible | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  if (!_instance) {
    _instance = new OpenAiCompatible({
      name: 'openrouter',
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultModel: process.env.OPENROUTER_MODEL ?? 'tencent/hy3:free',
    });
  }
  return _instance;
}
