/**
 * 拾影 ShiYing · 工具函数
 */

/** dataURL → Blob */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, commaIdx);
  const b64 = dataUrl.slice(commaIdx + 1);
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Blob → dataURL */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 加载图片元素 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = src;
  });
}

/**
 * 图片压缩 / 降采样：限制最长边。
 * 输出格式：源图为 PNG（含透明通道）→ 保留 PNG；其余 → JPEG。
 * ★ SW 安全实现：createImageBitmap + OffscreenCanvas（不依赖 window/document），
 *   供后台 Service Worker 调用（此前用 new Image()/canvas 在 SW 里必抛 ReferenceError）。
 */
export async function compressImage(
  src: string,
  maxEdge = 2048,
  quality = 0.9
): Promise<string> {
  const isPng = /data:image\/png|\.png($|\?)/i.test(src);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(dataUrlToBlob(src));
  } catch {
    throw new Error('image-load-failed');
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const out = await canvas.convertToBlob(isPng ? { type: 'image/png' } : { type: 'image/jpeg', quality });
  return await blobToDataUrl(out);
}

/**
 * 按中心十字把一张 2×2 四宫格大图切成 4 张。
 * 返回 [左上, 右上, 左下, 右下] 的 dataURL 数组。
 */
export async function splitPhotoSuiteGrid(src: string): Promise<string[]> {
  const img = await loadImage(src);
  const w = img.width;
  const h = img.height;
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const quadrants: [number, number][] = [
    [0, 0],
    [hw, 0],
    [0, hh],
    [hw, hh],
  ];
  const results: string[] = [];
  for (const [sx, sy] of quadrants) {
    const canvas = document.createElement('canvas');
    canvas.width = hw;
    canvas.height = hh;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-unavailable');
    ctx.drawImage(img, sx, sy, hw, hh, 0, 0, hw, hh);
    results.push(canvas.toDataURL('image/jpeg', 0.92));
  }
  return results;
}

/**
 * 拼图法 fallback：把人物卡人脸缩小贴到构图图右下角。
 * 用于服务商不支持多图输入的 edits 场景。
 * ★ SW 安全实现（同 compressImage，不依赖 window/document）。
 */
export async function composeFaceBadge(
  sourceDataUrl: string,
  faceDataUrl: string,
  badgeSize = 120
): Promise<string> {
  let src: ImageBitmap;
  let face: ImageBitmap;
  try {
    [src, face] = await Promise.all([
      createImageBitmap(dataUrlToBlob(sourceDataUrl)),
      createImageBitmap(dataUrlToBlob(faceDataUrl)),
    ]);
  } catch {
    throw new Error('image-load-failed');
  }
  const canvas = new OffscreenCanvas(src.width, src.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  ctx.drawImage(src, 0, 0);
  const s = badgeSize;
  const x = src.width - s - 20;
  const y = src.height - s - 20;
  // 圆形裁切人脸
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(face, x, y, s, s);
  ctx.restore();
  // 白描边
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  src.close();
  face.close();
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return await blobToDataUrl(out);
}

/** 随机 id */
export function genId(prefix = ''): string {
  return (
    prefix +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8)
  );
}
