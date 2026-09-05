/**
 * 任务进度提示条（全局）
 * 固定在面板底部：任务提交/进行中/完成/失败都可见，含进度百分比。
 * 暗房样式：进度条 + 渐变填充 + shimmer 扫光；状态图标用 Lucide。
 */

import { getState, setState, subscribe } from '../state';
import { iconSvg } from '../../shared/icons';
import type { Task } from '../../shared/types';

const LABEL: Record<string, string> = {
  faceswap: '换脸',
  suite: '拍一套',
  personCard: '人物卡',
  redraw: '重绘',
  analyze: '反推',
};

const containerId = 'task-progress-bar';

/** 全局进度条的「已等待 X 秒」计时器（本地真实时钟，1 秒一跳） */
let elapsedTicker: ReturnType<typeof setInterval> | null = null;

function stopElapsedTicker(): void {
  if (elapsedTicker) {
    clearInterval(elapsedTicker);
    elapsedTicker = null;
  }
}

function startElapsedTicker(): void {
  if (elapsedTicker) return;
  elapsedTicker = setInterval(() => {
    const t = getState().activeTask;
    const el = document.getElementById(containerId);
    const span = el?.querySelector<HTMLElement>('[data-elapsed]');
    if (!t || !span) return;
    if (t.status !== 'running' && t.status !== 'pending') {
      stopElapsedTicker();
      return;
    }
    const sec = Math.max(0, Math.floor((Date.now() - (t.updatedAt ?? Date.now())) / 1000));
    span.textContent = ` · 已等待 ${sec} 秒`;
  }, 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 根据任务状态渲染 */
export function renderTaskProgressBar(): void {
  const s = getState();
  let el = document.getElementById(containerId);
  if (!s.activeTask) {
    stopElapsedTicker();
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = containerId;
    el.className = 'task-progress';
    document.body.appendChild(el);
  }

  const t = s.activeTask;
  const label = LABEL[t.type] ?? t.type;
  const pct = t.progress ?? 0;

  if (t.status !== 'running' && t.status !== 'pending') {
    stopElapsedTicker();
  }

  if (t.status === 'done') {
    el.innerHTML = `
      <div class="tp-row">
        ${iconSvg('check', { size: 14, className: 'lucide ok' })}
        <span class="tp-title ok">${label}完成</span>
        <span class="tp-hint auto">结果已生成，可在「最近任务」查看</span>
      </div>`;
    // 2.5 秒后自动消失
    setTimeout(() => {
      const cur = getState();
      if (cur.activeTask?.id === t.id && cur.activeTask?.status === 'done') setState({ activeTask: null });
    }, 2500);
    return;
  }

  if (t.status === 'failed') {
    el.innerHTML = `
      <div class="tp-row" style="align-items:flex-start;">
        ${iconSvg('alert-triangle', { size: 14, className: 'lucide err' })}
        <span class="tp-title err">${label}失败</span>
        <span class="tp-hint auto" style="opacity:.85;">${t.error ?? '未知错误'}</span>
      </div>`;
    setTimeout(() => {
      const cur = getState();
      if (cur.activeTask?.id === t.id && cur.activeTask?.status === 'failed') setState({ activeTask: null });
    }, 6000);
    return;
  }

  if (t.status === 'cancelled') {
    el.innerHTML = `<div class="tp-row"><span class="tp-hint">已取消</span></div>`;
    setTimeout(() => setState({ activeTask: null }), 2000);
    return;
  }

  // running / pending
  startElapsedTicker();
  const pctText = t.status === 'running' ? `${pct}%` : '排队中…';
  const hint =
    t.statusText && !t.statusText.includes('已等待')
      ? `${escapeHtml(t.statusText)}<span data-elapsed></span>`
      : t.statusText
        ? escapeHtml(t.statusText)
        : 'AI 生图通常需要 1~7 分钟，请耐心等待';
  el.innerHTML = `
    <div class="tp-row">
      <span class="dot dot-blue"></span>
      <span class="tp-title">${label}生成中</span>
      <span class="tp-pct num">${pctText}</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${Math.max(4, pct)}%"></div>
      <div class="shimmer"></div>
    </div>
    <div class="tp-hint">${hint}</div>`;
}

/**
 * 内联进度卡（三个生图页专用）：提交任务后，在当前页面直接显示进度，
 * 避免用户看不到"是否已开始工作"而反复提交。done 后由各视图用结果渲染覆盖本容器。
 */
export function renderInlineProgress(
  container: HTMLElement,
  task: { type?: string; status: string; progress?: number; error?: string; statusText?: string }
): void {
  const label = LABEL[task.type ?? ''] ?? '生成';
  const pct = task.progress ?? 0;

  if (task.status === 'done') {
    container.innerHTML = `
      <div class="card" style="padding:12px;display:flex;align-items:center;gap:8px;">
        ${iconSvg('check', { size: 15, className: 'lucide ok' })}
        <span style="font-size:12px;color:var(--green);font-weight:500;">${label}完成</span>
        <span style="font-size:11px;color:var(--ink-3);margin-left:auto;">结果已生成，可在「最近任务」查看</span>
      </div>`;
    return;
  }

  if (task.status === 'failed') {
    container.innerHTML = `
      <div class="card" style="padding:12px;display:flex;align-items:flex-start;gap:8px;">
        ${iconSvg('alert-triangle', { size: 15, className: 'lucide err' })}
        <span style="font-size:12px;color:var(--red);font-weight:500;flex:1;">${label}失败：${task.error ?? '未知错误'}</span>
      </div>`;
    return;
  }

  if (task.status === 'cancelled') {
    container.innerHTML = `<div class="card" style="padding:12px;"><span style="font-size:12px;color:var(--ink-3);">已取消</span></div>`;
    return;
  }

  // pending / running
  const pctText = task.status === 'running' ? `${pct}%` : '排队中…';
  container.innerHTML = `
    <div class="card" style="padding:12px;">
      <div class="tp-row">
        <span class="dot dot-blue"></span>
        <span class="tp-title">${label}生成中</span>
        <span class="tp-pct num">${pctText}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${Math.max(4, pct)}%"></div>
        <div class="shimmer"></div>
      </div>
      <div class="tp-hint">${task.statusText ? escapeHtml(task.statusText) : 'AI 生图通常需要 1~7 分钟，请耐心等待'}</div>
    </div>`;
}

/** 订阅状态变化自动渲染 */
export function initTaskProgress(): void {
  subscribe(() => renderTaskProgressBar());
}

/** 把任务广播接入 activeTask（由 panel/index.ts 调用） */
export function syncActiveTask(task: Task): void {
  const cur = getState();
  if (task.status === 'pending' || task.status === 'running') {
    setState({ activeTask: task });
  } else if (cur.activeTask?.id === task.id) {
    setState({ activeTask: task }); // done/failed 也展示一下
  }
}
