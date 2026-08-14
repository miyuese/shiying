/**
 * IndexedDB 封装（图片 blob 表 + 错误日志表）
 * DB: shiyin-db / store: images, errors
 *
 * ★ 参考同类成熟插件的设计经验：
 *   - 开库即用、用完即关：每次操作打开全新连接，操作完立即 db.close()
 *   - 不缓存常驻连接，避免 MV3 Service Worker 空闲被杀/重启后，旧连接
 *     指向的数据与实际落库不一致，导致"写进去了却读不到"
 *   - 事务同时监听 oncomplete（提交成功）/ onerror（失败）/ onabort（被中止）
 *   - 配合 manifest 的 unlimitedStorage 权限，防止浏览器在存储压力下
 *     清理掉本插件的 IndexedDB（开库即用能跨重启存图正是靠这一点）
 */

import { DB_NAME, DB_VERSION, DB_STORE_IMAGES, DB_STORE_ERRORS } from '../../shared/constants';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE_IMAGES)) {
        db.createObjectStore(DB_STORE_IMAGES, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(DB_STORE_ERRORS)) {
        db.createObjectStore(DB_STORE_ERRORS, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 打开数据库 → 执行操作 → 用完立即关闭（核心模式，供各操作复用） */
export async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

/** 写入图片 blob */
export async function putImage(key: string, blob: Blob): Promise<void> {
  if (typeof key !== 'string' || key === '') return;
  await withDb((db) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readwrite');
      tx.objectStore(DB_STORE_IMAGES).put({ key, blob, createdAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('写入图片失败'));
      tx.onabort = () => reject(tx.error ?? new Error('写入图片被中止'));
    })
  );
}

/**
 * 读取图片 blob
 * ★ 防御：key 为空/非法时直接返回 undefined（否则 IDBObjectStore.get(undefined)
 * 会抛出 "No key or key range specified"，导致结果区所有操作报刺眼的原生错误）
 */
export async function getImage(key: string): Promise<Blob | undefined> {
  if (typeof key !== 'string' || key === '') return undefined;
  return withDb((db) =>
    new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readonly');
      const req = tx.objectStore(DB_STORE_IMAGES).get(key);
      req.onsuccess = () => resolve((req.result as { blob?: Blob } | undefined)?.blob);
      req.onerror = () => reject(req.error);
    })
  );
}

/** 删除图片 */
export async function deleteImage(key: string): Promise<void> {
  if (typeof key !== 'string' || key === '') return;
  await withDb((db) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readwrite');
      tx.objectStore(DB_STORE_IMAGES).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })
  );
}

/** 检查是否存在 */
export async function hasImage(key: string): Promise<boolean> {
  if (typeof key !== 'string' || key === '') return false;
  return withDb((db) =>
    new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readonly');
      const req = tx.objectStore(DB_STORE_IMAGES).getKey(key);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
    })
  );
}

/** 列出全部图片 key（可按前缀过滤）；用于清理孤儿 blob（任务已被裁剪但 blob 还在） */
export async function listImageKeys(prefix?: string): Promise<string[]> {
  return withDb((db) =>
    new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readonly');
      const store = tx.objectStore(DB_STORE_IMAGES);
      // IDBKeyRange 按字符串前缀取范围（'regen-' → 'regen-￿' 覆盖所有该前缀 key）
      const req = prefix
        ? store.getAllKeys(IDBKeyRange.bound(prefix, prefix + '￿'))
        : store.getAllKeys();
      req.onsuccess = () =>
        resolve((req.result as IDBValidKey[]).filter((k): k is string => typeof k === 'string'));
      req.onerror = () => reject(req.error);
    })
  );
}

/** 批量删除（相册/人物卡删除时清理 blob） */
export async function deleteImages(keys: string[]): Promise<void> {
  const valid = keys.filter((k) => typeof k === 'string' && k !== '');
  if (valid.length === 0) return;
  await withDb((db) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readwrite');
      const store = tx.objectStore(DB_STORE_IMAGES);
      for (const key of valid) store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    })
  );
}

/** 全部 blob 数量（调试/配额检查用） */
export async function countImages(): Promise<number> {
  return withDb((db) =>
    new Promise<number>((resolve, reject) => {
      const tx = db.transaction(DB_STORE_IMAGES, 'readonly');
      const req = tx.objectStore(DB_STORE_IMAGES).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}
