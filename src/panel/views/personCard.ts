/**
 * 人物卡 Tab
 * 上传 1~5 图 → 建卡（全部源图参与生成三视图卡）→ 命名/默认/删除
 * 暗房：取景框头像 + 三态状态行（check/alert-triangle/clock）+ overlay/modal-sheet 弹窗
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { iconSvg } from '../../shared/icons';
import { timeAgo } from '../../shared/utils/text';
import type { PersonCard } from '../../shared/types';
import { PERSON_CARD_MAX_SOURCES } from '../../shared/constants';
import { genId } from '../../shared/utils/image';
// 面板与 background 同源，直接写同一个 IndexedDB（原图直传：Blob 入库 → 只传 key，不压缩不转 dataURL）
import { putImage, deleteImage } from '../../background/store/db';

export function renderPersonCardView(container: HTMLElement): void {
  const s = getState();

  container.innerHTML = `
    <div style="padding-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <p class="section-label" style="margin:0;">人物卡 · 人脸参考资产</p>
        <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" id="btn-new">${iconSvg('plus', { size: 14, className: 'lucide' })} 新建人物卡</button>
      </div>

      <div id="card-list"></div>
    </div>
  `;

  renderCardList(container.querySelector('#card-list')!);

  container.querySelector('#btn-new')!.addEventListener('click', () => {
    openCreateCardModal(container);
  });
}

function renderCardList(container: HTMLElement): void {
  const s = getState();
  const cards = s.personCards;
  const pendingCards = cards.filter((c) => c.blobKeys.length <= c.sourceCount && !c.genError);

  // 等待中的卡片 → 启动真实时钟超时检查（前端永不休眠，兜底 SW 休眠）
  if (pendingCards.length > 0) {
    // 查最近人物卡任务的截止时间（用 inputs.cardId 精确定位，避免误伤其他卡的任务）
    void send<{ id: string; type: string; status: string; deadline?: number; inputs?: { cardId?: string } }[]>('task-list', { limit: 10 })
      .then((tasks) => {
        for (const c of pendingCards) {
          const related = tasks.find(
            (t) =>
              t.type === 'personCard' &&
              (t.status === 'running' || t.status === 'pending') &&
              t.inputs?.cardId === c.id
          );
          if (related && related.deadline && Date.now() > related.deadline) {
            void send('task-force-fail', { taskId: related.id }).catch(() => {});
            // 刷新人物卡，让 genError 出现
            const panelApi = (window as unknown as { panelApi?: { refreshPersonCards: () => Promise<void> } }).panelApi;
            void panelApi?.refreshPersonCards?.();
            break;
          }
        }
      })
      .catch(() => {});
  }

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${iconSvg('user-round', { size: 22, className: 'lucide' })}</div>
        <p>还没有人物卡</p>
        <p style="font-size:11px;margin-top:4px;">上传 1~${PERSON_CARD_MAX_SOURCES} 张人物照片，生成标准三视图身份卡</p>
        <button class="btn btn-secondary" style="margin-top:12px;font-size:12px;" id="empty-new">去创建</button>
      </div>
    `;
    container.querySelector('#empty-new')?.addEventListener('click', () => {
      openCreateCardModal(container);
    });
    return;
  }

  container.innerHTML = cards
    .map(
      (c) => `
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="face-thumb" style="width:48px;height:48px;border-radius:10px;" data-thumb="${c.id}"></div>
          <div style="flex:1;min-width:0;">
            <p style="font-size:13px;color:var(--ink-1);margin:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</p>
            <p style="font-size:10px;color:var(--ink-3);margin:2px 0 0;">${c.sourceCount} 张源图 · ${timeAgo(c.createdAt)}${c.isDefault ? ' · 默认' : ''}</p>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${c.isDefault ? '' : `<button class="icon-btn" data-default="${c.id}" title="设为默认">${iconSvg('star', { size: 14, className: 'lucide' })}</button>`}
            <button class="icon-btn" data-del="${c.id}" title="删除">${iconSvg('trash-2', { size: 14, className: 'lucide' })}</button>
          </div>
        </div>
        ${
          c.blobKeys.length > c.sourceCount
            ? `<p style="font-size:10px;color:var(--green);margin:6px 0 0;">${iconSvg('check', { size: 12, className: 'lucide' })} 三视图卡已生成</p>`
            : c.genError
              ? `<p style="font-size:10px;color:var(--red);margin:6px 0 0;">${iconSvg('alert-triangle', { size: 12, className: 'lucide' })} 三视图卡生成失败：${c.genError}</p>
                 <button class="link" data-regenerate="${c.id}" style="font-size:10px;margin-top:2px;">重新生成 →</button>`
              : `<p style="font-size:10px;color:var(--amber);margin:6px 0 0;">${iconSvg('clock', { size: 12, className: 'lucide' })} 等待生成三视图卡…（源图已存）</p>`
        }
      </div>
    `
    )
    .join('');

  // 缩略图
  container.querySelectorAll<HTMLElement>('[data-thumb]').forEach((el) => {
    const id = el.dataset.thumb!;
    void send<{ dataUrl: string }>('person-card-get', { id })
      .then((r) => {
        el.innerHTML = `<img src="${r.dataUrl}" data-preview="1" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
      })
      .catch(() => {});
  });

  // 设默认
  container.querySelectorAll<HTMLElement>('[data-default]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await send('person-card-set-default', { id: btn.dataset.default! });
      toast('已设为默认人物卡');
      const panel = (await import('../index')).panelApi;
      await panel.refreshPersonCards();
    });
  });

  // 删除
  container.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除这张人物卡？')) return;
      await send('person-card-delete', { id: btn.dataset.del! });
      toast('已删除');
      const panel = (await import('../index')).panelApi;
      await panel.refreshPersonCards();
    });
  });

  // 重新生成三视图卡（原图直传：用卡上全部源图 blobKey 作为多角度身份参考，不再只取第一张）
  container.querySelectorAll<HTMLElement>('[data-regenerate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const cardId = btn.dataset.regenerate!;
      try {
        const card = await send<{ card: PersonCard }>('person-card-get', { id: cardId });
        // 只用源图（前 sourceCount 张），排除已挂上的旧三视图卡
        const sourceKeys = card.card.blobKeys.slice(0, card.card.sourceCount);
        if (sourceKeys.length === 0) {
          toast('卡片没有源图，无法重新生成');
          return;
        }
        // 先清除错误标记，回到等待态
        await send('person-card-clear-error', { id: cardId });
        await send('generate-image', {
          prompt: '',
          intent: 'personCard',
          sourceBlobKeys: sourceKeys,
          keepSourceBlob: true, // 源图是卡片资产，生成完不删除
          aspectRatio: '16:9',
          cardId,
        });
        toast('已重新提交生成，请稍候…');
        const panel = (await import('../index')).panelApi;
        await panel.refreshPersonCards();
      } catch (e) {
        toast((e as Error).message);
      }
    });
  });
}

/** 新建人物卡弹窗（overlay + modal-sheet） */
function openCreateCardModal(container: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';

  overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-head">
        <p style="font-size:14px;font-weight:500;color:var(--ink-1);margin:0;">新建人物卡</p>
        <button class="icon-btn" id="modal-close" title="关闭">${iconSvg('x', { size: 14, className: 'lucide' })}</button>
      </div>
      <div class="modal-body">
        <p class="section-label">上传 1~${PERSON_CARD_MAX_SOURCES} 张人物照片</p>
        <div id="preview" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;"></div>
        <button class="btn btn-secondary btn-block" id="modal-pick" style="font-size:12px;margin-bottom:10px;">${iconSvg('plus', { size: 14, className: 'lucide' })} 选择照片</button>
        <input class="input" id="modal-name" placeholder="卡片名称（可选）" style="margin-bottom:12px;">
        <button class="btn btn-primary btn-block" id="modal-create" style="padding:11px;">创建</button>
        <p style="font-size:10px;color:var(--ink-3);margin:10px 0 0;text-align:center;">创建后会自动提交生成标准三视图卡</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  // 选中文件：原图 Blob 直接存入 IndexedDB（不压缩、不转 dataURL），只保留 key + 预览 URL
  const files: { key: string; previewUrl: string }[] = [];

  const cleanup = () => {
    for (const f of files) {
      URL.revokeObjectURL(f.previewUrl);
      void deleteImage(f.key).catch(() => {});
    }
    files.length = 0;
  };
  overlay.querySelector('#modal-close')!.addEventListener('click', () => {
    cleanup();
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      cleanup();
      overlay.remove();
    }
  });

  const renderPreview = () => {
    const box = overlay.querySelector('#preview')!;
    box.innerHTML = files
      .map(
        (f, i) => `
        <div style="position:relative;">
          <img src="${f.previewUrl}" style="width:100%;aspect-ratio:1/1;border-radius:8px;object-fit:cover;border:0.5px solid var(--hairline);">
          <button class="icon-btn" data-remove="${i}" title="移除" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;">${iconSvg('x', { size: 11, className: 'lucide' })}</button>
        </div>`
      )
      .join('') || '<div class="empty" style="padding:16px 8px;">未选择</div>';
    box.querySelectorAll<HTMLElement>('[data-remove]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.remove);
        const removed = files.splice(idx, 1)[0];
        if (removed) {
          URL.revokeObjectURL(removed.previewUrl);
          void deleteImage(removed.key).catch(() => {});
        }
        renderPreview();
      });
    });
  };
  renderPreview();

  overlay.querySelector('#modal-pick')!.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = async () => {
      const list = Array.from(input.files ?? []);
      for (const file of list) {
        if (files.length >= PERSON_CARD_MAX_SOURCES) {
          toast(`最多 ${PERSON_CARD_MAX_SOURCES} 张`);
          break;
        }
        const key = `card-src:${genId()}`;
        try {
          await putImage(key, file); // 原样存储，不压缩
        } catch {
          toast('图片保存失败，请重试');
          continue;
        }
        files.push({ key, previewUrl: URL.createObjectURL(file) });
      }
      renderPreview();
    };
    input.click();
  });

  overlay.querySelector('#modal-create')!.addEventListener('click', async () => {
    if (files.length === 0) {
      toast('请至少选择 1 张照片');
      return;
    }
    const name = (overlay.querySelector('#modal-name') as HTMLInputElement).value.trim();
    const btn = overlay.querySelector('#modal-create') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '创建中…';
    try {
      // 原图直传：只传 blobKey，不传 base64 大字符串
      await send('person-card-create', { blobKeys: files.map((f) => f.key), name });
      toast('人物卡已创建');
      // 源图已归卡片所有，避免重复释放
      for (const f of files) URL.revokeObjectURL(f.previewUrl);
      files.length = 0;
      overlay.remove();
      const panel = (await import('../index')).panelApi;
      await panel.refreshPersonCards();
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.textContent = '创建';
    }
  });
}
