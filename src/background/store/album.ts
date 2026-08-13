/**
 * 相册 CRUD（元数据在 storage.local，图片 blob 在 IndexedDB）
 */

import type { AlbumItem } from '../../shared/types';
import { storage, KEYS } from './storage';
import { putImage, deleteImages, getImage, hasImage } from './db';
import { genId } from '../../shared/utils/image';

async function getAll(): Promise<AlbumItem[]> {
  return storage.get<AlbumItem[]>(KEYS.albumMeta, []);
}

async function saveAll(items: AlbumItem[]): Promise<void> {
  await storage.set(KEYS.albumMeta, items);
}

export async function listAlbum(cursor = 0, limit = 50): Promise<{ items: AlbumItem[]; nextCursor: number }> {
  const all = await getAll();
  // 按时间倒序
  const sorted = [...all].sort((a, b) => b.createdAt - a.createdAt);
  const start = cursor || 0;
  const items = sorted.slice(start, start + limit);
  const nextCursor = start + items.length;
  return { items, nextCursor: nextCursor < sorted.length ? nextCursor : 0 };
}

export async function getAlbumItem(id: string): Promise<AlbumItem | undefined> {
  const all = await getAll();
  return all.find((i) => i.id === id);
}

/** 收集图片入库：去重键 = sourceUrl + sourcePageUrl */
export async function collectImage(
  imageUrl: string,
  pageUrl: string,
  alt?: string
): Promise<{ id: string; duplicate: boolean }> {
  const all = await getAll();
  const dup = all.find((i) => i.kind === 'collect' && i.sourceUrl === imageUrl && i.sourcePageUrl === pageUrl);
  if (dup) return { id: dup.id, duplicate: true };

  // 抓取图片 → blob
  const resp = await fetch(imageUrl, { credentials: 'omit' });
  if (!resp.ok) throw new Error('FETCH_BLOCKED');
  const blob = await resp.blob();
  if (!blob.type.startsWith('image/')) throw new Error('FETCH_BLOCKED');

  const id = genId('c_');
  const blobKey = `collect:${id}`;
  await putImage(blobKey, blob);

  const item: AlbumItem = {
    id,
    kind: 'collect',
    blobKey,
    sourceUrl: imageUrl,
    sourcePageUrl: pageUrl,
    createdAt: Date.now(),
  };
  all.push(item);
  await saveAll(all);
  return { id, duplicate: false };
}

/** 生成结果入库 */
export async function addGenerated(
  blobKeys: string[],
  meta: { prompt?: string; model?: string; taskType?: string; aspect?: string }
): Promise<AlbumItem[]> {
  const all = await getAll();
  const now = Date.now();
  const items = blobKeys.map((blobKey, idx): AlbumItem => {
    const id = genId('g_');
    return {
      id,
      kind: 'generate',
      blobKey,
      prompt: idx === 0 ? meta.prompt : undefined,
      model: meta.model,
      taskType: meta.taskType,
      aspect: meta.aspect,
      createdAt: now,
    };
  });
  all.push(...items);
  await saveAll(all);
  return items;
}

/** 删除相册条目（连带删除 blob） */
export async function deleteAlbumItem(id: string): Promise<void> {
  const all = await getAll();
  const item = all.find((i) => i.id === id);
  if (!item) return;
  await deleteImages([item.blobKey]);
  await saveAll(all.filter((i) => i.id !== id));
}

/** 按 blobKey 取 dataURL（供面板展示） */
export async function albumBlobToDataUrl(blobKey: string): Promise<string> {
  // ★ 防御：空/非法 key 直接按"图片不存在"处理，避免 IDBObjectStore.get 抛原生错误
  if (typeof blobKey !== 'string' || blobKey === '') throw new Error('image-not-found');
  const blob = await getImage(blobKey);
  if (!blob) throw new Error('image-not-found');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function albumHasKey(blobKey: string): Promise<boolean> {
  return hasImage(blobKey);
}
