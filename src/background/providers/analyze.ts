/**
 * 反推（视觉理解）：OpenAI 兼容 chat/completions
 */

import { getSettings } from '../settings';
import { getAnalyzeSystemPrompt } from '../../shared/prompts';
import { ANALYZE_MAX_TOKENS, ANALYZE_TIMEOUT, BODY_READ_TIMEOUT, ERROR_MESSAGES } from '../../shared/constants';
import type { ProfileId } from '../../shared/types';
import {
  apiFetch,
  readJson,
  classifyHttpError,
  ApiError,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from './types';

export interface AnalyzeResult {
  prompt: string;
  profileId: ProfileId;
  model: string;
  charCount: number;
}

export async function analyzeImage(
  imageDataUrl: string,
  profileId: ProfileId
): Promise<AnalyzeResult> {
  const settings = await getSettings();
  const { baseUrl, apiKey, model } = settings.reverseApi;
  if (!apiKey) throw new ApiError('NOT_CONFIGURED', ERROR_MESSAGES['NOT_CONFIGURED'] ?? '请先完成 API 配置');
  const safeBase = baseUrl.replace(/\/$/, '');
  const safeKey = apiKey;

  const systemPrompt = getAnalyzeSystemPrompt(profileId);
  const body: ChatCompletionRequest = {
    model,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: systemPrompt },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ]},
    ],
    temperature: 0.7,
    max_tokens: ANALYZE_MAX_TOKENS,
  };

  const url = `${safeBase}/chat/completions`;
  // ★ 超时分层：ANALYZE_TIMEOUT 管「等响应头」（90s，给足视觉模型输出时间）；
  // readJson 管「读响应体」（BODY_READ_TIMEOUT=60s），响应头到了但 body 迟迟不流完时不会无限等
  const resp = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeKey}`,
    },
    body: JSON.stringify(body),
  }, ANALYZE_TIMEOUT);

  const data = await readJson<ChatCompletionResponse>(resp, BODY_READ_TIMEOUT, url);
  if (!resp.ok) throw classifyHttpError(resp.status, data);

  const prompt = data.choices?.[0]?.message?.content?.trim();
  if (!prompt) throw new ApiError('EMPTY_RESPONSE', '反推返回为空');

  return {
    prompt,
    profileId,
    model,
    charCount: Array.from(prompt).length,
  };
}
