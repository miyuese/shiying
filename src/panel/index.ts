/**
 * 面板入口：初始化 + 渲染
 */

import '../shared/fonts';
import { getState, setState, subscribe } from './state';
import { send } from './ui';
import { renderPreserved } from '../shared/dom';
import { WORKBENCH_CHANNEL, TASK_CHANGED_EVENT, PENDING_IMAGE_READY_EVENT } from '../shared/messages';
import { renderAnalyzeView } from './views/analyze';
import { renderFaceswapView } from './views/faceswap';
import { renderSuiteView } from './views/suite';
import { renderAlbumView } from './views/album';
import { renderPersonCardView } from './views/personCard';
import { renderResultBar } from './components/resultBar';
import { configStatus } from '../shared/configStatus';
import type { Settings, Task, PersonCard } from '../shared/types';
import { ASPECT_OPTIONS, GENERATE_MODEL_OPTIONS, PROFILE_OPTIONS } from '../shared/constants';
import { installErrorCapture } from '../background/store/errorLog';
import { initTaskProgress, syncActiveTask } from './components/taskProgress';

// 全局错误捕获（panel 端）
installErrorCapture('panel');

const TABS = [
  { id: 'analyze', label: '反推重绘' },
  { id: 'faceswap', label: '换脸' },
  { id: 'suite', label: '拍一套' },
  { id: 'album', label: '相册' },
  { id: 'personCard', label: '人物卡' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const app = document.getElementById('app')!;

/** 上一次渲染的 tab（用于 view-enter 入场动画门控：只在切换时动画，不挂通用重渲染） */
let prevTab: TabId | null = null;

/** 应用后台挂起的参考图（网页「影」按钮 / popup 传入） */
async function applyPendingImage(): Promise<void> {
  try {
    const pending = await send<{ dataUrl: string; pageUrl?: string } | null>('get-pending-image');
    if (pending?.dataUrl) {
      setState({
        selectedImage: pending.dataUrl,
        selectedImageMeta: { source: pending.pageUrl ? `来自 ${new URL(pending.pageUrl).hostname}` : '来自当前网页' },
      });
      void send('clear-pending-image');
    }
  } catch {
    /* 忽略 */
  }
}

async function init(): Promise<void> {
  // 拉取初始数据
  try {
    const settings = await send<Settings>('settings-get');
    setState({ settings });
  } catch {
    /* 设置拉取失败忽略 */
  }

  // 读取网页「影」按钮 / popup 传来的待选图
  await applyPendingImage();
  // 面板已打开时，后台设置挂起图后会广播 → 即时应用（无需重启面板）
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type === PENDING_IMAGE_READY_EVENT) void applyPendingImage();
  });

  await refreshPersonCards();
  await refreshTasks();

  renderShell();
  subscribe(() => renderShell());
  initTaskProgress();

  // 长连接接收任务广播
  const port = chrome.runtime.connect({ name: WORKBENCH_CHANNEL });
  port.onMessage.addListener((msg: { event: string; task: Task }) => {
    if (msg.event === TASK_CHANGED_EVENT) {
      void refreshTasks();
      syncActiveTask(msg.task);
      // 人物卡任务结束（成功或失败）→ 刷新人物卡列表，让 UI 及时反映
      if (msg.task.type === 'personCard' && (msg.task.status === 'done' || msg.task.status === 'failed')) {
        void refreshPersonCards();
      }
    }
  });
}

async function refreshPersonCards(): Promise<void> {
  try {
    const cards = await send<PersonCard[]>('person-card-list');
    setState({ personCards: cards });
    if (!getState().selectedCardId) {
      const settings = getState().settings;
      const defaultId = settings?.defaultPersonCardId ?? '';
      const valid = cards.some((c) => c.id === defaultId);
      setState({ selectedCardId: valid ? defaultId : (cards[0]?.id ?? '') });
    }
  } catch {
    /* 忽略 */
  }
}

async function refreshTasks(): Promise<void> {
  try {
    const tasks = await send<Task[]>('task-list', { limit: 4 });
    setState({ results: tasks });
  } catch {
    /* 忽略 */
  }
}

function renderShell(): void {
  const s = getState();
  const status = configStatus(s.settings as Parameters<typeof configStatus>[0]);
  const statusDot = status === 'all' ? 'dot-green' : status === 'partial' ? 'dot-amber' : 'dot-red';
  const statusText = status === 'all' ? '已连接' : status === 'partial' ? '部分配置' : '未配置';

  // 入场动画门控：仅在 tab 切换（含首次）时挂 view-enter
  const tabChanged = s.tab !== prevTab;
  prevTab = s.tab;
  const viewClass = tabChanged ? 'view view-enter' : 'view';

  const tabsHtml = TABS.map(
    (t, i) => `
    <button class="tab-item ${s.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
      <span class="tab-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="tab-label">${t.label}</span>
    </button>`
  ).join('');

  const banner =
    status !== 'all'
      ? `<div class="banner-warn">请先完成 API 配置 <button class="link" data-action="open-options">去配置</button></div>`
      : '';

  // 保持当前滚动位：同 tab 重渲染（如任务进度更新）不跳顶
  const oldView = document.getElementById('view');
  const prevScroll = oldView ? oldView.scrollTop : 0;

  renderPreserved(
    app,
    `
    <div class="masthead">
      <div class="masthead-brand">
        <div class="logo">影</div>
        <div class="brand-stack">
          <span class="masthead-title">拾影</span>
          <span class="masthead-kicker">ShiYing · Darkroom</span>
        </div>
      </div>
      <div class="masthead-actions">
        <span class="status-chip"><span class="dot ${statusDot}"></span>${statusText}</span>
        <button class="icon-btn" data-action="open-options" title="设置" aria-label="设置"><i data-lucide="settings"></i></button>
      </div>
    </div>
    ${banner}
    <div class="tab-rail">${tabsHtml}</div>
    <div class="${viewClass}" id="view"></div>
    <div class="result-bar" id="result-bar"></div>
  `
  );

  // 渲染当前视图（renderPreserved 的焦点/光标恢复已在微任务里，晚于本轮同步渲染）
  const view = document.getElementById('view')!;
  switch (s.tab) {
    case 'analyze':
      renderAnalyzeView(view);
      break;
    case 'faceswap':
      renderFaceswapView(view);
      break;
    case 'suite':
      renderSuiteView(view);
      break;
    case 'album':
      renderAlbumView(view);
      break;
    case 'personCard':
      renderPersonCardView(view);
      break;
  }
  if (prevScroll > 0) view.scrollTop = prevScroll;

  // 结果区
  const resultBar = document.getElementById('result-bar')!;
  renderResultBar(resultBar);

  // Tab 切换
  app.querySelectorAll<HTMLElement>('.tab-item').forEach((el) => {
    el.addEventListener('click', () => {
      setState({ tab: el.dataset.tab as TabId });
    });
  });

  // 打开设置
  app.querySelectorAll<HTMLElement>('[data-action="open-options"]').forEach((el) => {
    el.addEventListener('click', () => {
      void chrome.runtime.openOptionsPage();
    });
  });
}

// 暴露给视图的公共方法
export const panelApi = {
  refreshPersonCards,
  refreshTasks,
};

init();
