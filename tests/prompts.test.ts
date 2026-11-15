/**
 * prompts 组装测试
 */

import { describe, it, expect } from 'vitest';
import {
  getAnalyzeSystemPrompt,
  buildGeneratePrompt,
  buildSuitePortraitPrompt,
  buildSuiteScenePrompt,
  suiteLayout,
  PERSON_CARD_PROMPT,
  SUITE_PROMPT_TEMPLATE,
  FACESWAP_PROMPT_TEMPLATE,
  REDRAW_GUIDE,
} from '../src/shared/prompts';

describe('反推方案', () => {
  it('默认方案包含核心规则', () => {
    const p = getAnalyzeSystemPrompt('preset-general-fast');
    expect(p).toContain('高保真参考图重建');
    expect(p).toContain('忠实重建');
    expect(p).toContain('负面提示词');
  });

  it('不同方案有不同的目标场景', () => {
    const general = getAnalyzeSystemPrompt('preset-general-fast');
    const product = getAnalyzeSystemPrompt('preset-product-image');
    expect(general).not.toBe(product);
    expect(product).toContain('商品');
  });

  it('未知方案回退到通用快速', () => {
    const p = getAnalyzeSystemPrompt('preset-general-fast');
    expect(p.length).toBeGreaterThan(200);
  });
});

describe('生成功能模板', () => {
  it('换脸模板强调双图分工', () => {
    expect(FACESWAP_PROMPT_TEMPLATE).toContain('第二张及之后的图片');
    expect(FACESWAP_PROMPT_TEMPLATE).toContain('脸部身份来源');
    expect(FACESWAP_PROMPT_TEMPLATE).toContain('贴脸');
  });

  it('换脸模板：图1=构图与场景参考（底图）、第二张起=人物面部身份参考（同一个人），不得颠倒（回归 bug 修复）', () => {
    expect(FACESWAP_PROMPT_TEMPLATE).toContain('图1（即 image 字段中的第一张：构图与场景参考）作为唯一基础图');
    expect(FACESWAP_PROMPT_TEMPLATE).toContain('第二张及之后的图片（即 image 字段中的第二张起：人物面部身份参考，均为同一个人）只作为脸部身份来源');
    expect(FACESWAP_PROMPT_TEMPLATE).not.toContain('以图2作为唯一基础图');
    expect(FACESWAP_PROMPT_TEMPLATE).not.toContain('图1只作为脸部身份来源');
  });

  it('重绘模板是全新生成而非保留源图', () => {
    expect(REDRAW_GUIDE).toContain('全新画面');
    expect(REDRAW_GUIDE).not.toContain('严格保留图2的一切');
  });

  it('人物卡模板要求三视图', () => {
    expect(PERSON_CARD_PROMPT).toContain('三视图');
    expect(PERSON_CARD_PROMPT).toContain('45 度');
    expect(PERSON_CARD_PROMPT).toContain('90 度');
  });

  it('拍一套模板强调一致性最高优先级', () => {
    expect(SUITE_PROMPT_TEMPLATE).toContain('2x2');
    expect(SUITE_PROMPT_TEMPLATE).toContain('Consistency is the highest priority');
  });

  it('拍一套模板：图序映射 + 面部参考（人物卡或直接照片）仅作适度参考（不锁定细节）', () => {
    expect(SUITE_PROMPT_TEMPLATE).toContain('the first image in the image field');
    expect(SUITE_PROMPT_TEMPLATE).toContain('photos of the same person');
    expect(SUITE_PROMPT_TEMPLATE).toContain('light facial-identity guide');
    expect(SUITE_PROMPT_TEMPLATE).toContain('without over-locking facial details');
  });

  it('拍一套模板：视角只举例不锁死，追求活人感多样套图', () => {
    // 给案例（正面/斜侧/侧面/背面…），但不作固定清单
    expect(SUITE_PROMPT_TEMPLATE).toContain('front view');
    expect(SUITE_PROMPT_TEMPLATE).toContain('three-quarter view');
    expect(SUITE_PROMPT_TEMPLATE).toContain('profile (side) view');
    expect(SUITE_PROMPT_TEMPLATE).toContain('back view');
    expect(SUITE_PROMPT_TEMPLATE).toContain('only as examples, not a fixed checklist');
    // 明确不锁死角度/姿势
    expect(SUITE_PROMPT_TEMPLATE).toContain('Do not prescribe fixed poses or fixed angles');
    // 活人感：像真实摄影/氛围感，不死板
    expect(SUITE_PROMPT_TEMPLATE).toContain('real, lively moments');
    expect(SUITE_PROMPT_TEMPLATE).toContain('never stiff, posed, or repetitive');
  });

  it('buildGeneratePrompt 按意图组装', () => {
    const redraw = buildGeneratePrompt('redraw', '测试提示词');
    expect(redraw).toContain('测试提示词');
    expect(redraw).toContain('全新画面');
    const faceswap = buildGeneratePrompt('faceswap', '测试提示词');
    expect(faceswap).toContain('第二张及之后的图片');
    const suite = buildGeneratePrompt('suite', 'x');
    expect(suite).toBe(SUITE_PROMPT_TEMPLATE);
  });
});

describe('拍一套 · 人像批 / 配图批', () => {
  it('排布按张数变化：1 张直出、2 张左右并排、3~4 张四宫格', () => {
    expect(suiteLayout(1)).toBe('single');
    expect(suiteLayout(2)).toBe('pair');
    expect(suiteLayout(3)).toBe('grid');
    expect(suiteLayout(4)).toBe('grid');
    expect(buildSuitePortraitPrompt(1)).toContain('one single vertical photograph');
    expect(buildSuitePortraitPrompt(2)).toContain('3:4 vertical frame');
    expect(buildSuitePortraitPrompt(4)).toContain('exactly four');
  });

  it('人像批要求每张都是同一个人，且不改变造型与场景', () => {
    const p = buildSuitePortraitPrompt(2);
    expect(p).toContain('Every shot must contain the same person');
    expect(p).toContain('the first image in the image field');
    expect(p).toContain('Do not change the person, outfit, hairstyle, scene, lighting setup or color grading');
  });

  it('配图批从底图取元素，四类取景齐全', () => {
    const p = buildSuiteScenePrompt(2);
    expect(p).toContain('outfit detail');
    expect(p).toContain('food and table');
    expect(p).toContain('environment wide');
    expect(p).toContain('environment detail');
    expect(p).toContain('do not place the person in the frame');
  });

  it('配图批：风格与底图同一次拍摄 + 去 AI 感硬约束', () => {
    const p = buildSuiteScenePrompt(2);
    expect(p).toContain('Same color temperature');
    expect(p).toContain('real photograph rather than a rendered image');
    expect(p).toContain('no text of any kind');
    expect(p).toContain('no human face');
    expect(p).toContain('no close-up of hands or fingers');
    expect(p).toContain('never a face');
    expect(p).toContain('no over-smoothing');
  });
});
