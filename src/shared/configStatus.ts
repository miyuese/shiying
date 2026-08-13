/**
 * 配置状态判定（纯函数，可在所有端使用）
 */

import type { Settings } from './types';

export function isReverseConfigured(s: Settings | null | undefined): boolean {
  if (!s) return false;
  return Boolean(s.reverseApi.baseUrl && s.reverseApi.apiKey && s.reverseApi.model);
}

export function isGenerateConfigured(s: Settings | null | undefined): boolean {
  if (!s) return false;
  return Boolean(s.generateApi.baseUrl && s.generateApi.apiKey && s.generateApi.model);
}

/** 配置状态：all / partial / none */
export function configStatus(s: Settings | null | undefined): 'all' | 'partial' | 'none' {
  const r = isReverseConfigured(s);
  const g = isGenerateConfigured(s);
  if (r && g) return 'all';
  if (r || g) return 'partial';
  return 'none';
}