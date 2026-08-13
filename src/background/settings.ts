/**
 * 设置读写 + 校验
 */

import { DEFAULT_SETTINGS } from '../shared/constants';
import type { Settings } from '../shared/types';
import { storage, KEYS } from './store/storage';

export async function getSettings(): Promise<Settings> {
  const saved = await storage.get<Partial<Settings>>(KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    reverseApi: { ...DEFAULT_SETTINGS.reverseApi, ...(saved.reverseApi ?? {}) },
    generateApi: { ...DEFAULT_SETTINGS.generateApi, ...(saved.generateApi ?? {}) },
  };
}

export async function saveSettings(next: Settings): Promise<Settings> {
  await storage.set(KEYS.settings, next);
  return next;
}

/** 是否已配置反推 */
// 重导出 shared 的纯函数版本（更稳健，支持 null 入参）
export { isReverseConfigured, isGenerateConfigured, configStatus } from '../shared/configStatus';
