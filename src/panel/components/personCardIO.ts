/**
 * 人物卡导入 / 导出（设备迁移用）
 * - 导入：把手里的成品三视图卡图直接存成人物卡，不调 AI、不产生任务
 * - 导出：把卡图下载成文件，换设备/重装后用它重新导入
 *
 * ★ 导入的卡与生成出来的卡在数据上完全同构：blobKeys 只有一张图、sourceCount 为 0。
 *   下游（换脸 / 双参考重绘 / 拍一套）只认 blobKeys 最后一张图，不判断来源，
 *   所以这里不做任何「导入卡」专用分支，也不需要新增卡片类型字段。
 */

import { send, toast } from '../ui';
import { genId } from '../../shared/utils/image';
import { putImage, deleteImage } from '../../background/store/db';
import type { PersonCard } from '../../shared/types';

/** 本地文件后缀猜 mime 太脆，直接用 dataURL 里的真实 mime 决定下载后缀 */
function extOf(dataUrl: string): string {
  const mime = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl)?.[1]?.toLowerCase() ?? 'png';
  if (mime === 'jpeg') return 'jpg';
  if (mime === 'svg+xml') return 'svg';
  return mime;
}

/** 文件名里不能出现的字符换成下划线 */
function safeName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\r\n\t]+/g, '_').trim().slice(0, 40);
  return cleaned || 'card';
}

/** 选一张本地图片（取消则返回 null） */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * 导入成品卡：选中一张图 → 原图入 IndexedDB → 建卡（sourceCount=0、跳过生成）
 * 成功后返回新卡；失败返回 null 并释放已入库的 blob，不留孤儿
 */
export async function importPersonCard(): Promise<PersonCard | null> {
  const file = await pickFile();
  if (!file) return null;

  const key = `card-img:${genId()}`;
  try {
    // 成品卡是资产，原样保存（不压缩），与「新建人物卡」存源图的处理一致
    await putImage(key, file);
  } catch {
    toast('图片保存失败，请重试');
    return null;
  }

  try {
    const res = await send<{ card: PersonCard }>('person-card-create', {
      blobKeys: [key],
      skipGenerate: true,
    });
    toast(`已导入人物卡「${res.card.name}」`);
    return res.card;
  } catch (e) {
    await deleteImage(key).catch(() => {});
    toast((e as Error).message);
    return null;
  }
}

/** 导出卡图（即卡上最后一张 = 三视图卡 / 导入的原图），供换设备后重新导入 */
export async function exportPersonCard(id: string, name: string): Promise<void> {
  try {
    const { dataUrl } = await send<{ dataUrl: string }>('person-card-get', { id });
    await send('download-file', {
      url: dataUrl,
      filename: `shiyin-card-${safeName(name)}.${extOf(dataUrl)}`,
    });
    toast('已开始下载卡图');
  } catch (e) {
    toast((e as Error).message);
  }
}
