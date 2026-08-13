/**
 * 图片选择器组件
 * 来源切换：相册 / 上传
 * 暗房样式：取景框缩略图 + chip 来源按钮
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { setHtml } from '../../shared/dom';

export function renderImageSelector(container: HTMLElement): void {
  const s = getState();
  const selected = s.selectedImage;

  setHtml(
    container,
    `
    <div style="display:flex;gap:12px;align-items:center;">
      ${
        selected
          ? `<div class="frame" style="width:72px;height:72px;flex-shrink:0;"><img src="${selected}" alt="已选图"></div>`
          : `<div class="frame" style="width:72px;height:72px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--ink-3);"><i data-lucide="image" data-size="24"></i></div>`
      }
      <div style="flex:1;min-width:0;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="chip" data-src="album">相册</button>
          <button class="chip" data-src="upload">上传</button>
          ${selected ? `<button class="chip" data-src="clear" style="color:var(--ink-3);">清除</button>` : ''}
        </div>
        <p class="micro" style="margin:8px 0 0;">${s.selectedImageMeta?.source ?? '未选择图片'}</p>
      </div>
    </div>
  `
  );

  container.querySelectorAll<HTMLElement>('[data-src]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.src;
      if (mode === 'clear') {
        setState({ selectedImage: null, selectedImageMeta: null });
        return;
      }
      await pickImage(mode as 'album' | 'upload');
    });
  });
}

async function pickImage(mode: 'album' | 'upload'): Promise<void> {
  if (mode === 'album') {
    try {
      const { items } = await send<{ items: { id: string }[] }>('album-list', { cursor: 0, limit: 20 });
      if (items.length === 0) {
        toast('相册为空，先在网页悬停图片点「影/＋」，或上传图片');
        return;
      }
      // 简单方案：打开相册 Tab 选择（此处直接在相册视图选择后回填）
      toast('请到「相册」Tab 选择图片');
      setState({ tab: 'album' });
    } catch {
      toast('相册读取失败');
    }
    return;
  }

  // 上传
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    try {
      const res = await send<{ dataUrl: string }>('image-upload', { dataUrl });
      setState({
        selectedImage: res.dataUrl,
        selectedImageMeta: { name: file.name, source: '本地上传' },
      });
    } catch (e) {
      toast((e as Error).message);
    }
  };
  input.click();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
