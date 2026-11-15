/**
 * 消息路由：消息 → handler 映射
 * 统一响应 { ok, data | error }
 */

import type {
  MsgEnvelope,
  MsgResponse,
  Settings,
  TaskType,
  AnalyzePayload,
  GeneratePayload,
  CollectPayload,
  AlbumListPayload,
  AlbumDeletePayload,
  PersonCardCreatePayload,
  PersonCardDeletePayload,
  PersonCardSetDefaultPayload,
  PersonCardRenamePayload,
  TestConnPayload,
  ImageFromUrlPayload,
  ImageFromAlbumPayload,
  ImageUploadPayload,
  ImageExistsPayload,
  AlbumAddGeneratedPayload,
  DownloadPayload,
} from '../shared/types';
import { getSettings, saveSettings } from './settings';
import { testConnection } from './providers/test';
import { analyzeImage } from './providers/analyze';
import { generateImage } from './providers/generate';
import * as album from './store/album';
import * as personCards from './store/personCards';
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  enqueue,
  forceFailTask,
  registerTaskAbort,
  unregisterTaskAbort,
  refreshDeadline,
  hasActiveTaskOfType,
  clearTasks,
  unlockStuckTasks,
} from './tasks';
import { putImage, deleteImages, getImage, listImageKeys } from './store/db';
import { genId, compressImage } from '../shared/utils/image';
import { storage, KEYS } from './store/storage';
import { PENDING_IMAGE_READY_EVENT } from '../shared/messages';
import { TASK_MAX_KEEP } from '../shared/constants';
import { listErrors, clearErrors, logError } from './store/errorLog';

/** 内部异常 → 中文用户文案 */
function toError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  // 有些错误是 new Error('PERSON_CARD_BUSY') 这种只带 message 的，按 message 也能命中映射表
  const code = e.code ?? e.message ?? '';
  const map: Record<string, string> = {
    AUTH_INVALID: 'API Key 无效，请到设置检查',
    AUTH_FORBIDDEN: '无权限，请检查 Key 与模型权限',
    ENDPOINT_NOT_FOUND: '模型或端点不支持，请到设置检查',
    RATE_LIMITED: '额度不足或请求过快，请稍后重试',
    TIMEOUT: '请求超时，请重试',
    NETWORK: '网络异常，请检查网络后重试',
    FETCH_BLOCKED: '该图片无法直接读取，请截图或下载后上传',
    EMPTY_RESPONSE: '服务返回为空，请重试',
    TASK_FAILED: '生成任务失败，请重试',
    NOT_CONFIGURED: '请先完成 API 配置',
    PERSON_CARD_LIMIT: '人物卡数量已达上限（20 张）',
    PERSON_CARD_BUSY: '上一张人物卡还在生成中，请稍候再试',
    'image-not-found': '图片不存在或已被删除',
  };
  return map[code] ?? e.message ?? '发生未知错误';
}

export async function dispatchMessage(msg: MsgEnvelope): Promise<MsgResponse> {
  try {
    const data = await handle(msg);
    return { ok: true, data };
  } catch (err) {
    // ★ 关键：所有消息错误都记录到错误日志（不再静默吞掉）
    const e = err as { code?: string; message?: string; stack?: string };
    void logError('router', `[${msg.type}] ${e.message ?? String(err)}`, e.stack);
    return { ok: false, error: toError(err) };
  }
}

async function handle(msg: MsgEnvelope): Promise<unknown> {
  switch (msg.type) {
    /* -------- 设置 -------- */
    case 'settings-get':
      return getSettings();
    case 'settings-save':
      return saveSettings(msg.payload as Settings);
    case 'settings-test': {
      const { which } = msg.payload as TestConnPayload;
      return testConnection(which);
    }
    case 'errors-list': {
      const { limit } = (msg.payload ?? {}) as { limit?: number };
      return listErrors(limit ?? 30);
    }
    case 'errors-clear':
      await clearErrors();
      return { ok: true };

    /* -------- 收集 / 相册 -------- */
    case 'image-collect': {
      const p = msg.payload as CollectPayload;
      return album.collectImage(p.imageUrl, p.pageUrl, p.alt);
    }
    case 'album-list': {
      const p = (msg.payload ?? {}) as AlbumListPayload;
      return album.listAlbum(p.cursor, p.limit);
    }
    case 'album-delete': {
      const { id } = msg.payload as AlbumDeletePayload;
      await album.deleteAlbumItem(id);
      return { id };
    }
    case 'album-get': {
      const { id } = msg.payload as { id: string };
      const item = await album.getAlbumItem(id);
      if (!item) throw new Error('image-not-found');
      const dataUrl = await album.albumBlobToDataUrl(item.blobKey);
      return { item, dataUrl };
    }

    /* -------- 人物卡 -------- */
    case 'person-card-list':
      return personCards.listPersonCards();
    case 'person-card-get': {
      const { id } = msg.payload as { id: string };
      const card = await personCards.getPersonCard(id);
      if (!card) throw new Error('image-not-found');
      return { card, dataUrl: await personCards.personCardDataUrl(card) };
    }
    case 'person-card-create': {
      const p = msg.payload as PersonCardCreatePayload;
      // 锁：同一时间只允许一张人物卡在生成（避免多卡并发时任务归属混乱）
      if (await hasActiveTaskOfType('personCard')) throw new Error('PERSON_CARD_BUSY');
      const result = await personCards.createPersonCard(p.images ?? [], p.name, p.blobKeys);
      // 立刻异步触发三视图卡生成（不阻塞 UI）。
      // 全部源图 Blob 直传：卡上的所有源图都作为身份参考（多角度综合，相似度更稳），不复制临时图，不压缩。
      const sourceKeys = result.blobKeys;
      if (result.card && sourceKeys.length > 0) {
        const inputs: GeneratePayload = {
          intent: 'personCard',
          prompt: '',
          sourceBlobKeys: sourceKeys, // 多张源图全部参与三视图生成
          keepSourceBlob: true, // 源图是人物卡资产，成功/失败都不删
          aspectRatio: '16:9',
          cardId: result.card.id,
        };
        const task = await createTask('personCard', { ...inputs });
        void runGenerate(task.id, inputs);
      }
      return result;
    }
    case 'person-card-delete': {
      const { id } = msg.payload as PersonCardDeletePayload;
      await personCards.deletePersonCard(id);
      return { id };
    }
    case 'person-card-set-default': {
      const { id } = msg.payload as PersonCardSetDefaultPayload;
      await personCards.setDefaultPersonCard(id);
      return { id };
    }
    case 'person-card-clear-error': {
      const { id } = msg.payload as { id: string };
      await personCards.clearCardGenError(id);
      return { id };
    }
    case 'person-card-rename': {
      const { id, name } = msg.payload as PersonCardRenamePayload;
      const card = await personCards.renamePersonCard(id, name);
      if (!card) throw new Error('image-not-found');
      return { card };
    }

    /* -------- 反推 -------- */
    case 'analyze-image': {
      const p = msg.payload as AnalyzePayload;
      return analyzeImage(p.imageDataUrl, p.profileId);
    }

    /* -------- 生图（串行任务） -------- */
    case 'generate-image': {
      const p = msg.payload as GeneratePayload;
      // 锁：人物卡重新生成同样互斥（与 person-card-create 一致）
      if (p.intent === 'personCard' && (await hasActiveTaskOfType('personCard'))) throw new Error('PERSON_CARD_BUSY');
      const taskType = p.intent === 'faceswap' ? 'faceswap' : p.intent === 'suite' ? 'suite' : p.intent === 'personCard' ? 'personCard' : 'redraw';
      const task = await createTask(taskType, { ...p });
      // 再生成资产：把 dataURL 输入图落盘为持久 blob（成功/失败都不删），
      // 结果栏「再生成」据此用相同配置重新生成；task.inputs 以 blobKey 引用替代 dataURL（不占配额）
      const resolved = await persistRegenInputs(task.id, p);
      void runGenerate(task.id, resolved);
      return { taskId: task.id };
    }

    /* -------- 任务 -------- */
    case 'task-status': {
      const { taskId } = msg.payload as { taskId: string };
      return getTask(taskId);
    }
    case 'task-list': {
      const { limit } = (msg.payload ?? {}) as { limit?: number };
      return listTasks(limit);
    }
    case 'tasks-clear':
      return clearTasks();
    case 'task-force-unlock': {
      // 强制解锁卡死的进行中任务（服务商受理后不回话时用，不必等 7 分钟看门狗）
      const { type } = (msg.payload ?? {}) as { type?: TaskType };
      return unlockStuckTasks(type);
    }
    case 'task-force-fail': {
      // 前端轮询发现任务超时（真实时钟）→ 强制标记失败并中止底层请求
      const { taskId } = msg.payload as { taskId: string };
      const t = await forceFailTask(taskId, '生成超时（任务执行超过 7 分钟），请重试');
      return { taskId, ok: Boolean(t) };
    }

    /* -------- 图片输入 -------- */
    case 'image-from-url': {
      const { url } = msg.payload as ImageFromUrlPayload;
      const blob = await fetchImageBlob(url);
      const dataUrl = await blobToDataUrl(blob);
      // 压缩到 2048 内，控制上传体积
      const compressed = await compressImage(dataUrl, 2048, 0.9);
      return { dataUrl: compressed };
    }
    case 'image-from-album': {
      const { id } = msg.payload as ImageFromAlbumPayload;
      const item = await album.getAlbumItem(id);
      if (!item) throw new Error('image-not-found');
      const dataUrl = await album.albumBlobToDataUrl(item.blobKey);
      const compressed = await compressImage(dataUrl, 2048, 0.9);
      return { dataUrl: compressed, item };
    }
    case 'image-upload': {
      const { dataUrl } = msg.payload as ImageUploadPayload;
      const compressed = await compressImage(dataUrl, 2048, 0.9);
      return { dataUrl: compressed };
    }
    case 'image-exists': {
      const { key } = msg.payload as ImageExistsPayload;
      return { exists: await album.albumHasKey(key) };
    }
    case 'image-by-key': {
      // ★ 防御：key 为空/非法直接报"图片不存在"，避免底层 IDB 抛原生错误
      const { key } = msg.payload as { key?: string };
      if (typeof key !== 'string' || key === '') throw new Error('image-not-found');
      const dataUrl = await album.albumBlobToDataUrl(key);
      return { dataUrl };
    }
    case 'album-add-generated': {
      const p = msg.payload as AlbumAddGeneratedPayload;
      const blob = await toBlob(p.dataUrl);
      const key = `gen:${genId('g_')}`;
      await putImage(key, blob);
      const item = await album.addGenerated([key], {
        prompt: p.prompt,
        model: p.model,
        taskType: p.taskType,
        aspect: p.aspect,
      });
      return item[0];
    }
    case 'set-pending-image': {
      const { dataUrl, pageUrl } = msg.payload as { dataUrl: string; pageUrl?: string };
      // 图片 blob 走 IndexedDB，storage 只存引用（避免占 storage 配额）
      const key = `pending:${Date.now().toString(36)}`;
      await putImage(key, await toBlob(dataUrl));
      await storage.set(KEYS.pendingImage, { blobKey: key, pageUrl, createdAt: Date.now() });
      // 广播：面板若已打开则即时应用（不必重启面板）
      void chrome.runtime.sendMessage({ type: PENDING_IMAGE_READY_EVENT }).catch(() => {});
      return { ok: true };
    }
    case 'get-pending-image': {
      const v = await storage.get<{ blobKey: string; pageUrl?: string } | null>(KEYS.pendingImage, null as never);
      if (!v?.blobKey) return null;
      const dataUrl = await blobKeyToDataUrl(v.blobKey);
      return { dataUrl, pageUrl: v.pageUrl };
    }
    case 'clear-pending-image': {
      const v = await storage.get<{ blobKey: string } | null>(KEYS.pendingImage, null as never);
      await storage.remove(KEYS.pendingImage);
      if (v?.blobKey) await deleteImages([v.blobKey]).catch(() => {});
      return { ok: true };
    }

    /* -------- 下载 / 打开页面 -------- */
    case 'download-file': {
      const p = msg.payload as DownloadPayload;
      await chrome.downloads.download({ url: p.url, filename: p.filename, saveAs: false });
      return { ok: true };
    }
    case 'open-panel': {
      // sidePanel.open 需要用户手势，background 里调用会失败 → 兜底为独立窗口
      const win = await chrome.windows.getCurrent();
      try {
        if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
      } catch {
        // 手势丢失 → 打开独立面板窗口
        await chrome.windows.create({
          url: chrome.runtime.getURL('src/panel/index.html'),
          type: 'popup',
          width: 420,
          height: 720,
        });
      }
      return { ok: true };
    }
    case 'open-panel-fallback': {
      await chrome.windows.create({
        url: chrome.runtime.getURL('src/panel/index.html'),
        type: 'popup',
        width: 420,
        height: 720,
      });
      return { ok: true };
    }
    case 'open-options': {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    case 'inject-content': {
      // 主动注入悬浮脚本到当前活动标签页（无需用户刷新页面）
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.id && isInjectableUrl(tab.url)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content/index.js'],
          });
          return { injected: true };
        } catch {
          return { injected: false };
        }
      }
      return { injected: false };
    }
    case 'get-last-image': {
      // 从当前标签页的 content 读取最近悬停图片
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.id) {
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'shiyin-get-last-image' });
          return { imageUrl: res?.imageUrl ?? '' };
        } catch {
          return { imageUrl: '' };
        }
      }
      return { imageUrl: '' };
    }

    default:
      throw new Error('不支持的消息类型');
  }
}

/** 判断 URL 是否可注入（排除扩展页/浏览器内页） */
function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('https://chromewebstore.google.com') ||
    url.startsWith('file://')
  );
}

/** 判断是否为超时类错误（withTimeout 的裸 Error('TIMEOUT') 或 provider 的 ApiError TIMEOUT） */
function isTimeout(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'TIMEOUT' || e?.message === 'TIMEOUT';
}

/* ---- 再生成资产：源图/人脸图落盘 + GC ----
 * 生成请求里的 sourceRef/faceRef 是 dataURL，会被 sanitizeTask 在落库时剥掉（保护配额），
 * 临时 blob 在生成完成后也会被删 —— 任务记录里不剩输入图，结果栏「再生成」无从复用。
 * 方案：创建任务时把 dataURL 转存为持久 blob（key 带 regen- 前缀），写入 task.inputs 引用，
 * 并标记 keepSourceBlob=true（成功/失败都不删，由 GC 按最近 N 个任务统一回收）。
 */
const REGEN_SRC_PREFIX = 'regen-src:';
const REGEN_FACE_PREFIX = 'regen-face:';
const REGEN_KEEP = 10; // 只保留最近 10 个任务的再生成输入图

async function persistRegenInputs(taskId: string, p: GeneratePayload): Promise<GeneratePayload> {
  const resolved: GeneratePayload = { ...p };
  const newKeys: string[] = [];
  try {
    if (!resolved.sourceBlobKey && resolved.sourceRef?.startsWith('data:')) {
      const key = `${REGEN_SRC_PREFIX}${taskId}`;
      await putImage(key, await toBlob(resolved.sourceRef));
      resolved.sourceBlobKey = key;
      resolved.sourceRef = undefined;
      newKeys.push(key);
    }
    if (!resolved.faceBlobKey && resolved.faceRef?.startsWith('data:')) {
      const key = `${REGEN_FACE_PREFIX}${taskId}`;
      await putImage(key, await toBlob(resolved.faceRef));
      resolved.faceBlobKey = key;
      resolved.faceRef = undefined;
      newKeys.push(key);
    }
    // 多张人脸参考（直接上传的照片）：逐张落盘为 regen-face:{taskId}:{i}
    if (!resolved.faceBlobKeys?.length && resolved.faceRefs?.length) {
      const keys: string[] = [];
      for (let i = 0; i < resolved.faceRefs.length; i++) {
        const ref = resolved.faceRefs[i]!;
        if (!ref.startsWith('data:')) continue;
        const key = `${REGEN_FACE_PREFIX}${taskId}:${i}`;
        await putImage(key, await toBlob(ref));
        keys.push(key);
        newKeys.push(key);
      }
      if (keys.length) {
        resolved.faceBlobKeys = keys;
        resolved.faceRefs = undefined;
      }
    }
  } catch {
    /* 落盘失败不阻塞生成，仅失去「再生成」能力 */
  }
  if (newKeys.length > 0) {
    // 输入图是再生成资产：成功/失败都不删（临时图生命周期结束，由 GC 统一回收）
    resolved.keepSourceBlob = true;
    // 同步 task.inputs：以 blobKey 引用替代 dataURL（不再被 sanitize 剥掉，也不占配额）
    await updateTask(taskId, { inputs: { ...resolved } }).catch(() => {});
    await pruneRegenBlobs();
  }
  return resolved;
}

/** GC：只保留最近 REGEN_KEEP 个任务的再生成输入图，更旧的清掉（防本地无限膨胀） */
async function pruneRegenBlobs(): Promise<void> {
  try {
    const all = await listTasks(TASK_MAX_KEEP); // 覆盖全部可及任务（超出 50 的已被裁剪）
    const referenced = new Set<string>();
    const keepIds = new Set(all.slice(0, REGEN_KEEP).map((t) => t.id));
    for (const t of all) {
      const inputs = (t.inputs ?? {}) as { sourceBlobKey?: string; faceBlobKey?: string; faceBlobKeys?: string[] };
      if (typeof inputs.sourceBlobKey === 'string' && inputs.sourceBlobKey.startsWith(REGEN_SRC_PREFIX)) {
        referenced.add(inputs.sourceBlobKey);
      }
      if (typeof inputs.faceBlobKey === 'string' && inputs.faceBlobKey.startsWith(REGEN_FACE_PREFIX)) {
        referenced.add(inputs.faceBlobKey);
      }
      for (const k of inputs.faceBlobKeys ?? []) {
        if (typeof k === 'string' && k.startsWith(REGEN_FACE_PREFIX)) referenced.add(k);
      }
    }
    const stale: string[] = [];
    // 孤儿：任务已被裁剪（超出 TASK_MAX_KEEP）→ blob 没有任务引用，直接清
    for (const key of await listImageKeys(REGEN_SRC_PREFIX)) if (!referenced.has(key)) stale.push(key);
    for (const key of await listImageKeys(REGEN_FACE_PREFIX)) if (!referenced.has(key)) stale.push(key);
    // 超出保留数量：任务还在，但输入图该回收了
    for (const t of all) {
      if (keepIds.has(t.id)) continue;
      const inputs = (t.inputs ?? {}) as { sourceBlobKey?: string; faceBlobKey?: string; faceBlobKeys?: string[] };
      if (typeof inputs.sourceBlobKey === 'string' && inputs.sourceBlobKey.startsWith(REGEN_SRC_PREFIX)) {
        stale.push(inputs.sourceBlobKey);
      }
      if (typeof inputs.faceBlobKey === 'string' && inputs.faceBlobKey.startsWith(REGEN_FACE_PREFIX)) {
        stale.push(inputs.faceBlobKey);
      }
      for (const k of inputs.faceBlobKeys ?? []) {
        if (typeof k === 'string' && k.startsWith(REGEN_FACE_PREFIX)) stale.push(k);
      }
    }
    if (stale.length) await deleteImages([...new Set(stale)]).catch(() => {});
  } catch {
    /* 忽略 */
  }
}

/**
 * 异步生图执行器（后台跑，更新任务状态）
 * ★ 本轮改动：
 *  - 原图直传：从 IndexedDB 取 Blob 直接交给 provider，不走 dataURL，不压缩
 *  - 超时自动重试 1 次：超时后重置 deadline、用同一张原图再试；第二次再失败才报错
 *  - 每轮执行注册 AbortController，看门狗/强制失败能真正中止底层请求
 */
async function runGenerate(taskId: string, p: GeneratePayload) {
  await updateTask(taskId, { status: 'running', progress: 5 });

  // 原图直传：直接把 blobKey 对应的 Blob 取出来交给 provider（不经 dataURL，保持原始质量）
  // 人物卡场景支持多张源图（sourceBlobKeys）全部参与生成；单图场景走 sourceBlobKey
  const sourceKeys = p.sourceBlobKeys?.length ? p.sourceBlobKeys : p.sourceBlobKey ? [p.sourceBlobKey] : [];
  const faceKeys = p.faceBlobKeys?.length ? p.faceBlobKeys : p.faceBlobKey ? [p.faceBlobKey] : [];
  let sourceBlobs: Blob[] = [];
  let faceBlobs: Blob[] = [];
  try {
    for (const k of sourceKeys) {
      const b = await getImage(k);
      if (b) sourceBlobs.push(b);
    }
    for (const k of faceKeys) {
      const b = await getImage(k);
      if (b) faceBlobs.push(b);
    }
  } catch {
    /* 取图失败继续，provider 端会报错 */
  }

  const MAX_ATTEMPTS = 2; // 首次 + 自动重试 1 次
  let attempts = 0;

  while (true) {
    const controller = new AbortController();
    registerTaskAbort(taskId, controller);
    try {
      const result = await enqueue(async () => {
        /**
         * 拍一套：按配比拆成「人像批 + 配图批」串行请求，结果合并进同一个任务。
         * 单批（4 人像 / 4 配图）仍只发一次请求，成本与改造前一致；
         * 混合档（如 2+2）发两次，配图批只带底图，不带人脸参考。
         */
        const batches: { kind: 'portrait' | 'scene'; count: number }[] = [];
        if (p.intent === 'suite') {
          const mix = p.suiteMix;
          if (mix && (mix.portrait > 0 || mix.scene > 0)) {
            if (mix.portrait > 0) batches.push({ kind: 'portrait', count: mix.portrait });
            if (mix.scene > 0) batches.push({ kind: 'scene', count: mix.scene });
          } else {
            batches.push({ kind: 'portrait', count: 4 });
          }
        }
        const total = Math.max(1, batches.length);
        const hiQuality = p.quality === '2K' || p.quality === '4K';
        const merged: string[] = [];
        let lastGen: { images: string[]; model: string } | null = null;

        for (let bi = 0; bi < total; bi++) {
          const b = batches[bi] ?? null;
          const from = 20 + (60 / total) * bi;
          const to = 20 + (60 / total) * (bi + 1);
          await updateTask(taskId, {
            progress: Math.round(from),
            ...(b ? { statusText: `${b.kind === 'portrait' ? '生成人像' : '生成配图'}（${bi + 1}/${total}）…` } : {}),
          });
          // 本批张数决定画幅：1 张 3:4 直出 / 2 张 3:2（左右各一格 3:4）/ 3~4 张 1:1 四宫格
          const batchAspect = b ? (b.count <= 1 ? '3:4' : b.count === 2 ? '3:2' : '1:1') : p.aspectRatio;
          const batchSize =
            b && !hiQuality
              ? b.count <= 1
                ? '768x1024'
                : b.count === 2
                  ? '1536x1024'
                  : '1024x1024'
              : undefined;
          const gen = await generateImage(
            {
              prompt: p.prompt,
              intent: p.intent,
              sourceRef: p.sourceRef, // 兼容旧调用（dataURL）
              sourceBlobs, // 原图直传（优先；人物卡场景为多张）
              // 配图批只带底图：带了人脸参考，静物格里会冒出那个人
              faceRef: b?.kind === 'scene' ? undefined : p.faceRef,
              faceBlobs: b?.kind === 'scene' ? [] : faceBlobs,
              aspectRatio: batchAspect,
              quality: p.quality,
              suiteBatch: b?.kind,
              suiteCount: b?.count,
              sizeOverride: batchSize,
            },
            controller.signal, // 看门狗/强制失败可中止请求
            (info) => {
              // 进度细分：把本批的 from→to 区间映射出来，并标出「人像 1/2」这样的批次前缀
              const mapped = Math.round(from + ((to - from) * Math.min(100, Math.max(0, info.percent))) / 100);
              const prefix = b ? `${b.kind === 'portrait' ? '人像' : '配图'} ${bi + 1}/${total} · ` : '';
              void updateTask(taskId, {
                progress: mapped,
                statusText: `${prefix}${info.statusText ?? ''}`,
              }).catch(() => {});
            }
          );
          merged.push(...gen.images);
          lastGen = gen;
        }
        await updateTask(taskId, { progress: 80, statusText: '保存结果…' });

        // 结果 blob 入库（混合档是两张拼图，前端再按张数切分）
        const blobKeys: string[] = [];
        for (let i = 0; i < merged.length; i++) {
          const src = merged[i]!;
          const blob = await toBlob(src);
          const key = `gen:${taskId}:${i}`;
          await putImage(key, blob);
          blobKeys.push(key);
        }
        // ★ 防御：确保任务结果里的图片编号都是有效字符串，否则宁可判失败，
        // 也不能存一个"已完成但编号为空"的任务（会导致结果区所有操作报错）
        const validKeys = blobKeys.filter((k) => typeof k === 'string' && k.length > 0);
        if (validKeys.length === 0) {
          throw new Error('生图结果为空，请重试');
        }

        // 拍一套 → 前端切分（此处由面板执行 splitPhotoSuiteGrid，见 panel/views/suite.ts）
        // 人物卡 → 把三视图图挂到人物卡上
        if (p.intent === 'personCard' && p.cardId && blobKeys[0]) {
          await updateTask(taskId, { progress: 90, statusText: '挂载到人物卡…' });
          await personCards.attachCardImage(p.cardId, blobKeys[0]);
        }

        // 清理临时 blob（keepSourceBlob=true 时源图是人物卡资产，不能删）
        if (!p.keepSourceBlob && sourceKeys.length) {
          await deleteImages(sourceKeys).catch(() => {});
        }
        if (!p.keepSourceBlob && faceKeys.length) {
          await deleteImages(faceKeys).catch(() => {});
        }

        await updateTask(taskId, { result: { blobKeys }, progress: 100, status: 'done', statusText: '完成' });
        return lastGen ?? { images: merged, model: '' };
      });

      // 成功
      return result;
    } catch (err) {
      attempts++;
      if (isTimeout(err) && attempts < MAX_ATTEMPTS) {
        // 自动重试 1 次：同一张原图，重置状态与 7 分钟截止时间
        await updateTask(taskId, { status: 'running', progress: 10, statusText: '自动重试中…' });
        await refreshDeadline(taskId);
        continue;
      }

      // 最终失败
      const errMsg = toError(err);
      const finalMsg = attempts > 1 ? `${errMsg}（已自动重试 1 次，仍失败）` : errMsg;
      // ★ 记录到错误日志（这是生图主路径，错误必须可追溯）
      const e = err as { message?: string; stack?: string };
      void logError('generate', `[${p.intent}] ${e.message ?? errMsg}${attempts > 1 ? '（已重试 1 次）' : ''}`, e.stack);
      await updateTask(taskId, { status: 'failed', error: finalMsg });
      // 清理临时 blob（keepSourceBlob 的源图保留，便于重试）
      const tempKeys: string[] = [];
      if (!p.keepSourceBlob) tempKeys.push(...sourceKeys);
      if (!p.keepSourceBlob) tempKeys.push(...faceKeys);
      if (tempKeys.length) await deleteImages(tempKeys).catch(() => {});
      // 人物卡生成失败 → 记录到卡片上，UI 可显示
      if (p.intent === 'personCard' && p.cardId) {
        await personCards.setCardGenError(p.cardId, finalMsg);
      }
      return;
    } finally {
      unregisterTaskAbort(taskId);
    }
  }
}

/** 从 IndexedDB blob 转 dataURL */
async function blobKeyToDataUrl(key: string): Promise<string> {
  const blob = await getImage(key);
  if (!blob) throw new Error('image-not-found');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 抓取远端图片为 blob（带 referer 兼容） */
async function fetchImageBlob(url: string): Promise<Blob> {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error('FETCH_BLOCKED');
  const blob = await resp.blob();
  if (!blob.type.startsWith('image/')) throw new Error('FETCH_BLOCKED');
  return blob;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function toBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const [meta, b64] = src.split(',');
    const mime = meta?.match(/data:(.*?);/)?.[1] ?? 'image/png';
    const bin = atob(b64!);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  const resp = await fetch(src);
  return resp.blob();
}
