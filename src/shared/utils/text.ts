/**
 * 拾影 ShiYing · 文本工具
 */

/** HTML 转义（防 XSS） */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 文件名 sanitize（去掉非法字符） */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

/** 截断文本 */
export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/** 时间格式化（刚刚 / x分钟前 / x小时前 / 日期） */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 字符数统计（中文友好） */
export function countChars(str: string): number {
  return Array.from(str).length;
}

/** 数字取整显示 */
export function roundNum(n: number): number {
  return Math.round(n);
}
