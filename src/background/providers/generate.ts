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
  PERSON_CARD_SUBMIT_TIMEOUT,
  BODY_READ_TIMEOUT,
  DOWNLOAD_TIMEOUT,
  POLL_INTERVAL,
  ERROR_MESSAGES,
  QUALITY_TO_API,
} from '../../shared/constants';
import { composeFaceBadge } from '../../shared/utils/image';
import { buildGeneratePrompt, buildSuitePortraitPrompt, buildSuiteScenePrompt } from '../../shared/prompts';
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
    /** 原图直传：单张 Blob（兼容） */
    sourceBlob?: Blob;
    /** 原图直传：多张 Blob（人物卡三视图生成时全部源图参与；优先于 sourceBlob） */
    sourceBlobs?: Blob[];
    faceRef?: string;
    /** 人脸参考 Blob（兼容单张） */
    faceBlob?: Blob;
    /** 多张人脸参考 Blob（直接上传 1~2 张面部照片；优先于 faceBlob） */
    faceBlobs?: Blob[];
    aspectRatio: string;
    /** 画质档位 '1K' | '2K' | '4K'；缺省/1K 保持现状（具体像素尺寸、不传 quality） */
    quality?: string;
    /** 拍一套批次：portrait=人像批 / scene=配图批；缺省时走普通模板 */
    suiteBatch?: 'portrait' | 'scene';
    /** 拍一套本批张数（决定排布：1 张直出 / 2 张并排 / 3~4 张四宫格） */
    suiteCount?: number;
    /** 强制指定像素尺寸（拍一套的 3:2、3:4 不在 ASPECT_RATIOS 表里时用） */
    sizeOverride?: string;
  },
  signal?: AbortSignal,
  onProgress?: (info: { percent: number; statusText?: string }) => void
): Promise<GenerateImageResult> {
  const settings = await getSettings();
  const { baseUrl, apiKey, model } = settings.generateApi;
  if (!apiKey) throw new ApiError('NOT_CONFIGURED', ERROR_MESSAGES['NOT_CONFIGURED'] ?? '请先完成 API 配置');
  const safeBase = baseUrl.replace(/\/$/, '');
  const safeKey = apiKey;

  // 2K/4K：按服务商文档走「画幅比例 + quality」精确映射到 1K/2K/4K
  // 1K / 缺省：完全保持现状（具体像素尺寸、不传 quality，兼容只认像素的服务商）
  const useRatioQuality = params.quality === '2K' || params.quality === '4K';
  const size = params.sizeOverride
    ?? (useRatioQuality ? params.aspectRatio : (ASPECT_RATIOS[params.aspectRatio] ?? '1024x1024'));
  const qualityApi = useRatioQuality ? QUALITY_TO_API[params.quality!] : undefined;
  // 拍一套分批：人像批 / 配图批各自一套模板（配图批由调用方不给 faceRef，避免静物格里冒出人）
  let finalPrompt = params.suiteBatch
    ? params.suiteBatch === 'portrait'
      ? buildSuitePortraitPrompt(params.suiteCount ?? 1)
      : buildSuiteScenePrompt(params.suiteCount ?? 1)
    : buildGeneratePrompt(params.intent, params.prompt);
  const sourceBlobs = params.sourceBlobs?.length ? params.sourceBlobs : params.sourceBlob ? [params.sourceBlob] : [];
  const faceBlobs = params.faceBlobs?.length ? params.faceBlobs : params.faceBlob ? [params.faceBlob] : [];
  const hasSource = sourceBlobs.length > 0 || Boolean(params.sourceRef);
  const hasFace = faceBlobs.length > 0 || Boolean(params.faceRef);
  const multiImage = hasSource && hasFace;
  // 拍一套的模板已经自带图序说明，不再叠加通用的「第一张/第二张」前缀，避免干扰排布指令
  if (params.suiteBatch) {
    // no-op
  } else if (params.intent === 'personCard' && sourceBlobs.length >= 2) {
    // 人物卡多图：明确告知模型这些图都是同一个人，综合提取身份
    finalPrompt = `本次提交了 ${sourceBlobs.length} 张参考图（image 字段中的多张图片），这些图片均为同一个人（不同角度/场景/表情），请综合所有图片提取该人物稳定一致的面部身份，保证三视图之间身份一致。\n\n${finalPrompt}`;
  } else if (multiImage && faceBlobs.length >= 2) {
    // 底图 + 多张人脸参考（直接上传照片）：第一张=构图，第二张及之后=同一人面部身份
    finalPrompt = `本次提交了 ${1 + faceBlobs.length} 张参考图：第一张（image 字段第一张）是构图与场景参考；第二张及之后的图片（image 字段第二张起）均为同一个人（面部身份参考）。请按提示词要求完成任务。\n\n${finalPrompt}`;
  } else if (multiImage) {
    // 多图输入时，明确告知模型：第一张=场景/构图参考，第二张=人脸身份参考
    finalPrompt = `本次提交了两张参考图：第一张图（image 字段中的第一张）是构图与场景参考；第二张图（image 字段中的第二张）是人物面部身份参考。请按提示词要求完成任务。\n\n${finalPrompt}`;
  }

  const url = `${safeBase}/images/edits`;

  /**
   * 请求元信息：只用于出错时写进错误日志。
   * 之前错误信息只有「请求超时（url）」，无法判断是发不出去、服务商不回话，
   * 还是参数被拒——这里把模型/尺寸/图数/体积/提示词长度都带上。
   */
  const allBlobs = [...sourceBlobs, ...faceBlobs];
  const refCount = (params.sourceRef ? 1 : 0) + (params.faceRef ? 1 : 0);
  const imgCount = allBlobs.length > 0 ? allBlobs.length : refCount;
  const totalBytes = allBlobs.reduce((n, b) => n + (b.size || 0), 0);
  const sizeText = totalBytes >= 1048576
    ? `${(totalBytes / 1048576).toFixed(1)}MB`
    : `${Math.max(1, Math.round(totalBytes / 1024))}KB`;
  const reqMeta = `model=${model} size=${size} images=${imgCount}(${sizeText}) prompt=${finalPrompt.length}字`;

  // 等响应头的上限：人物卡按实测值收紧（失败能快些暴露），其余链路保持原有的长预算
  const submitTimeout = params.intent === 'personCard' ? PERSON_CARD_SUBMIT_TIMEOUT : GENERATE_TIMEOUT;
  const startedAt = Date.now();

  // 组装 multipart form
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', finalPrompt);
  form.append('size', size);
  if (qualityApi) form.append('quality', qualityApi);
  form.append('n', '1');
  // 返回格式：2K/4K 走 url（大图 base64 体积 +33%，拖慢接收）；1K/默认保持 b64_json（图小无所谓）。
  // 图片质量由 size/quality 参数决定，response_format 只影响传输方式，不影响画质。
  form.append('response_format', useRatioQuality ? 'url' : 'b64_json');

  // 原图直传：Blob 直接进 multipart（不转 dataURL、不压缩）；dataURL 仅作兼容
  // 多张源图（人物卡三视图生成）→ 重复 append image 字段（edits 接口支持最多 16 张）
  // 第一张保持原名 source.png（与旧版请求逐字节一致，兼容对文件名敏感的服务商）
  if (sourceBlobs.length > 0) {
    sourceBlobs.forEach((blob, i) => form.append('image', blob, i === 0 ? 'source.png' : `source-${i}.png`));
  } else if (params.sourceRef) {
    form.append('image', dataUrlToBlob(params.sourceRef), 'source.png');
  }
  // 人脸参考：多张（直接上传照片）→ 重复 append；第一张保持原名 face.png
  if (faceBlobs.length > 0) {
    faceBlobs.forEach((blob, i) => form.append('image', blob, i === 0 ? 'face.png' : `face-${i}.png`));
  } else if (params.faceRef) {
    form.append('image', dataUrlToBlob(params.faceRef), 'face.png');
  }

  onProgress?.({ percent: 25, statusText: '提交请求…' });
  // 等待期间每 10s 刷新一次已等时长：服务商受理后不回话时，界面不再是纹丝不动的 25%
  const ticker = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    onProgress?.({ percent: 25, statusText: `已提交，等待服务商返回（${s}s）` });
  }, 10000);
  let resp: Response;
  try {
    resp = await apiFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${safeKey}` },
      body: form,
    }, submitTimeout, signal);
  } catch (err) {
    // 连响应头都没拿到：多半是服务商受理后不回话 / 连接已死。带上元信息与已等时长，便于定位
    const e = err as ApiError;
    const waited = Math.round((Date.now() - startedAt) / 1000);
    throw new ApiError(
      e.code ?? 'NETWORK',
      `${e.message}｜${reqMeta}，已等 ${waited}s`,
      e.status
    );
  } finally {
    clearInterval(ticker);
  }

  // 响应头已到（同步型中转站在这一步等待生成完成）；异步型中转站会很快返回任务 id
  const headerMs = Date.now() - startedAt;
  onProgress?.({ percent: 30, statusText: '等待生成…' });

  // 响应体读取也有超时（响应头到了但 body 迟迟不流完时不会无限等）
  onProgress?.({ percent: 35, statusText: '读取响应…' });
  const data = await readJson<ImagesResponse | AsyncTaskResponse>(resp, BODY_READ_TIMEOUT, url, signal);

  if (!resp.ok) {
    // 双图不被支持 → 拼图法重试一次（拼图只支持 1 张人脸参考；多张脸时不做降级，直接报错）
    if (resp.status === 400 && multiImage && faceBlobs.length === 1) {
      onProgress?.({ percent: 25, statusText: '服务商不支持多图，改用拼图方式重试…' });
      return retryWithComposedImage(url, safeKey, model, finalPrompt, size, qualityApi, {
        sourceRef: params.sourceRef,
        sourceBlob: sourceBlobs[0],
        faceRef: params.faceRef,
        faceBlob: faceBlobs[0],
      }, signal);
    }
    // 附上请求元信息与响应体片段：错误日志里能直接看出是参数被拒还是别的原因
    const httpErr = classifyHttpError(resp.status, data);
    const bodyHead = JSON.stringify(data ?? {}).slice(0, 200);
    throw new ApiError(
      httpErr.code,
      `${httpErr.message}｜${reqMeta}，用时 ${(headerMs / 1000).toFixed(1)}s，响应：${bodyHead}`,
      httpErr.status
    );
  }

  // 1) 同步返回 b64_json / url
  const syncData = data as ImagesResponse;
  if (Array.isArray(syncData.data)) {
    onProgress?.({ percent: 65, statusText: '图片已返回，处理中…' });
    const images = await resolveImages(syncData.data, signal, onProgress);
    if (images.length > 0) return { images, model };
  }

  // 2) 异步任务 → 轮询
  const asyncData = data as AsyncTaskResponse;
  const taskUrl = asyncData.task_id || asyncData.taskId || asyncData.id || '';
  if (taskUrl) {
    const images = await pollTask(safeBase, taskUrl, safeKey, signal, onProgress);
    if (images.length > 0) return { images, model };
  }

  // 3) 直接返回 url
  if (asyncData.url) {
    const images = await resolveImages([{ url: asyncData.url }], signal, onProgress);
    if (images.length > 0) return { images, model };
  }
  if (typeof asyncData.output === 'string') {
    const images = await resolveImages([{ url: asyncData.output }], signal, onProgress);
    if (images.length > 0) return { images, model };
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
  signal?: AbortSignal,
  onProgress?: (info: { percent: number; statusText?: string }) => void
): Promise<string[]> {
  const results: string[] = [];
  for (const item of items) {
    if (item.b64_json) {
      results.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      onProgress?.({ percent: 70, statusText: '下载图片…' });
      try {
        results.push(await fetchImageDataUrl(item.url, DOWNLOAD_TIMEOUT, signal));
      } catch {
        results.push(item.url); // 兜底：直接给 url
      }
    }
  }
  onProgress?.({ percent: 75, statusText: '图片已接收' });
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
  signal?: AbortSignal,
  onProgress?: (info: { percent: number; statusText?: string }) => void
): Promise<string[]> {
  const fullUrl = taskUrl.startsWith('http') ? taskUrl : `${baseUrl.replace(/\/$/, '')}/${taskUrl.replace(/^\//, '')}`;
  const deadline = Date.now() + GENERATE_TIMEOUT;
  const startedAt = Date.now();
  // 成功/失败用宽集合匹配（大小写、常见变体）；其余一律视为仍在处理
  const SUCCESS = ['succeeded', 'success', 'successful', 'completed', 'complete', 'done', 'finished', 'finish'];
  const FAILED = ['failed', 'error', 'fail', 'failure', 'cancelled', 'canceled', 'timeout', 'expired', 'rejected'];
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    // 轮询阶段进度：40 → 60，随轮次递增
    onProgress?.({
      percent: Math.min(40 + round * 2, 60),
      statusText: `生成中（已等待 ${elapsed} 秒）`,
    });
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
        if (images.length > 0) {
          onProgress?.({ percent: 65, statusText: '图片已返回，处理中…' });
          return images;
        }
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
