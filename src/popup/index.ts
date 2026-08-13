/**
 * Popup 弹窗入口
 * 当前页图片快捷操作 + 最近任务
 */

import '../shared/fonts';
import { send, toast } from '../panel/ui';
import { WORKBENCH_CHANNEL, TASK_CHANGED_EVENT } from '../shared/messages';
import { hydrateIcons, iconSvg } from '../shared/icons';
import { setHtml } from '../shared/dom';
import type { Task } from '../shared/types';
import { installErrorCapture } from '../background/store/errorLog';

// 全局错误捕获（popup 端）
installErrorCapture('popup');

let currentImageUrl = '';

async function init(): Promise<void> {
  const actReverse = document.getElementById('act-reverse') as HTMLButtonElement;
  const actSwap = document.getElementById('act-swap') as HTMLButtonElement;
  const actSuite = document.getElementById('act-suite') as HTMLButtonElement;
  const actCollect = document.getElementById('act-collect') as HTMLButtonElement;
  const thumb = document.getElementById('thumb')!;
  const meta = document.getElementById('img-meta')!;

  // 尝试从当前激活 Tab 找图片（content 悬停过的图）
  try {
    // 先主动注入悬浮脚本（页面在扩展加载前打开也能生效）
    await chrome.runtime.sendMessage({ type: 'inject-content' }).catch(() => null);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (tab?.id) {
      // 通过 background 查询最近悬停图片
      const res = await chrome.runtime
        .sendMessage({ type: 'get-last-image' })
        .catch(() => ({ imageUrl: '' }));
      if (res?.imageUrl) {
        currentImageUrl = res.imageUrl;
        thumb.innerHTML = '';
        const img = document.createElement('img');
        img.src = currentImageUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;';
        img.onerror = () => {
          thumb.innerHTML = iconSvg('image');
          meta.textContent = '图片可能无法直接预览';
        };
        thumb.appendChild(img);
        meta.textContent = `${tab.url?.split('/')[2] ?? ''} · 点击可操作`;
        [actReverse, actSwap, actSuite, actCollect].forEach((b) => (b.disabled = false));
      } else {
        meta.textContent = '先在网页上悬停一张图片再打开这里';
      }
    }
  } catch {
    /* 无图则不启用 */
  }

  actReverse.addEventListener('click', async () => {
    await storePendingImage();
    void openPanelWithImage('analyze');
  });
  actSwap.addEventListener('click', async () => {
    await storePendingImage();
    void openPanelWithImage('faceswap');
  });
  actSuite.addEventListener('click', async () => {
    await storePendingImage();
    void openPanelWithImage('suite');
  });

  actCollect.addEventListener('click', async () => {
    if (!currentImageUrl) {
      toast('当前没有可收集的图片');
      return;
    }
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const res = await send<{ id: string; duplicate: boolean }>('image-collect', {
        imageUrl: currentImageUrl,
        pageUrl: tabs[0]?.url ?? '',
        alt: '',
      });
      toast(res.duplicate ? '已在相册中' : '已存入相册');
    } catch (e) {
      toast((e as Error).message);
    }
  });

  document.getElementById('btn-panel')!.addEventListener('click', async () => {
    await storePendingImage();
    await openSidePanel();
    window.close();
  });

  document.getElementById('btn-options')!.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  // 任务列表
  void refreshTasks();

  const port = chrome.runtime.connect({ name: WORKBENCH_CHANNEL });
  port.onMessage.addListener((msg: { event: string }) => {
    if (msg.event === TASK_CHANGED_EVENT) void refreshTasks();
  });

  // 静态 HTML 里的图标水合
  hydrateIcons(document);
}

/**
 * 打开侧边栏。popup 本身由用户点击扩展图标打开 → 属于用户手势上下文，
 * 这里直接调用 chrome.sidePanel.open() 可以成功（不经过 background 转发，避免手势丢失）。
 */
async function openSidePanel(): Promise<void> {
  try {
    const win = await chrome.windows.getCurrent();
    if (win.id !== undefined) {
      await chrome.sidePanel.open({ windowId: win.id });
      return;
    }
  } catch {
    /* 继续走兜底 */
  }
  // 兜底：独立窗口
  await chrome.runtime.sendMessage({ type: 'open-panel-fallback' });
}

async function openPanelWithImage(tab: string): Promise<void> {
  await storePendingImage();
  await openSidePanel();
  window.close();
}

/** 把当前图存到后台，panel 启动后读取 */
async function storePendingImage(): Promise<void> {
  if (!currentImageUrl) return;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tabs[0]?.url ?? '';
    const r = await send<{ dataUrl: string }>('image-from-url', { url: currentImageUrl });
    await send('set-pending-image', { dataUrl: r.dataUrl, pageUrl });
  } catch {
    /* 跨域图片可能抓不到 → 不阻塞，用户可手动上传 */
  }
}

async function refreshTasks(): Promise<void> {
  try {
    const tasks = await send<Task[]>('task-list', { limit: 3 });
    const box = document.getElementById('tasks')!;
    if (tasks.length === 0) {
      setHtml(box, '<p style="font-size:11px;color:var(--text-3);">暂无任务</p>');
      return;
    }
    setHtml(
      box,
      tasks
      .map((t) => {
        const label = t.type === 'faceswap' ? '换脸' : t.type === 'suite' ? '拍一套' : t.type === 'personCard' ? '人物卡' : '重绘';
        const dot =
          t.status === 'done'
            ? 'dot-green'
            : t.status === 'failed'
              ? 'dot-red'
              : t.status === 'running' || t.status === 'pending'
                ? 'dot-blue'
                : 'dot-amber';
        const statusText =
          t.status === 'done' ? '完成' : t.status === 'failed' ? '失败' : t.status === 'running' ? `生成中 ${t.progress ?? ''}%` : t.status === 'cancelled' ? '已取消' : '排队中';
        const errorLine = t.status === 'failed' && t.error
          ? `<p style="font-size:10px;color:var(--red);margin:4px 0 0;line-height:1.4;">${escapeHtml(t.error)}</p>`
          : '';
        return `
          <div class="task-row" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <div style="display:flex;align-items:center;gap:8px;width:100%;">
              <span class="dot ${dot}"></span>
              <span style="font-size:11px;color:var(--text-2);flex:1;">${label} · ${statusText}</span>
            </div>
            ${errorLine}
          </div>`;
      })
      .join('')
    );
  } catch {
    /* 忽略 */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
