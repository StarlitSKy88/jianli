/**
 * DeepSeek Provider — 备选 Provider（优先级 3，OpenAI 兼容）
 */
import { OpenAiCompatible } from './_openai-base';

let _instance: OpenAiCompatible | null = null;

export function getDeepSeekProvider(): OpenAiCompatible | null {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  if (!_instance) {
    _instance = new OpenAiCompatible({
      name: 'deepseek',
      apiKey,
      baseURL: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
    });
  }
  return _instance;
}
