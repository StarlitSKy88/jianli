/**
 * minimax Provider — 主 Provider（优先级 1）
 */
import { OpenAiCompatible } from './_openai-base';

let _instance: OpenAiCompatible | null = null;

export function getMinimaxProvider(): OpenAiCompatible | null {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;
  if (!_instance) {
    _instance = new OpenAiCompatible({
      name: 'minimax',
      apiKey,
      baseURL: process.env.MINIMAX_BASE_URL || 'https://api.MiniMax.chat/v1',
      defaultModel: process.env.MINIMAX_MODEL || 'MiniMax-M3',
      priority: 1, // 主 provider（成本最低/性能最好）
    });
  }
  return _instance;
}
