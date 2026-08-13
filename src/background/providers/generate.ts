/**
 * 生图：OpenAI 兼容 images/edits（multipart）· 支持拼图 fallback 与异步轮询
 *
 * ★ 本轮修复：
 *  - 原图直传：优先传 Blob（不经 dataURL、不压缩），dataURL 仅作兼容兜底
 *  - 每步都有超时：等响应头 / 读响应体 / 下载结果图，卡住不会再无限等
 *  - signal 贯穿所有底层请求：任务看门狗/取消可以真正叫停（AbortController）
 *  - 轮询状态白名单放宽：不认识的 status 不轻易判死，见 extractImages
 */

import { getSettings } from '../settings';
import {
  ASPECT_RATIOS,
  GENERATE_TIMEOUT,
  BODY_READ_TIMEOUT,
  DOWNLOAD_TIMEOUT,
  POLL_INTERVAL,
  ERROR_MESSAGES,
  QUALITY_TO_API,
} from '../../shared/constants';
import { composeFaceBadge } from '../../shared/utils/image';
import { buildGeneratePrompt } from '../../shared/prompts';
import type { GenerateIntent } from '../../shared/types';
import {
  apiFetch,
  readJson,
  readResponseBody,
  combineSignal,
  classifyHttpError,
  ApiError,
  type ImagesResponse,
  type AsyncTaskResponse,
  type AsyncTaskStatus,
} from './types';

export interface GenerateImageResult {
  /** dataURL 数组（1 张，或拍一套后前端自行切分） */
  images: string[];
  model: string;
}

/**
 * 生图主入口：
 * - 带参考图 → images/edits（multipart，image 字段 = 构图参考图）
 * - 优先传 Blob（原图直传，不经过 dataURL、不压缩）；dataURL 仅作兼容兜底
 * - 服务商不支持多图 → 拼图法 fallback（人脸角标）
 * - 支持异步任务的中转站 → 提交后轮询
 * signal 为任务级中止信号（看门狗/取消可真正叫停所有底层请求）
 */
export async function generateImage(
  params: {
    prompt: string;
    intent: GenerateIntent;
    sourceRef?: string;
    sourceBlob?: Blob;
    faceRef?: string;
    faceBlob?: Blob;
    aspectRatio: string;
    /** 画质档位 '1K' | '2K' | '4K'；缺省/1K 保持现状（具体像素尺寸、不传 quality） */
    quality?: string;
  },
  signal?: AbortSignal
): Promise<GenerateImageResult> {
  const settings = await getSettings();
  const { baseUrl, apiKey, model } = settings.generateApi;
  if (!apiKey) throw new ApiError('NOT_CONFIGURED', ERROR_MESSAGES['NOT_CONFIGURED'] ?? '请先完成 API 配置');
  const safeBase = baseUrl.replace(/\/$/, '');
  const safeKey = apiKey;

  // 2K/4K：按服务商文档走「画幅比例 + quality」精确映射到 1K/2K/4K
  // 1K / 缺省：完全保持现状（具体像素尺寸、不传 quality，兼容只认像素的服务商）
  const useRatioQuality = params.quality === '2K' || params.quality === '4K';
  const size = useRatioQuality ? params.aspectRatio : (ASPECT_RATIOS[params.aspectRatio] ?? '1024x1024');
  const qualityApi = useRatioQuality ? QUALITY_TO_API[params.quality!] : undefined;
  let finalPrompt = buildGeneratePrompt(params.intent, params.prompt);
  const hasSource = Boolean(params.sourceBlob || params.sourceRef);
  const hasFace = Boolean(params.faceBlob || params.faceRef);
  const multiImage = hasSource && hasFace;
  if (multiImage) {
    // 多图输入时，明确告知模型：第一张=场景/构图参考，第二张=人脸身份参考
    finalPrompt = `本次提交了两张参考图：第一张图（image 字段中的第一张）是构图与场景参考；第二张图（image 字段中的第二张）是人物面部身份参考。请按提示词要求完成任务。\n\n${finalPrompt}`;
  }

  const url = `${safeBase}/images/edits`;

  // 组装 multipart form
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', finalPrompt);
  form.append('size', size);
  if (qualityApi) form.append('quality', qualityApi);
  form.append('n', '1');
  // 显式请求 b64_json（兼容部分服务商只返回 url 时也能自动处理；多数服务商二者都支持）
  form.append('response_format', 'b64_json');

  // 原图直传：Blob 直接进 multipart（不转 dataURL、不压缩）；dataURL 仅作兼容
  if (params.sourceBlob) {
    form.append('image', params.sourceBlob, 'source.png');
  } else if (params.sourceRef) {
    form.append('image', dataUrlToBlob(params.sourceRef), 'source.png');
  }
  if (params.faceBlob) {
    form.append('image', params.faceBlob, 'face.png');
  } else if (params.faceRef) {
    form.append('image', dataUrlToBlob(params.faceRef), 'face.png');
  }

  const resp = await apiFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${safeKey}` },
    body: form,
  }, GENERATE_TIMEOUT, signal);

  // 响应体读取也有超时（响应头到了但 body 迟迟不流完时不会无限等）
  const data = await readJson<ImagesResponse | AsyncTaskResponse>(resp, BODY_READ_TIMEOUT, url, signal);

  if (!resp.ok) {
    // 双图不被支持 → 拼图法重试一次
    if (resp.status === 400 && multiImage) {
      return retryWithComposedImage(url, safeKey, model, finalPrompt, size, qualityApi, {
        sourceRef: params.sourceRef,
        sourceBlob: params.sourceBlob,
        faceRef: params.faceRef,
        faceBlob: params.faceBlob,
      }, signal);
    }
    throw classifyHttpError(resp.status, data);
  }

  // 1) 同步返回 b64_json / url
  const syncData = data as ImagesResponse;
  if (Array.isArray(syncData.data)) {
    const images = await resolveImages(syncData.data, signal);
    if (images.length > 0) return { images, model };
  }

  // 2) 异步任务 → 轮询
  const asyncData = data as AsyncTaskResponse;
  const taskUrl = asyncData.task_id || asyncData.taskId || asyncData.id || '';
  if (taskUrl) {
    const images = await pollTask(safeBase, taskUrl, safeKey, signal);
    if (images.length > 0) return { images, model };
  }

  // 3) 直接返回 url
  if (asyncData.url) {
    return { images: [asyncData.url], model };
  }
  if (typeof asyncData.output === 'string') {
    return { images: [asyncData.output], model };
  }
  if (Array.isArray(asyncData.output) && asyncData.output.length > 0) {
    // ★ 防御：过滤掉输出里的空串/null，避免把空值当图片编号存进任务
    const images = cleanImages(asyncData.output as (string | null | undefined)[]);
    if (images.length > 0) return { images, model };
  }

  throw new ApiError('EMPTY_RESPONSE', '生图返回为空');
}

/** 拼图法重试 */
async function retryWithComposedImage(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  qualityApi: string | undefined,
  params: { sourceRef?: string; sourceBlob?: Blob; faceRef?: string; faceBlob?: Blob },
  signal?: AbortSignal
): Promise<GenerateImageResult> {
  // 拼图需要 canvas（DOM），Blob 先转 dataURL
  const sourceDataUrl = params.sourceBlob ? await blobToDataUrl(params.sourceBlob) : params.sourceRef!;
  const faceDataUrl = params.faceBlob ? await blobToDataUrl(params.faceBlob) : params.faceRef!;
  const composed = await composeFaceBadge(sourceDataUrl, faceDataUrl);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', `${prompt}\n\n注意：图片右下角圆形小图为人物面部参考，请将该人物的身份用于主图人物。`);
  form.append('size', size);
  if (qualityApi) form.append('quality', qualityApi);
  form.append('n', '1');
  form.append('image', dataUrlToBlob(composed), 'composed.png');

  const resp = await apiFetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  }, GENERATE_TIMEOUT, signal);

  const data = await readJson<ImagesResponse>(resp, BODY_READ_TIMEOUT, url, signal);
  if (!resp.ok) throw classifyHttpError(resp.status, data);
  const images = await resolveImages(data.data ?? [], signal);
  if (images.length === 0) throw new ApiError('EMPTY_RESPONSE', '生图返回为空');
  return { images, model };
}

/** 把返回的 url / b64_json 统一转成 dataURL（url 会先抓成 blob 再转，全程带超时，规避 CORS 下载问题） */
async function resolveImages(
  items: { url?: string; b64_json?: string }[],
  signal?: AbortSignal
): Promise<string[]> {
  const results: string[] = [];
  for (const item of items) {
    if (item.b64_json) {
      results.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      try {
        results.push(await fetchImageDataUrl(item.url, DOWNLOAD_TIMEOUT, signal));
      } catch {
        results.push(item.url); // 兜底：直接给 url
      }
    }
  }
  return results;
}

/** 下载图片 url → dataURL（覆盖 headers 等待 + body 下载全程超时） */
async function fetchImageDataUrl(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: combineSignal(signal, controller) });
    if (!resp.ok) throw new ApiError('API_ERROR', `下载图片失败（HTTP ${resp.status}）`);
    // headers 已到，body 读取也带超时（readResponseBody 手动读流，可被 abort）
    const blob = await readResponseBody(resp, timeoutMs, url, signal);
    return await blobToDataUrl(blob);
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new ApiError('TIMEOUT', `下载图片超时（${url}）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 异步任务轮询（状态白名单放宽：不认识的 状态/响应结构 不轻易放弃） */
async function pollTask(
  baseUrl: string,
  taskUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const fullUrl = taskUrl.startsWith('http') ? taskUrl : `${baseUrl.replace(/\/$/, '')}/${taskUrl.replace(/^\//, '')}`;
  const deadline = Date.now() + GENERATE_TIMEOUT;
  // 成功/失败用宽集合匹配（大小写、常见变体）；其余一律视为仍在处理
  const SUCCESS = ['succeeded', 'success', 'successful', 'completed', 'complete', 'done', 'finished', 'finish'];
  const FAILED = ['failed', 'error', 'fail', 'failure', 'cancelled', 'canceled', 'timeout', 'expired', 'rejected'];
  while (Date.now() < deadline) {
    const resp = await apiFetch(fullUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    }, 15000, signal);

    // 轮询响应体读取同样带超时；解析失败视为还没好，继续等
    const data = await readJson<AsyncTaskStatus & ImagesResponse>(resp, BODY_READ_TIMEOUT, fullUrl, signal).catch(() => ({}));
    const record = data as AsyncTaskStatus & ImagesResponse;

    if (resp.ok) {
      const status = String(record.status ?? '').toLowerCase().trim();
      const images = extractImages(record);
      if (FAILED.includes(status)) {
        throw new ApiError('TASK_FAILED', '生成任务失败');
      }
      if (SUCCESS.includes(status) || images.length > 0) {
        if (images.length > 0) return images;
        // 状态成功但没有图 → 继续等（有的服务商状态先于图片就绪）
      }
      // pending/running/unknown → 继续轮询
    }
    await sleep(POLL_INTERVAL);
  }
  throw new ApiError('TIMEOUT', ERROR_MESSAGES['TIMEOUT'] ?? '生成超时');
}

/** 从各种返回结构里尽可能取出图片列表（url / dataURL / base64 均可） */
function extractImages(data: unknown): string[] {
  const d = data as Record<string, unknown>;
  const out: string[] = [];
  // data.data = [{url|b64_json}]
  if (Array.isArray(d.data)) {
    for (const it of d.data as { url?: string; b64_json?: string }[]) {
      if (it?.b64_json) out.push(`data:image/png;base64,${it.b64_json}`);
      else if (it?.url) out.push(normalizeResultUrl(it.url));
    }
  }
  if (out.length > 0) return out;
  // output: string | string[]
  if (Array.isArray(d.output)) {
    for (const s of d.output as string[]) if (typeof s === 'string') out.push(normalizeResultUrl(s));
  } else if (typeof d.output === 'string') {
    out.push(normalizeResultUrl(d.output));
  }
  if (out.length > 0) return out;
  if (typeof d.url === 'string') out.push(normalizeResultUrl(d.url));
  // images: string[]
  if (Array.isArray(d.images)) {
    for (const s of d.images as string[]) if (typeof s === 'string') out.push(normalizeResultUrl(s));
  }
  return out;
}

/** 过滤输出中的空串/null，保证 images 数组元素都是有效字符串 */
function cleanImages(items: (string | null | undefined)[]): string[] {
  return items.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

/** 兜底规范化：裸 base64 补 dataURL 前缀；http(s) 原样（后续会下载成 dataURL） */
function normalizeResultUrl(s: string): string {
  const t = String(s).trim();
  if (!t) return '';
  if (t.startsWith('data:') || t.startsWith('http')) return t;
  if (/^[A-Za-z0-9+/=]+$/.test(t) && t.length > 50) return `data:image/png;base64,${t}`;
  return t;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, commaIdx);
  const b64 = dataUrl.slice(commaIdx + 1);
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
