/**
 * 面部参考选择器（人物卡 / 直接上传照片 二选一）
 * - 有人物卡 → 卡片列表模式，可一键切换「直接传 1~2 张照片」
 * - 直接照片与人物卡互斥：有照片时生成走照片，选卡后生成走卡片
 * - 直接照片支持「存成人物卡」（走 person-card-create，自动生成三视图卡）
 * - suiteMode：拍一套页使用（可选，默认不选；再点已选卡片取消），状态字段用 suiteCardId
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { iconSvg } from '../../shared/icons';
import { importPersonCard } from './personCardIO';
import type { PersonCard } from '../../shared/types';

/** 直接上传面部参考照片上限 */
export const MAX_DIRECT_FACE_IMAGES = 2;

export function renderFaceReferenceSelector(
  container: HTMLElement,
  opts: { suiteMode?: boolean; optional?: boolean } = {}
): void {
  const s = getState();
  if (s.directFaceImages.length > 0) {
    renderPhotosMode(container, Boolean(opts.suiteMode));
  } else {
    renderCardMode(container, Boolean(opts.suiteMode), Boolean(opts.optional));
  }
}

/* ---------------- 人物卡模式 ---------------- */

function renderCardMode(container: HTMLElement, suiteMode: boolean, optional: boolean): void {
  const s = getState();
  const cards = s.personCards;
  const selectedId = suiteMode ? s.suiteCardId : s.selectedCardId;

  // 无卡：仍提供「直接传照片」入口（没有人物卡也能用面部参考）
  if (cards.length === 0) {
    container.innerHTML = `
      <div class="card" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:12px;color:var(--ink-3);">还没有人物卡</span>
        <button class="link" id="go-create-card">去创建 →</button>
      </div>
      <button class="chip" id="import-card" style="margin-top:8px;">${iconSvg('upload', { size: 12, className: 'lucide' })} 或导入已有三视图卡图 →</button>
      <button class="chip" id="use-photos" style="margin-top:6px;">或直接传 1~2 张照片做面部参考 →</button>
    `;
    container.querySelector('#go-create-card')!.addEventListener('click', () => {
      setState({ tab: 'personCard' });
    });
    container.querySelector('#import-card')!.addEventListener('click', async () => {
      const card = await importPersonCard();
      if (!card) return;
      const panel = (await import('../index')).panelApi;
      await panel.refreshPersonCards();
      setState({ directFaceImages: [], selectedCardId: card.id, suiteCardId: card.id });
    });
    container.querySelector('#use-photos')!.addEventListener('click', () => void pickPhoto());
    return;
  }

  const hint = suiteMode
    ? selectedId
      ? `已选 <strong class="num" style="color:var(--ink-1);">${cards.find((c) => c.id === selectedId)?.name ?? '人物卡'}</strong>，再点一下可取消`
      : '默认不选 · 点卡片选中，再点一下取消'
    : optional
      ? selectedId
        ? `已选 <strong class="num" style="color:var(--ink-1);">${cards.find((c) => c.id === selectedId)?.name ?? '人物卡'}</strong>，再点一下取消 · 不选也能生成`
        : '可选 · 不选就只用底图 + 提示词生成'
      : '点击卡片选择面部参考';

  container.innerHTML = `
    <p class="micro" style="margin-bottom:8px;">${hint}</p>
    ${cards
      .map(
        (c) => `
        <div class="card card-hover" data-card-id="${c.id}" style="margin-bottom:6px;display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;${
          c.id === selectedId ? 'border-color:var(--border-blue);background:var(--blue-soft);' : ''
        }">
          <div class="face-thumb" style="width:36px;height:36px;" data-card-thumb="${c.id}"></div>
          <div style="flex:1;min-width:0;">
            <p style="font-size:12px;color:var(--ink-1);margin:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</p>
            <p style="font-size:10px;color:var(--ink-3);margin:0;">${c.sourceCount > 0 ? `${c.sourceCount} 张源图` : '成品卡图'}${c.isDefault ? ' · 默认' : ''}</p>
          </div>
          ${c.isDefault ? '<span class="pill pill-blue">默认</span>' : ''}
        </div>`
      )
      .join('')}
    <button class="chip" id="use-photos" style="margin-top:6px;">或直接传 1~2 张照片做面部参考 →</button>
  `;

  container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    const id = el.dataset.cardId!;
    el.addEventListener('click', () => {
      if (suiteMode) {
        setState({ suiteCardId: getState().suiteCardId === id ? '' : id });
      } else if (optional) {
        // 可选模式（自定义提示词）：再点已选卡片即取消，允许完全不使用面部参考
        setState({ selectedCardId: getState().selectedCardId === id ? '' : id });
      } else {
        setState({ selectedCardId: id });
      }
    });
    const thumb = container.querySelector<HTMLElement>(`[data-card-thumb="${id}"]`);
    if (thumb) {
      void send<{ dataUrl: string }>('person-card-get', { id })
        .then((r) => {
          thumb.innerHTML = `<img src="${r.dataUrl}" data-preview="1" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        })
        .catch(() => {});
    }
  });
  container.querySelector('#use-photos')!.addEventListener('click', () => void pickPhoto());
}

/* ---------------- 直接照片模式 ---------------- */

function renderPhotosMode(container: HTMLElement, _suiteMode: boolean): void {
  const photos = getState().directFaceImages;
  container.innerHTML = `
    <div class="card" style="padding:10px 14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <p style="font-size:12px;color:var(--ink-1);margin:0;font-weight:500;">直接照片 · 面部参考（与人物卡互斥）</p>
        <button class="link" id="use-card" style="font-size:11px;">改用人物卡</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        ${photos
          .map(
            (p, i) => `
            <div style="position:relative;width:56px;height:56px;">
              <img src="${p}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;border:0.5px solid var(--hairline);">
              <button class="icon-btn" data-remove-photo="${i}" title="移除" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;">${iconSvg('x', { size: 11, className: 'lucide' })}</button>
            </div>`
          )
          .join('')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary" id="add-photo" style="font-size:11px;padding:5px 10px;" ${
          photos.length >= MAX_DIRECT_FACE_IMAGES ? 'disabled' : ''
        }>${iconSvg('plus', { size: 12, className: 'lucide' })} 添加照片</button>
        <button class="btn btn-secondary" id="save-to-card" style="font-size:11px;padding:5px 10px;">${iconSvg('user-round', { size: 12, className: 'lucide' })} 存成人物卡</button>
      </div>
      ${
        photos.length > 1
          ? '<p class="micro" style="margin:8px 0 0;">提示：多张面部参考需服务商支持多图 edits（第一张=构图、第二张起=人脸）。若不支持，模型可能只读取第一张。</p>'
          : ''
      }
    </div>
  `;

  container.querySelector('#use-card')!.addEventListener('click', () => {
    setState({ directFaceImages: [] });
  });
  container.querySelector('#add-photo')!.addEventListener('click', () => void pickPhoto());
  container.querySelector('#save-to-card')!.addEventListener('click', async () => {
    const btn = container.querySelector('#save-to-card') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      const res = await send<{ card: PersonCard }>('person-card-create', { images: [...photos] });
      toast(`已存成人物卡「${res.card.name}」`);
      const panel = (await import('../index')).panelApi;
      await panel.refreshPersonCards();
      // 互斥切回人物卡模式并选中新卡
      setState({ directFaceImages: [], selectedCardId: res.card.id, suiteCardId: res.card.id });
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.innerHTML = `${iconSvg('user-round', { size: 12, className: 'lucide' })} 存成人物卡`;
    }
  });
  container.querySelectorAll<HTMLElement>('[data-remove-photo]').forEach((el) => {
    el.addEventListener('click', () => {
      const i = Number(el.dataset.removePhoto);
      setState({ directFaceImages: photos.filter((_, idx) => idx !== i) });
    });
  });
}

/* ---------------- 上传 ---------------- */

async function pickPhoto(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const s = getState();
    if (s.directFaceImages.length >= MAX_DIRECT_FACE_IMAGES) {
      toast(`最多 ${MAX_DIRECT_FACE_IMAGES} 张`);
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    try {
      // 复用 image-upload：压缩到 2048 内，控制消息体积
      const res = await send<{ dataUrl: string }>('image-upload', { dataUrl });
      setState({ directFaceImages: [...s.directFaceImages, res.dataUrl] });
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
