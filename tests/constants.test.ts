/**
 * 画幅映射与常量测试
 */

import { describe, it, expect } from 'vitest';
import { ASPECT_RATIOS, ASPECT_OPTIONS, DEFAULT_SETTINGS, DEFAULT_PROFILE_ID } from '../src/shared/constants';

describe('ASPECT_RATIOS', () => {
  it('覆盖全部 UI 选项', () => {
    expect(ASPECT_OPTIONS.sort()).toEqual(['1:1', '3:4', '4:3', '9:16', '16:9'].sort());
    for (const k of ASPECT_OPTIONS) {
      expect(ASPECT_RATIOS[k]).toMatch(/^\d+x\d+$/);
    }
  });

  it('默认画幅 3:4 映射 768x1024', () => {
    expect(ASPECT_RATIOS['3:4']).toBe('768x1024');
  });

  it('人物卡画幅 16:9 映射 1344x768', () => {
    expect(ASPECT_RATIOS['16:9']).toBe('1344x768');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('默认反推方案为通用快速', () => {
    expect(DEFAULT_SETTINGS.reverseApi.profileId).toBe(DEFAULT_PROFILE_ID);
    expect(DEFAULT_PROFILE_ID).toBe('preset-general-fast');
  });
  it('默认模型合理', () => {
    expect(DEFAULT_SETTINGS.reverseApi.model).toBe('gpt-4o-mini');
    expect(DEFAULT_SETTINGS.generateApi.model).toBe('gpt-image-2');
  });
});
