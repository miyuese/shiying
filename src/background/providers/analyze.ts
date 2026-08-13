/**
 * 反推（视觉理解）：OpenAI 兼容 chat/completions
 */

import { getSettings } from '../settings';
import { getAnalyzeSystemPrompt } from '../../shared/prompts';
import { ANALYZE_MAX_TOKENS, ANALYZE_TIMEOUT, ERROR_MESSAGES } from '../../shared/constants';
import type { ProfileId } from '../../shared/types';
import {
  apiFetch,
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
  const resp = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeKey}`,
    },
    body: JSON.stringify(body),
  }, ANALYZE_TIMEOUT);

  const data = (await resp.json().catch(() => ({}))) as ChatCompletionResponse;
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
