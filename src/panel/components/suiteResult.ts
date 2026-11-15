/**
 * 套图结果拆解（拍一套页与底部结果抽屉共用）
 * 后台按「人像批 → 配图批」顺序各存一张拼图，这里按配比切回单张、标注归属，
 * 并做会话内缓存：同一任务不重复读图 / 重复切分（切分走 canvas，4 张要几百毫秒）。
 */

import { send } from '../ui';
import { splitGrid } from '../../shared/utils/image';
import { suiteLayout } from '../../shared/prompts';
import type { Task } from '../../shared/types';

export interface SuiteItem {
  url: string;
  kind: 'portrait' | 'scene';
}

export interface SuiteMix {
  portrait: number;
  scene: number;
}

/** 从任务记录读回配比；旧任务按成图张数兜底推断 */
export function suiteMixOf(task: Task): SuiteMix {
  const mix = (task.inputs as { suiteMix?: Partial<SuiteMix> } | undefined)?.suiteMix;
  const hasPortrait = typeof mix?.portrait === 'number';
  const hasScene = typeof mix?.scene === 'number';
  if (hasPortrait || hasScene) {
    const portrait = hasPortrait ? Math.max(0, Math.min(4, mix!.portrait!)) : Math.max(0, 4 - (mix!.scene ?? 0));
    const scene = hasScene ? Math.max(0, Math.min(4, mix!.scene!)) : Math.max(0, 4 - portrait);
    if (portrait + scene > 0) return { portrait, scene };
  }
  // 兜底：改造前的任务只存一张四宫格 → 4 张人像；混合档丢了配比时存两张拼图 → 2+2
  const keys = task.result?.blobKeys?.length ?? 0;
  if (keys >= 2) return { portrait: 2, scene: 2 };
  return { portrait: 4, scene: 0 };
}

export function suiteMixLabel(mix: SuiteMix): string {
  if (mix.scene === 0) return '4 张人像';
  if (mix.portrait === 0) return '4 张配图';
  return `${mix.portrait} 人像 + ${mix.scene} 配图`;
}

/** 切一批：1 张直出、2 张左右切、3~4 张 2×2 切 */
async function splitBatch(blobKey: string, count: number): Promise<string[]> {
  const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key: blobKey });
  const layout = suiteLayout(count);
  if (layout === 'single') return [dataUrl];
  const parts = layout === 'pair' ? await splitGrid(dataUrl, 2, 1) : await splitGrid(dataUrl, 2, 2);
  return parts.slice(0, count);
}

/** 把一次套图任务的成图拆成逐张结果（人像在前、配图在后） */
export async function buildSuiteItems(task: Task): Promise<SuiteItem[]> {
  const keys = task.result?.blobKeys ?? [];
  const { portrait, scene } = suiteMixOf(task);
  const items: SuiteItem[] = [];
  let ki = 0;
  if (portrait > 0 && keys[ki]) {
    const parts = await splitBatch(keys[ki++]!, portrait);
    parts.forEach((url) => items.push({ url, kind: 'portrait' }));
  }
  if (scene > 0 && keys[ki]) {
    const parts = await splitBatch(keys[ki++]!, scene);
    parts.forEach((url) => items.push({ url, kind: 'scene' }));
  }
  // 兜底：切分异常或异常旧数据 → 至少把原始成图呈现出来，不留空白
  if (items.length === 0 && keys[0]) {
    const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key: keys[0] });
    items.push({ url: dataUrl, kind: 'portrait' });
  }
  return items;
}

/* ---------------- 会话内缓存（同一 taskId 只拆一次） ---------------- */

let cacheTaskId = '';
let cacheItems: SuiteItem[] = [];

export async function suiteItemsFor(task: Task): Promise<SuiteItem[]> {
  if (cacheTaskId === task.id && cacheItems.length > 0) return cacheItems;
  const items = await buildSuiteItems(task);
  cacheTaskId = task.id;
  cacheItems = items;
  return items;
}

/** 视图重渲染时同步取已切好的结果（没有则返回 null，由调用方决定是否重新加载） */
export function peekSuiteItems(taskId: string): SuiteItem[] | null {
  return cacheTaskId === taskId && cacheItems.length > 0 ? cacheItems : null;
}
