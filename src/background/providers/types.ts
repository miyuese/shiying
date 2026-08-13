/**
 * OpenAI 兼容协议类型
 */

/** chat/completions 请求 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: { message: { content: string | null } }[];
  error?: { message?: string; code?: string };
}

/** images 响应（同步） */
export interface ImagesResponse {
  data: { url?: string; b64_json?: string }[];
  error?: { message?: string; code?: string };
}

/** 异步任务响应（部分中转站） */
export interface AsyncTaskResponse {
  status?: string;
  task_id?: string;
  taskId?: string;
  id?: string;
  url?: string;
  output?: string | string[];
  error?: { message?: string; code?: string };
}

/** 异步任务查询响应 */
export interface AsyncTaskStatus {
  status: string;
  url?: string;
  output?: string | string[];
  error?: { message?: string; code?: string };
}

/** 统一 HTTP 错误 */
export class ApiError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * 把外部 signal（如任务看门狗/取消的 AbortController）接到内部超时 controller 上。
 * 任一 abort 都会真正中止底层 fetch。
 */
export function combineSignal(signal: AbortSignal | undefined, controller: AbortController): AbortSignal {
  if (!signal) return controller.signal;
  signal.addEventListener('abort', () => controller.abort(), { once: true });
  return controller.signal;
}

/** fetch 封装：超时 + 错误分级。signal 为可选的外部中止信号（看门狗/取消可叫停真正请求） */
export async function apiFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: combineSignal(signal, controller) });
    return resp;
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new ApiError('TIMEOUT', `请求超时（${url}）`);
    }
    throw new ApiError('NETWORK', `网络异常（${url}）`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读取响应体全部字节 → Blob，带超时 + 外部中止支持。
 * 手动读流（resp.body.getReader()），超时/外部 abort 时 reader.cancel() 真正打断阻塞中的 read()，
 * 响应头到了但 body 迟迟不流完时不会无限等。
 */
export async function readResponseBody(
  resp: Response,
  timeoutMs: number,
  url: string,
  signal?: AbortSignal
): Promise<Blob> {
  const body = resp.body;
  if (!body) return new Blob();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void reader.cancel().catch(() => {});
      reject(err);
    };
    timer = setTimeout(() => fail(new ApiError('TIMEOUT', `读取响应超时（${url}）`)), timeoutMs);
    const onAbort = () => fail(new ApiError('TIMEOUT', `读取响应超时（${url}）`));
    if (signal) {
      if (signal.aborted) {
        fail(new ApiError('TIMEOUT', `读取响应超时（${url}）`));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const finish = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        if (settled) return;
        settled = true;
        finish();
        if (timer) clearTimeout(timer);
        resolve(new Blob(chunks as unknown as BlobPart[]));
      } catch {
        if (settled) return;
        settled = true;
        finish();
        if (timer) clearTimeout(timer);
        reject(new ApiError('NETWORK', `网络异常（${url}）`));
      }
    })();
  });
}

/**
 * 读取响应体为 JSON，带超时 + 外部中止支持。
 */
export async function readJson<T = unknown>(
  resp: Response,
  timeoutMs: number,
  url: string,
  signal?: AbortSignal
): Promise<T> {
  const blob = await readResponseBody(resp, timeoutMs, url, signal);
  const text = await blob.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/** 按 HTTP 状态分级（message 带状态码便于日志定位） */
export function classifyHttpError(status: number, body?: unknown): ApiError {
  const msg = (body as { error?: { message?: string } })?.error?.message;
  const detail = msg ?? '';
  switch (status) {
    case 401:
      return new ApiError('AUTH_INVALID', `401 API Key 无效${detail ? '：' + detail : ''}`, status);
    case 403:
      return new ApiError('AUTH_FORBIDDEN', `403 无权限${detail ? '：' + detail : ''}`, status);
    case 404:
      return new ApiError('ENDPOINT_NOT_FOUND', `404 模型或端点不支持${detail ? '：' + detail : ''}`, status);
    case 429:
      return new ApiError('RATE_LIMITED', `429 额度不足或请求过快${detail ? '：' + detail : ''}`, status);
    default:
      return new ApiError('API_ERROR', `${status} 请求失败${detail ? '：' + detail : ''}`, status);
  }
}
