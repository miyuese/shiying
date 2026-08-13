import { describe, expect, it } from 'vitest';
import { sanitizeForStorage } from '../src/background/store/storage';

describe('sanitizeForStorage', () => {
  it('保留深层字符串：任务 result.blobKeys 里的 key 必须存活（回归 bug 修复）', () => {
    const tasks = [
      {
        id: 't_abc',
        type: 'faceswap',
        status: 'done',
        result: { blobKeys: ['gen:t_abc:0', 'gen:t_abc:1'], prompt: 'x' },
        inputs: {},
      },
    ];
    const out = sanitizeForStorage(tasks) as any[];
    expect(out[0].result.blobKeys).toEqual(['gen:t_abc:0', 'gen:t_abc:1']);
    expect(out[0].result.prompt).toBe('x');
  });

  it('剔除敏感字段（apiKey 等），保留普通字段', () => {
    const out = sanitizeForStorage({ apiKey: 'sk-x', name: 'ok' }) as any;
    expect(out.apiKey).toBeUndefined();
    expect(out.name).toBe('ok');
  });

  it('剔除任意深度的 base64 dataURL（图片应走 IndexedDB）', () => {
    const out = sanitizeForStorage({
      a: { b: { c: 'data:image/png;base64,xxxx', d: '正常文字' } },
    }) as any;
    expect(out.a.b.c).toBeUndefined();
    expect(out.a.b.d).toBe('正常文字');
  });

  it('循环引用返回 undefined 而不爆栈', () => {
    const x: any = { name: 'x' };
    x.self = x;
    const out = sanitizeForStorage(x) as any;
    expect(out.name).toBe('x');
    expect(out.self).toBeUndefined();
  });
});
