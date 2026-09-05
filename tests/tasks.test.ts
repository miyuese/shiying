/**
 * 任务队列 / 看门狗 / 串行执行器 集成测试
 * 覆盖历史上出过致命 bug 的核心链路（此前零自动化覆盖）：
 * - createTask 硬截止 deadline
 * - watchdogStaleTasks 超时强杀 + abort
 * - recoverTasks SW 重启恢复
 * - sanitizeTask 剥 dataURL 保留 blobKey
 * - enqueue 串行顺序 + withTimeout 超时 reject
 *
 * chrome.storage.local 用内存 Map 模拟；IndexedDB 层（store/db）整体 mock 掉。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TASK_EXEC_TIMEOUT, TASK_STALE_MS } from '../src/shared/constants';

/* ---- chrome.storage.local 内存模拟 ---- */
const store = new Map<string, unknown>();

function makeChromeStub() {
  return {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (key: string) => {
          store.delete(key);
        },
      },
    },
  };
}

vi.stubGlobal('chrome', makeChromeStub());

/* IndexedDB 层不参与本测试（watchdog/recover 路径不触库） */
vi.mock('../src/background/store/db', () => ({
  putImage: vi.fn(),
  deleteImages: vi.fn(),
  getImage: vi.fn(),
  hasImage: vi.fn(async () => false),
}));

import {
  createTask,
  updateTask,
  forceFailTask,
  watchdogStaleTasks,
  recoverTasks,
  purgeTasksToFitQuota,
  onTaskChange,
  registerTaskAbort,
  enqueue,
} from '../src/background/tasks';
import type { Task } from '../src/shared/types';

async function seedTask(partial: Partial<Task>): Promise<Task> {
  const base: Task = {
    id: partial.id ?? `t_seed_${Math.random().toString(36).slice(2, 8)}`,
    type: 'redraw',
    status: 'pending',
    inputs: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
  store.set('tasks', [...((store.get('tasks') as Task[]) ?? []), base]);
  return base;
}

beforeEach(() => {
  store.clear();
});

describe('createTask', () => {
  it('创建 pending 任务并写入 7 分钟硬截止 deadline', async () => {
    const before = Date.now();
    const task = await createTask('redraw', { prompt: 'x' });

    expect(task.status).toBe('pending');
    expect(task.deadline).toBeGreaterThanOrEqual(before + TASK_EXEC_TIMEOUT);
    expect(task.deadline).toBeLessThanOrEqual(Date.now() + TASK_EXEC_TIMEOUT);

    const persisted = (store.get('tasks') as Task[]).find((t) => t.id === task.id);
    expect(persisted?.deadline).toBe(task.deadline);
  });

  it('任务创建时通过 onTaskChange 广播', async () => {
    const seen: Task[] = [];
    const off = onTaskChange((t) => seen.push(t));
    await createTask('faceswap', {});
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('faceswap');
  });
});

describe('watchdogStaleTasks', () => {
  it('deadline 已过的 running 任务被置 failed 并触发 abort', async () => {
    const stale = await seedTask({ status: 'running', deadline: Date.now() - 1000 });
    let aborted = false;
    registerTaskAbort(stale.id, {
      abort: () => {
        aborted = true;
      },
    } as AbortController);

    const { stuck } = await watchdogStaleTasks();

    expect(stuck).toBe(1);
    expect(aborted).toBe(true);
    const persisted = (store.get('tasks') as Task[]).find((t) => t.id === stale.id);
    expect(persisted?.status).toBe('failed');
    expect(persisted?.error).toContain('超时');
  });

  it('deadline 未到的任务不受影响；无 deadline 时按 updatedAt + TASK_STALE_MS 兜底', async () => {
    await seedTask({ status: 'running', deadline: Date.now() + 60_000 });
    await seedTask({ status: 'running', updatedAt: Date.now() - TASK_STALE_MS - 1000 });

    const { stuck } = await watchdogStaleTasks();

    expect(stuck).toBe(1);
    const tasks = store.get('tasks') as Task[];
    expect(tasks.find((t) => t.deadline && t.deadline > Date.now())?.status).toBe('running');
    expect(tasks.filter((t) => t.status === 'failed')).toHaveLength(1);
  });

  it('done/failed 终态任务不被看门狗改动', async () => {
    await seedTask({ status: 'done', deadline: Date.now() - 1000 });
    await seedTask({ status: 'failed', deadline: Date.now() - 1000 });
    const { stuck } = await watchdogStaleTasks();
    expect(stuck).toBe(0);
  });
});

describe('recoverTasks', () => {
  it('SW 重启后 running/pending 全部转 failed 并提示可重试', async () => {
    await seedTask({ status: 'running' });
    await seedTask({ status: 'pending' });
    await seedTask({ status: 'done' });

    await recoverTasks();

    const tasks = store.get('tasks') as Task[];
    expect(tasks.filter((t) => t.status === 'failed')).toHaveLength(2);
    expect(tasks.filter((t) => t.status === 'done')).toHaveLength(1);
    for (const t of tasks.filter((t) => t.status === 'failed')) {
      expect(t.error).toContain('浏览器重启');
    }
  });
});

describe('sanitizeTask（持久化时剥离 dataURL）', () => {
  it('dataURL 输入被清除，blobKey 引用保留', async () => {
    const task = await createTask('redraw', {
      sourceRef: 'data:image/png;base64,AAAA',
      faceRef: 'data:image/jpeg;base64,BBBB',
      sourceBlobKey: 'regen-src:abc',
      prompt: 'keep',
    });

    const persisted = (store.get('tasks') as Task[]).find((t) => t.id === task.id) as Task & {
      inputs: Record<string, unknown>;
    };
    expect(persisted.inputs.sourceRef).toBeUndefined();
    expect(persisted.inputs.faceRef).toBeUndefined();
    expect(persisted.inputs.sourceBlobKey).toBe('regen-src:abc');
    expect(persisted.inputs.prompt).toBe('keep');
  });
});

describe('updateTask / forceFailTask', () => {
  it('updateTask 合并 patch 并刷新 updatedAt', async () => {
    const task = await seedTask({ status: 'pending', updatedAt: Date.now() - 5000 });
    const updated = await updateTask(task.id, { status: 'running', progress: 30 });
    expect(updated?.status).toBe('running');
    expect(updated?.progress).toBe(30);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000);
  });

  it('forceFailTask 置 failed、写原因，不存在的任务返回 undefined', async () => {
    const task = await seedTask({ status: 'running' });
    const failed = await forceFailTask(task.id, '前端兜底超时');
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('前端兜底超时');
    expect(await forceFailTask('t_missing', 'x')).toBeUndefined();
  });
});

describe('purgeTasksToFitQuota', () => {
  it('超过 50 条时裁剪到最近 10 条并清理 dataURL', async () => {
    for (let i = 0; i < 15; i++) {
      await seedTask({ status: 'done', inputs: { sourceRef: 'data:image/png;base64,XX' } });
    }
    const { purged, freed } = await purgeTasksToFitQuota();
    expect(purged).toBe(5);
    expect(freed).toBe(true);
    const tasks = store.get('tasks') as Task[];
    expect(tasks).toHaveLength(10);
    for (const t of tasks) expect(t.inputs.sourceRef).toBeUndefined();
  });
});

describe('enqueue（串行执行器）', () => {
  it('任务按顺序串行执行，前一个完成才开始下一个', async () => {
    const events: string[] = [];
    const p1 = enqueue(async () => {
      events.push('a-start');
      await new Promise((r) => setTimeout(r, 20));
      events.push('a-end');
      return 'a';
    });
    const p2 = enqueue(async () => {
      events.push('b-start');
      return 'b';
    });
    expect(await p1).toBe('a');
    expect(await p2).toBe('b');
    expect(events).toEqual(['a-start', 'a-end', 'b-start']);
  });

  it('前一个任务失败不阻塞后续任务', async () => {
    const p1 = enqueue(async () => {
      throw new Error('boom');
    });
    const p2 = enqueue(async () => 'ok');
    await expect(p1).rejects.toThrow('boom');
    expect(await p2).toBe('ok');
  });

  it('任务执行超过 TASK_EXEC_TIMEOUT 被 withTimeout 强制 TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const p = enqueue(
        () => new Promise<string>(() => {}) // 永不 resolve
      );
      const assertion = expect(p).rejects.toThrow('TIMEOUT');
      await vi.advanceTimersByTimeAsync(TASK_EXEC_TIMEOUT + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
