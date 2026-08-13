/**
 * chrome.storage.local 的 Promise 封装
 *
 * ★ 借鉴 同类产品：storage.local 只存小元数据（设置/引用），图片 blob 一律进 IndexedDB。
 * ★ 写库前 sanitize：剔除任何可能混入的敏感字段（apiKey/token/secret）与超大 dataURL。
 */

const SENSITIVE_KEYS = new Set([
  'apiKey', 'api_key', 'token', 'accessToken', 'refreshToken',
  'Authorization', 'authorization', 'secret', 'serverAuth',
]);

export function sanitizeForStorage(value: unknown, seen: Set<unknown> = new Set()): unknown {
  // 只剔除两类危险内容，其余原样保留：
  //   1) 敏感字段（apiKey/token/secret 等）
  //   2) 任意深度的 base64 dataURL 字符串（体积大，图片应走 IndexedDB）
  // ★ 不用"层数截断"：那会把深层小字段（如任务 result.blobKeys 里的 key 字符串）
  //   误删成 undefined → 序列化后变 null，导致任务记录指向的图片 key 全部丢失，
  //   面板取图永远 image-not-found。用循环引用保护替代深度截断。
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const out = value.map((v) => sanitizeForStorage(v, seen));
    seen.delete(value);
    return out;
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) return undefined; // 循环引用保护
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k)) continue;
      // 禁止把 base64 dataURL 写进 storage.local（图片应走 IndexedDB）
      if (typeof v === 'string' && v.startsWith('data:')) continue;
      out[k] = sanitizeForStorage(v, seen);
    }
    seen.delete(value);
    return out;
  }
  return value;
}

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const res = await chrome.storage.local.get(key);
    return (res[key] as T | undefined) ?? fallback;
  },

  async set(key: string, value: unknown): Promise<void> {
    // 白名单键保留原样（settings 里的 apiKey 是配置必需）
    const safe =
      key === KEYS.settings
        ? value
        : sanitizeForStorage(value);
    await chrome.storage.local.set({ [key]: safe });
  },

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

/** storage 键名集中管理 */
export const KEYS = {
  settings: 'settings',
  tasks: 'tasks',
  albumMeta: 'albumMeta',
  personCards: 'personCards',
  pendingImage: 'pendingImage',
} as const;
