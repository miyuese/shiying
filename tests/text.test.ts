/**
 * 文本工具测试
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeFilename, truncate, countChars, timeAgo } from '../src/shared/utils/text';

describe('escapeHtml', () => {
  it('转义 HTML 特殊字符', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

describe('sanitizeFilename', () => {
  it('替换非法字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });
  it('空格转下划线', () => {
    expect(sanitizeFilename('my photo 01')).toBe('my_photo_01');
  });
});

describe('truncate', () => {
  it('截断并加省略号', () => {
    expect(truncate('1234567890', 5)).toBe('12345…');
  });
  it('短文本不截断', () => {
    expect(truncate('abc', 5)).toBe('abc');
  });
});

describe('countChars', () => {
  it('中文按字符数', () => {
    expect(countChars('你好世界')).toBe(4);
  });
});

describe('timeAgo', () => {
  it('刚刚', () => {
    expect(timeAgo(Date.now() - 1000)).toBe('刚刚');
  });
  it('分钟前', () => {
    expect(timeAgo(Date.now() - 120_000)).toBe('2分钟前');
  });
});
