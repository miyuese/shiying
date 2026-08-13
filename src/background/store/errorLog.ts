/**
 * 错误收集器：把扩展各端的运行时错误自动存到 IndexedDB，
 * 供设置页「查看错误日志」读取，便于排查。
 *
 * 存储：IndexedDB shiyin-db / store: errors（每条约 200B）
 * 上限：保留最近 100 条
 *
 * ★ 与 db.ts 保持一致：开库即用、用完即关（withDb），不缓存长连接
 */

import { DB_STORE_ERRORS } from '../../shared/constants';
import { withDb } from './db';

export interface ErrorLogEntry {
  id?: number;
  /** 来源端：background / content / panel / popup / options */
  source: string;
  message: string;
  stack?: string;
  url?: string;
  line?: number;
  col?: number;
  createdAt: number;
}

/** 记录一条错误 */
export async function logError(
  source: string,
  message: string,
  stack?: string,
  url?: string,
  line?: number,
  col?: number
): Promise<void> {
  try {
    await withDb((db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DB_STORE_ERRORS, 'readwrite');
        const store = tx.objectStore(DB_STORE_ERRORS);
        store.add({ source, message: String(message).slice(0, 2000), stack: stack?.slice(0, 4000), url, line, col, createdAt: Date.now() } as ErrorLogEntry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
    );
  } catch {
    /* 收集失败静默 */
  }
}

/** 读取最近 N 条错误（按时间倒序） */
export async function listErrors(limit = 30): Promise<ErrorLogEntry[]> {
  try {
    const all = await withDb((db) =>
      new Promise<ErrorLogEntry[]>((resolve, reject) => {
        const tx = db.transaction(DB_STORE_ERRORS, 'readonly');
        const req = tx.objectStore(DB_STORE_ERRORS).getAll();
        req.onsuccess = () => resolve((req.result as ErrorLogEntry[]) ?? []);
        req.onerror = () => reject(req.error);
      })
    );
    const sorted = all.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return sorted.slice(0, limit);
  } catch {
    return [];
  }
}

/** 清空错误日志 */
export async function clearErrors(): Promise<void> {
  try {
    await withDb((db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DB_STORE_ERRORS, 'readwrite');
        tx.objectStore(DB_STORE_ERRORS).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
    );
  } catch {
    /* 忽略 */
  }
}

/** 删除超量旧错误（内部调用，防膨胀） */
export async function trimErrors(): Promise<void> {
  try {
    const all = await withDb((db) =>
      new Promise<ErrorLogEntry[]>((resolve, reject) => {
        const tx = db.transaction(DB_STORE_ERRORS, 'readonly');
        const req = tx.objectStore(DB_STORE_ERRORS).getAll();
        req.onsuccess = () => resolve((req.result as ErrorLogEntry[]) ?? []);
        req.onerror = () => reject(req.error);
      })
    );
    if (all.length <= 100) return;
    const sorted = all.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const toDelete = sorted.slice(0, all.length - 100);
    await withDb((db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(DB_STORE_ERRORS, 'readwrite');
        const store = tx.objectStore(DB_STORE_ERRORS);
        for (const e of toDelete) store.delete(e.id as number);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
    );
  } catch {
    /* 忽略 */
  }
}

/** 全局挂载：捕获 error / unhandledrejection（兼容 Service Worker 与页面环境） */
export function installErrorCapture(source: string): void {
  const capture = (message: string, stack?: string, url?: string, line?: number, col?: number) => {
    void logError(source, message, stack, url, line, col);
    void trimErrors();
  };

  // Service Worker 无 window 对象，用 globalThis 统一挂载
  const g = globalThis as unknown as {
    addEventListener?: (t: string, fn: (e: any) => void) => void;
  };
  if (!g || typeof g.addEventListener !== 'function') return;

  g.addEventListener('error', (e: any) => {
    capture(e?.message ?? String(e), e?.error?.stack, e?.filename, e?.lineno, e?.colno);
  });

  g.addEventListener('unhandledrejection', (e: any) => {
    const reason = e?.reason as Error | string | undefined;
    if (reason instanceof Error) {
      capture(reason.message, reason.stack);
    } else {
      capture(typeof reason === 'string' ? reason : JSON.stringify(reason));
    }
  });
}
