/**
 * 相册 Tab
 * 网格浏览 · 分页 · 删除 · 选中作为生成输入
 * 暗房：contact-sheet 接触印 + 取景框角标 + Lucide 图标
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { setHtml } from '../../shared/dom';
import { iconSvg } from '../../shared/icons';
import { timeAgo } from '../../shared/utils/text';
import type { AlbumItem } from '../../shared/types';

let cursor = 0;
let hasMore = true;
let loading = false;

export function renderAlbumView(container: HTMLElement): void {
  const s = getState();
  container.innerHTML = `
    <div style="padding-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <p class="section-label" style="margin:0;">本地相册</p>
        <button class="link" id="btn-refresh" style="font-size:11px;">${iconSvg('refresh-cw', { size: 11, className: 'lucide' })} 刷新</button>
      </div>
      <div id="album-grid"></div>
      <div id="album-load-more" style="text-align:center;padding:12px;"></div>
    </div>
  `;

  cursor = 0;
  hasMore = true;
  loadMore(container, true);

  container.querySelector('#btn-refresh')!.addEventListener('click', () => {
    cursor = 0;
    hasMore = true;
    loadMore(container, true);
  });
}

async function loadMore(container: HTMLElement, replace: boolean): Promise<void> {
  if (loading) return;
  loading = true;
  const grid = container.querySelector<HTMLElement>('#album-grid')!;
  const loadBox = container.querySelector<HTMLElement>('#album-load-more')!;

  try {
    const res = await send<{ items: AlbumItem[]; nextCursor: number }>('album-list', {
      cursor,
      limit: 50,
    });
    hasMore = res.nextCursor > 0;
    cursor = res.nextCursor;

    if (replace) {
      grid.innerHTML = '';
      if (res.items.length === 0) {
        setHtml(
          grid,
          `
          <div class="empty">
            <div class="empty-icon">${iconSvg('images', { size: 22, className: 'lucide' })}</div>
            <p>相册还是空的</p>
            <p style="font-size:11px;margin-top:4px;">去网页上悬停图片点「+」收集，或完成一次生成</p>
          </div>
          `
        );
        loadBox.innerHTML = '';
        loading = false;
        return;
      }
    }

    const html = res.items
      .map(
        (item, idx) => `
        <div class="frame album-cell" data-idx="${cursor - res.items.length + idx}" data-id="${item.id}" style="cursor:pointer;aspect-ratio:1/1;">
          <div data-load="${item.id}" style="width:100%;height:100%;background:var(--bg-3);"></div>
          <span class="pill ${item.kind === 'collect' ? 'pill-neutral' : 'pill-blue'}" style="position:absolute;top:6px;left:6px;z-index:2;font-size:9px;">${item.kind === 'collect' ? '收集' : '生成'}</span>
          <button class="icon-btn" data-del="${item.id}" title="删除" style="position:absolute;top:6px;right:6px;width:24px;height:24px;background:rgba(8,8,11,.72);z-index:2;">${iconSvg('trash-2', { size: 12, className: 'lucide' })}</button>
          <p style="position:absolute;bottom:6px;left:8px;font-size:9px;color:var(--ink-3);margin:0;z-index:2;">${timeAgo(item.createdAt)}</p>
        </div>
      `
      )
      .join('');

    if (replace) {
      setHtml(grid, `<div class="contact-sheet cols-3">${html}</div>`);
    } else {
      const wrap = grid.querySelector('.contact-sheet');
      if (wrap) wrap.innerHTML += html;
    }

    // 懒加载缩略图
    container.querySelectorAll<HTMLElement>('[data-load]').forEach((el) => {
      if (el.dataset.loaded) return;
      el.dataset.loaded = '1';
      const id = el.dataset.load!;
      void send<{ dataUrl: string }>('album-get', { id })
        .then((r) => {
          el.innerHTML = `<img src="${r.dataUrl}" data-preview="1" style="width:100%;height:100%;object-fit:cover;">`;
        })
        .catch(() => {});
    });

    // 删除
    container.querySelectorAll<HTMLElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.del!;
        await send('album-delete', { id });
        toast('已删除');
        btn.closest('.album-cell')?.remove();
      });
    });

    // 选中作为输入
    container.querySelectorAll<HTMLElement>('[data-id]').forEach((cell) => {
      cell.addEventListener('click', async () => {
        const id = cell.dataset.id!;
        try {
          const res = await send<{ dataUrl: string }>('album-get', { id });
          setState({
            selectedImage: res.dataUrl,
            selectedImageMeta: { source: '来自相册' },
            tab: 'analyze',
          });
          toast('已选为构图参考图，去「反推重绘」继续');
        } catch (e) {
          toast((e as Error).message);
        }
      });
    });

    // 加载更多
    loadBox.innerHTML = hasMore
      ? `<button class="btn btn-secondary" style="font-size:12px;" id="btn-more">加载更多</button>`
      : `<span class="micro">已到底部</span>`;
    container.querySelector('#btn-more')?.addEventListener('click', () => {
      loadMore(container, false);
    });
  } catch (e) {
    toast((e as Error).message);
  } finally {
    loading = false;
  }
}
