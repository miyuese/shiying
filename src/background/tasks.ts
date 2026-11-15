/**
 * 任务队列（串行）+ 持久化 + 恢复
 * 防止 MV3 Service Worker 休眠导致状态丢失
 */

import type { Task, TaskStatus, TaskType } from '../shared/types';
import { TASK_MAX_KEEP, TASK_EXEC_TIMEOUT, TASK_STALE_MS } from '../shared/constants';
import { storage, KEYS } from './store/storage';
import { genId } from '../shared/utils/image';
import { putImage, deleteImages, getImage, hasImage, listImageKeys } from './store/db';

type Listener = (task: Task) => void;
const listeners = new Set<Listener>();

/** 广播任务变更 */
export function onTaskChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(task: Task) {
  for (const fn of listeners) fn(task);
}

async function loadTasks(): Promise<Task[]> {
  return storage.get<Task[]>(KEYS.tasks, []);
}

async function persist(tasks: Task[]) {
  // 只保留最近 N 条
  let trimmed = tasks.slice(-TASK_MAX_KEEP);
  // 清理：去掉 task.inputs 中可能遗留的 base64 dataURL（不占 storage 配额）
  trimmed = trimmed.map(sanitizeTask);
  await storage.set(KEYS.tasks, trimmed);
}

/** 去掉 task.inputs 中的大字段（sourceRef/faceRef dataURL），保留 blobKey 引用 */
function sanitizeTask(t: Task): Task {
  if (!t.inputs || typeof t.inputs !== 'object') return t;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t.inputs)) {
    if ((k === 'sourceRef' || k === 'faceRef') && typeof v === 'string' && v.startsWith('data:')) {
      // dataURL 字段清空，调用方应改用 blobKey
      continue;
    }
    // faceRefs：直接上传的多张人脸参考 dataURL 数组，同样清空（落盘引用见 persistRegenInputs）
    if (k === 'faceRefs' && Array.isArray(v) && v.every((x) => typeof x === 'string' && (x as string).startsWith('data:'))) {
      continue;
    }
    cleaned[k] = v;
  }
  return { ...t, inputs: cleaned };
}

/**
 * 一次性深度清理：把历史上所有 task.inputs 中的 dataURL 全部删除，
 * 并裁剪到 TASK_MAX_KEEP 条。解决 storage 配额超限问题。
 */
export async function purgeTasksToFitQuota(): Promise<{ purged: number; freed: boolean }> {
  const tasks = await loadTasks();
  if (tasks.length === 0) return { purged: 0, freed: false };
  const cleaned = tasks.map(sanitizeTask);
  // 保留最近 10 条（远小于 50），彻底腾出空间
  const trimmed = cleaned.slice(-10);
  try {
    await storage.set(KEYS.tasks, trimmed);
    return { purged: tasks.length - trimmed.length, freed: true };
  } catch {
    // 还是写不进 → 尝试清空 tasks
    try {
      await storage.set(KEYS.tasks, []);
      return { purged: tasks.length, freed: true };
    } catch {
      return { purged: 0, freed: false };
    }
  }
}

/** 创建任务 */
export async function createTask(type: TaskType, inputs: Record<string, unknown>): Promise<Task> {
  const tasks = await loadTasks();
  const now = Date.now();
  const task: Task = {
    id: genId('t_'),
    type,
    status: 'pending',
    inputs,
    createdAt: now,
    updatedAt: now,
    // 硬性截止时间（不依赖 setTimeout，前端/看门狗按真实时钟判断）
    deadline: now + TASK_EXEC_TIMEOUT,
  };
  tasks.push(task);
  await persist(tasks);
  emit(task);
  return task;
}

/** 强制标记任务失败（前端轮询超时兜底调用，前端时钟真实可靠）；同时真正中止底层请求 */
export async function forceFailTask(id: string, reason: string): Promise<Task | undefined> {
  abortTask(id);
  const t = await updateTask(id, { status: 'failed', error: reason });
  return t;
}

/* ---- 任务级 abort 注册表 ----
 * runGenerate 每次执行时注册一个 AbortController；看门狗/强制失败/取消时 abort，
 * 让真正卡在网络上的请求立刻中断（否则队列要等它的 setTimeout 才放行）。
 */
const abortControllers = new Map<string, AbortController>();

export function registerTaskAbort(id: string, controller: AbortController): void {
  abortControllers.set(id, controller);
}

export function unregisterTaskAbort(id: string): void {
  abortControllers.delete(id);
}

export function abortTask(id: string): void {
  abortControllers.get(id)?.abort();
}

/** 刷新任务硬截止时间（自动重试时给第二次尝试重新起算 7 分钟） */
export async function refreshDeadline(id: string): Promise<Task | undefined> {
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  const task = tasks[idx]!;
  task.deadline = Date.now() + TASK_EXEC_TIMEOUT;
  task.updatedAt = Date.now();
  await persist(tasks);
  emit(task);
  return task;
}

/** 更新任务状态（inputs 用于把 dataURL 换成 blobKey 引用，供结果栏「再生成」复用） */
export async function updateTask(
  id: string,
  patch: Partial<Pick<Task, 'status' | 'result' | 'error' | 'progress' | 'inputs' | 'statusText'>>
): Promise<Task | undefined> {
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  const task = tasks[idx]!;
  Object.assign(task, patch, { updatedAt: Date.now() });
  await persist(tasks);
  emit(task);
  return task;
}

export async function getTask(id: string): Promise<Task | undefined> {
  const tasks = await loadTasks();
  const t = tasks.find((t) => t.id === id);
  return t ? healTaskBlobKeys(t) : undefined;
}

export async function listTasks(limit = 10): Promise<Task[]> {
  const tasks = await loadTasks();
  const healed = await Promise.all(tasks.map((t) => healTaskBlobKeys(t)));
  return [...healed].reverse().slice(0, limit);
}

/**
 * 清除历史任务（设置页「清除」按钮）
 * - 只清终态（done/failed/cancelled）：running/pending 仍被面板轮询，清掉会让轮询拿到 undefined 而报错
 * - 成图 gen:{taskId}:* 与再生成输入图 regen-src/regen-face 一并回收
 * - 相册里存过的成图是独立 blob 拷贝（album-add-generated 重新入库），不受影响
 *   → 等价于「没入相册的成图跟着删，入了相册的留在相册」
 */
export async function clearTasks(): Promise<{ cleared: number; kept: number; blobs: number }> {
  const tasks = await loadTasks();
  const finished = tasks.filter((t) => t.status !== 'pending' && t.status !== 'running');
  const kept = tasks.length - finished.length;
  if (finished.length === 0) return { cleared: 0, kept, blobs: 0 };

  // 1) 先移除任务记录：即使后续 blob 回收失败，也不留下指向已删图的空壳任务
  await storage.set(
    KEYS.tasks,
    tasks.filter((t) => t.status === 'pending' || t.status === 'running')
  );

  // 2) 按 taskId 精确回收 blob（不能用 gen: 前缀通配，否则会连相册一起清空）
  const keys = new Set<string>();
  for (const t of finished) {
    const own = `gen:${t.id}:`;
    for (const k of await listImageKeys(own).catch(() => [] as string[])) if (k.startsWith(own)) keys.add(k);
    for (const k of t.result?.blobKeys ?? []) if (typeof k === 'string' && k.startsWith(own)) keys.add(k);
    for (const k of t.result?.splitBlobKeys ?? []) if (typeof k === 'string' && k.startsWith(own)) keys.add(k);
    const inputs = (t.inputs ?? {}) as { sourceBlobKey?: string; faceBlobKey?: string; faceBlobKeys?: string[] };
    if (typeof inputs.sourceBlobKey === 'string' && inputs.sourceBlobKey.startsWith('regen-')) keys.add(inputs.sourceBlobKey);
    if (typeof inputs.faceBlobKey === 'string' && inputs.faceBlobKey.startsWith('regen-')) keys.add(inputs.faceBlobKey);
    for (const k of inputs.faceBlobKeys ?? []) if (typeof k === 'string' && k.startsWith('regen-')) keys.add(k);
  }
  if (keys.size > 0) await deleteImages([...keys]).catch(() => {});

  // 3) 广播一次，让已打开的面板/弹窗重新拉取（此时列表已空）
  const last = finished[finished.length - 1];
  if (last) emit(last);
  return { cleared: finished.length, kept, blobs: keys.size };
}

/**
 * 自愈：旧版本 sanitize 的"深度截断"把 done 任务的 result.blobKeys 存成了 [null]，
 * 导致结果区按 null 取图永远 image-not-found、灰框。
 * 这里按图库实际存在的 gen:{id}:{i} 键重建 blobKeys。
 * 幂等：修好一次后 blobKeys 即为合法字符串，不再触发。
 */
async function healTaskBlobKeys(t: Task): Promise<Task> {
  if (t.status !== 'done') return t;
  const keys = t.result?.blobKeys;
  const broken =
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.some((k) => typeof k !== 'string' || k === '');
  if (!broken) return t;
  // 图库中此任务第 0 张图已不存在 → 无法自愈，原样返回
  if (!(await hasImage(`gen:${t.id}:0`))) return t;
  const rebuilt: string[] = [];
  for (let i = 0; ; i++) {
    const key = `gen:${t.id}:${i}`;
    if (await hasImage(key)) rebuilt.push(key);
    else break;
  }
  if (rebuilt.length === 0) return t;
  const updated = await updateTask(t.id, {
    result: { ...(t.result ?? {}), blobKeys: rebuilt },
  });
  return updated ?? { ...t, result: { ...(t.result ?? {}), blobKeys: rebuilt } };
}

/**
 * 是否已有进行中的该类型任务（人物卡锁：同一时间只允许一张人物卡在生成）。
 * 生成请求已发出后取消没有意义，产品决策：不做取消，只做互斥锁。
 * ★ 已过 deadline 的任务视为「已死」：看门狗最多每分钟才扫一次，
 *   不能让一条卡死记录永久挡住新任务（否则只能等 7 分钟或重载扩展）。
 */
export async function hasActiveTaskOfType(type: TaskType): Promise<boolean> {
  const now = Date.now();
  const tasks = await loadTasks();
  return tasks.some((t) => {
    if (t.type !== type) return false;
    if (t.status !== 'pending' && t.status !== 'running') return false;
    const expired =
      typeof t.deadline === 'number'
        ? t.deadline < now
        : now - t.updatedAt > TASK_STALE_MS;
    return !expired;
  });
}

/**
 * 强制解锁：把所有 running/pending 任务标为失败并中止底层请求。
 * 用于「服务商受理后不回话」这类卡死场景——看门狗要等 7 分钟，这里给用户一个立刻恢复的出口。
 * 传 type 只解锁该类型，不传则解锁全部。
 */
export async function unlockStuckTasks(type?: TaskType): Promise<{ unlocked: number }> {
  const tasks = await loadTasks();
  const now = Date.now();
  let unlocked = 0;
  for (const t of tasks) {
    if (t.status !== 'pending' && t.status !== 'running') continue;
    if (type && t.type !== type) continue;
    abortTask(t.id);
    t.status = 'failed';
    t.error = '已手动解锁（任务被判定卡死）';
    t.updatedAt = now;
    unlocked++;
    emit(t);
  }
  if (unlocked > 0) await persist(tasks);
  return { unlocked };
}

/**
 * 看门狗：扫描 running/pending 任务，超过硬超时则强制标 failed，并真正中止底层请求。
 * 优先用任务的 deadline 字段（真实时钟），无 deadline 时用 updatedAt 兜底。
 * 防止 SW 休眠导致任务永远停在 running（此时 JS 定时器冻结，只有看门狗能兜底）。
 */
export async function watchdogStaleTasks(): Promise<{ stuck: number }> {
  const tasks = await loadTasks();
  const now = Date.now();
  let stuck = 0;
  let changed = false;
  for (const t of tasks) {
    const staleBy =
      typeof t.deadline === 'number'
        ? now - (t.deadline as number) > 0
        : now - t.updatedAt > TASK_STALE_MS;
    if ((t.status === 'running' || t.status === 'pending') && staleBy) {
      abortTask(t.id); // 叫停卡在网上的请求，队列立刻释放
      t.status = 'failed';
      t.error = '生成超时（任务执行超过 7 分钟），请重试';
      t.updatedAt = now;
      stuck++;
      changed = true;
      emit(t);
    }
  }
  if (changed) await persist(tasks);
  return { stuck };
}

/**
 * 串行执行器：同一时间只跑 1 个生成任务
 * 任务失败时恢复 pending → 供重试（此处简单标记 failed）
 *
 * ★ MV3 防护：任务级执行超时。
 * SW 休眠会冻结 setTimeout/fetch，导致任务永不结束、串行队列被堵死。
 * 这里给每个任务加硬超时，超时强制 reject，队列继续前进。
 */
let running: Promise<void> = Promise.resolve();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = running.then(
    () => withTimeout(fn(), TASK_EXEC_TIMEOUT),
    () => withTimeout(fn(), TASK_EXEC_TIMEOUT)
  );
  running = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/** SW 恢复：扫描 running 任务，标记为 failed（可重试） */
export async function recoverTasks(): Promise<void> {
  const tasks = await loadTasks();
  let changed = false;
  for (const t of tasks) {
    if (t.status === 'running' || t.status === 'pending') {
      t.status = 'failed';
      t.error = '任务因浏览器重启中断，可点击重试';
      t.updatedAt = Date.now();
      changed = true;
      emit(t);
    }
  }
  if (changed) await persist(tasks);
}
