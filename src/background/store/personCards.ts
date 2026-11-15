/**
 * 人物卡 CRUD（元数据 storage.local，图片 blob IndexedDB）
 */

import type { PersonCard } from '../../shared/types';
import { storage, KEYS } from './storage';
import { putImage, deleteImages, getImage } from './db';
import { genId } from '../../shared/utils/image';
import { PERSON_CARD_MAX_COUNT } from '../../shared/constants';
import { getSettings, saveSettings } from '../settings';

async function getAll(): Promise<PersonCard[]> {
  return storage.get<PersonCard[]>(KEYS.personCards, []);
}

async function saveAll(cards: PersonCard[]): Promise<void> {
  await storage.set(KEYS.personCards, cards);
}

export async function listPersonCards(): Promise<PersonCard[]> {
  return getAll();
}

export async function getPersonCard(id: string): Promise<PersonCard | undefined> {
  const all = await getAll();
  return all.find((c) => c.id === id);
}

/**
 * 创建人物卡：
 * - 新路径：面板已把源图 Blob 存入 IndexedDB，直接沿用其 blobKeys（原图直传，不压缩）
 * - 旧路径：传 dataURL 列表，这里转 Blob 入库（兼容）
 */
export async function createPersonCard(
  images: string[],
  name?: string,
  blobKeys?: string[]
): Promise<{ card: PersonCard; blobKeys: string[] }> {
  const all = await getAll();
  if (all.length >= PERSON_CARD_MAX_COUNT) {
    throw new Error('PERSON_CARD_LIMIT');
  }
  const id = genId('pc_');
  const now = Date.now();

  // 源图入库
  const keys: string[] = [];
  if (blobKeys && blobKeys.length > 0) {
    keys.push(...blobKeys);
  } else {
    for (let i = 0; i < images.length; i++) {
      const key = `personCard:${id}:src${i}`;
      const blob = dataUrlToBlob(images[i]!);
      await putImage(key, blob);
      keys.push(key);
    }
  }

  // 是否有默认卡
  const hasDefault = all.some((c) => c.isDefault);
  const settings = await getSettings();

  const card: PersonCard = {
    id,
    name: name?.trim() || `人物卡 ${now.toString(36).slice(-4).toUpperCase()}`,
    blobKeys: keys,
    sourceCount: keys.length,
    isDefault: !hasDefault,
    createdAt: now,
  };
  all.push(card);
  await saveAll(all);

  // 若无默认卡，则设为默认
  if (!hasDefault) {
    await saveSettings({ ...settings, defaultPersonCardId: id });
  }
  return { card, blobKeys: keys };
}

/** 生成成功后，把三视图卡图也挂到人物卡上（blobKeys 末尾追加） */
export async function attachCardImage(cardId: string, blobKey: string): Promise<void> {
  const all = await getAll();
  const card = all.find((c) => c.id === cardId);
  if (!card) return;
  card.blobKeys = [...card.blobKeys, blobKey];
  card.genError = undefined;
  await saveAll(all);
}

/** 记录三视图卡生成失败原因 */
export async function setCardGenError(cardId: string, error: string): Promise<void> {
  const all = await getAll();
  const card = all.find((c) => c.id === cardId);
  if (!card) return;
  card.genError = error;
  await saveAll(all);
}

/** 清除生成错误标记（重新生成时调用） */
export async function clearCardGenError(cardId: string): Promise<void> {
  const all = await getAll();
  const card = all.find((c) => c.id === cardId);
  if (!card) return;
  card.genError = undefined;
  await saveAll(all);
}

export async function deletePersonCard(id: string): Promise<void> {
  const all = await getAll();
  const card = all.find((c) => c.id === id);
  if (!card) return;
  await deleteImages(card.blobKeys);
  await saveAll(all.filter((c) => c.id !== id));

  // 若删除的是默认卡，重新选一张或清空
  const settings = await getSettings();
  if (settings.defaultPersonCardId === id) {
    const remaining = all.filter((c) => c.id !== id);
    const nextDefault = remaining.find((c) => c.isDefault) ?? remaining[0];
    if (nextDefault) {
      nextDefault.isDefault = true;
      await saveAll(all.filter((c) => c.id !== id).map((c) => (c.id === nextDefault.id ? nextDefault : c)));
      await saveSettings({ ...settings, defaultPersonCardId: nextDefault.id });
    } else {
      await saveSettings({ ...settings, defaultPersonCardId: '' });
    }
  }
}

export async function setDefaultPersonCard(id: string): Promise<void> {
  const all = await getAll();
  const target = all.find((c) => c.id === id);
  if (!target) return;
  for (const c of all) c.isDefault = c.id === id;
  await saveAll(all);
  const settings = await getSettings();
  await saveSettings({ ...settings, defaultPersonCardId: id });
}

/**
 * 重命名人物卡（用户自定义名称）
 * 空名视为取消，保留原名；返回最新卡片供 UI 即时更新
 */
export async function renamePersonCard(id: string, name: string): Promise<PersonCard | undefined> {
  const all = await getAll();
  const card = all.find((c) => c.id === id);
  if (!card) return undefined;
  const next = name.trim();
  if (!next) return card;
  card.name = next;
  await saveAll(all);
  return card;
}

/** 人物卡图 dataURL（取最后一张 = 三视图卡，否则第一张源图） */
export async function personCardDataUrl(card: PersonCard): Promise<string> {
  // 优先展示生成的三视图卡（blobKeys 最后一张），否则第一张源图
  const key = card.blobKeys[card.blobKeys.length - 1];
  const blob = key ? await getImage(key) : undefined;
  if (!blob) throw new Error('image-not-found');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta?.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin = atob(b64!);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
