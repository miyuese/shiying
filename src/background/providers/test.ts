/**
 * 测试连接：反推 / 生图 各发一条最小请求
 */

import { getSettings } from '../settings';
import { TEST_TIMEOUT } from '../../shared/constants';
import { apiFetch, classifyHttpError, type ChatCompletionResponse, type ImagesResponse } from './types';

export type TestResult = 'ok' | 'invalid-key' | 'forbidden' | 'not-found' | 'rate-limited' | 'error';

export async function testConnection(which: 'reverse' | 'generate'): Promise<{ ok: boolean; detail: string }> {
  const settings = await getSettings();
  const cfg = which === 'reverse' ? settings.reverseApi : settings.generateApi;

  if (!cfg.apiKey) {
    return { ok: false, detail: '未填写 API Key' };
  }

  const base = cfg.baseUrl.replace(/\/$/, '');

  try {
    if (which === 'reverse') {
      const resp = await apiFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
        }),
      }, TEST_TIMEOUT);
      const data = (await resp.json().catch(() => ({}))) as ChatCompletionResponse;
      if (!resp.ok) throw classifyHttpError(resp.status, data);
      return { ok: true, detail: `反推连接成功（${cfg.model}）` };
    } else {
      // 生图：只检查端点可达与鉴权（发最小 generations 请求）
      const resp = await apiFetch(`${base}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      }, TEST_TIMEOUT);
      if (resp.status === 404) {
        // 部分中转不支持 /models，改发 images/generations 最小请求
        const resp2 = await apiFetch(`${base}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({ model: cfg.model, prompt: 'test', n: 1, size: '256x256' }),
        }, TEST_TIMEOUT);
        const data2 = (await resp2.json().catch(() => ({}))) as ImagesResponse;
        if (!resp2.ok) {
          if (resp2.status === 401) return { ok: false, detail: 'API Key 无效' };
          if (resp2.status === 429) return { ok: false, detail: '额度不足或请求过快' };
          return { ok: true, detail: `端点可达（${cfg.model}）· 未触发计费请求` };
        }
        return { ok: true, detail: `生图连接成功（${cfg.model}）` };
      }
      if (!resp.ok) throw classifyHttpError(resp.status, {});
      return { ok: true, detail: `生图连接成功（${cfg.model}）` };
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const map: Record<string, string> = {
      AUTH_INVALID: 'API Key 无效',
      AUTH_FORBIDDEN: '无权限',
      ENDPOINT_NOT_FOUND: '模型或端点不支持',
      RATE_LIMITED: '额度不足或请求过快',
      TIMEOUT: '连接超时',
      NETWORK: '网络异常',
    };
    return { ok: false, detail: map[e.code ?? ''] ?? e.message ?? '未知错误' };
  }
}
