/**
 * 面板任务轮询（反推重绘 / 换脸 / 拍一套三个 Tab 共享）
 * - 3 秒轮询 task-status，前端真实时钟超时兜底强制失败（不依赖 SW 计时器，前端永不休眠）
 * - 终态统一刷新结果区、恢复提交按钮、失败 toast 带具体原因
 * - 修复历史欠账：轮询查询异常 / 次数耗尽不再静默停止，均给出明确提示
 */
import { send, toast } from './ui';
import { renderInlineProgress } from './components/taskProgress';
import { POLL_INTERVAL, TASK_EXEC_TIMEOUT } from '../shared/constants';
import type { Task } from '../shared/types';

/** 轮询安全上限（次数）：3s × 160 = 480s，大于任务硬截止 420s，正常由 deadline 兜底先触发 */
const MAX_POLL_TRIES = 160;
/** 连续查询失败上限：超过视为与后台通信中断 */
const MAX_CONSECUTIVE_ERRORS = 5;

export interface PollTaskOptions {
  /** 本 Tab 内联进度容器选择器 */
  resultSelector: string;
  /** 任务类型中文名（超时/失败提示文案用，如「换脸」「拍一套」） */
  label: string;
  /** 每次快照回调（视图更新 lastTaskSnapshot，供重渲染恢复内联进度） */
  onSnapshot?: (task: Task) => void;
  /** 终态后恢复本页提交按钮 */
  resetButton?: () => void;
  /** done 且有结果图时的自定义展示（不传则保留内联进度卡） */
  onDone?: (task: Task) => Promise<void> | void;
}

export function pollTaskUntilSettled(taskId: string, opts: PollTaskOptions): void {
  let tries = 0;
  let consecutiveErrors = 0;
  const startedAt = Date.now();

  const refreshResults = async () => {
    const panel = (await import('./index')).panelApi;
    await panel.refreshTasks();
  };

  const iv = setInterval(async () => {
    tries++;
    // 安全上限：正常应在 deadline 兜底前进入终态；走到这里说明状态异常，明确告知而不是静默断掉
    if (tries > MAX_POLL_TRIES) {
      clearInterval(iv);
      opts.resetButton?.();
      opts.onSnapshot?.({ id: taskId, status: 'failed', error: '任务状态未知（轮询超时）' } as Task);
      toast(`${opts.label}状态未知：任务长时间无响应，请重新打开面板查看`);
      return;
    }

    let task: Task;
    try {
      task = await send<Task>('task-status', { taskId });
      consecutiveErrors = 0;
    } catch {
      // 瞬时失败（SW 冷启动等）容忍几次；连续失败视为与后台通信中断
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        clearInterval(iv);
        opts.resetButton?.();
        toast('与后台通信中断，任务状态未知，请重试或重新打开面板');
      }
      return;
    }

    opts.onSnapshot?.(task);
    const box = document.querySelector<HTMLElement>(opts.resultSelector);

    if (task.status === 'pending' || task.status === 'running') {
      // 前端真实时钟兜底：超过截止时间强制失败
      const deadline = task.deadline ?? startedAt + TASK_EXEC_TIMEOUT;
      if (Date.now() > deadline) {
        clearInterval(iv);
        await send('task-force-fail', { taskId }).catch(() => {});
        await refreshResults().catch(() => {});
        const failed = { ...task, status: 'failed', error: `${opts.label}超时（超过 7 分钟），请重试` } as Task;
        opts.onSnapshot?.(failed);
        if (box) renderInlineProgress(box, failed);
        opts.resetButton?.();
        toast(`${opts.label}超时（超过 7 分钟），请重试`);
        return;
      }
      if (box) renderInlineProgress(box, task);
      return;
    }

    // 终态：done / failed / cancelled
    clearInterval(iv);
    await refreshResults().catch(() => {});
    if (box) renderInlineProgress(box, task);
    if (task.status === 'done') {
      opts.resetButton?.();
      if (task.result?.blobKeys?.length) {
        await opts.onDone?.(task);
      } else {
        toast(`${opts.label}完成`);
      }
    } else if (task.status === 'failed') {
      opts.resetButton?.();
      toast(`${opts.label}失败：${task.error ?? '未知原因'}`);
    } else {
      opts.resetButton?.();
      toast(`${opts.label}已取消`);
    }
  }, POLL_INTERVAL);
}
