/**
 * 拾影 ShiYing · 常量
 */

import type { ProfileId } from './types';

export const APP_NAME = '拾影 ShiYing';
export const APP_VERSION = '0.1.0';

/** IndexedDB 数据库与仓库 */
export const DB_NAME = 'shiyin-db';
export const DB_VERSION = 2;
export const DB_STORE_IMAGES = 'images';
export const DB_STORE_ERRORS = 'errors';

/** 图片压缩参数 */
export const MAX_IMAGE_EDGE = 2048;
export const IMAGE_JPEG_QUALITY = 0.9;
export const COLLECT_MAX_EDGE = 1200;

/** 人物卡限制 */
export const PERSON_CARD_MAX_SOURCES = 5;
export const PERSON_CARD_MAX_COUNT = 20;
export const PERSON_CARD_ASPECT = '16:9';

/** 相册分页 */
export const ALBUM_PAGE_SIZE = 50;

/** 悬浮层防抖 */
export const HOVER_DEBOUNCE_MS = 300;

/** 超时（ms） */
export const ANALYZE_TIMEOUT = 90000; // 90s：视觉模型「看图 + 最多 1200 token 详细描述」，经中转站常超 15s，给足时间（实测建议按 ×2 余量）
// 生图超时：等「生图服务商返回结果」（同步中转站=等待生成完成）。实测中转站慢时 5~6 分钟，给足 7 分钟内的一半预算
export const GENERATE_TIMEOUT = 400000;
// 读取响应体（resp.json 之前的 body 流）超时：响应头到了但 body 迟迟不来时兜底
export const BODY_READ_TIMEOUT = 60000;
// 下载生成结果图（url → blob）超时：覆盖 headers 等待 + body 下载全过程
export const DOWNLOAD_TIMEOUT = 90000;
export const TEST_TIMEOUT = 10000;
export const POLL_INTERVAL = 3000;

/** 任务保留上限 */
export const TASK_MAX_KEEP = 50;

/** 反推默认方案 */
export const DEFAULT_PROFILE_ID: ProfileId = 'preset-general-fast';

/** 默认 API 配置 */
export const DEFAULT_SETTINGS = {
  reverseApi: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    profileId: DEFAULT_PROFILE_ID,
  },
  generateApi: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-image-2',
  },
  defaultPersonCardId: '',
  defaultAspect: '3:4',
  onboarded: false,
};

/** 画幅映射（UI 选项 → OpenAI size） */
export const ASPECT_RATIOS: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '768x1024',
  '4:3': '1024x768',
  '9:16': '768x1344',
  '16:9': '1344x768',
};

export const ASPECT_OPTIONS = Object.keys(ASPECT_RATIOS);

/** 生图画质档位（UI 顺序：1K 标准 / 2K 高清 / 4K 超清） */
export const GENERATE_QUALITIES = ['1K', '2K', '4K'] as const;

/**
 * 画质档位 → API `quality` 字段。
 * 依据服务商文档：size 为空/auto/比例时，medium 映射到 2K，high/hd 映射到 4K，其它默认 1K。
 * 因此 1K 保持现状（具体像素尺寸、不传 quality）；仅 2K/4K 走「比例 + quality」。
 */
export const QUALITY_TO_API: Record<string, string> = {
  '1K': 'auto',
  '2K': 'medium',
  '4K': 'high',
};

/** 生图模型选项（快乐师傅默认 gpt-image-2；其余模型可在设置页手动填） */
export const GENERATE_MODEL_OPTIONS = ['gpt-image-2'];

/** 反推方案元信息（供设置页选择） */
export const PROFILE_OPTIONS: { id: ProfileId; label: string; desc: string }[] = [
  { id: 'preset-general-fast', label: '通用快速反推', desc: '默认方案 · 通用场景高保真重建' },
  { id: 'preset-general-2', label: '人像通用详细', desc: '人像超详细反推（摄影指导式）' },
  { id: 'preset-general-1', label: '人像通用概括', desc: '人像/通用概括式反推（三步流程）' },
  { id: 'preset-product-image', label: '商品图片反推', desc: '商品展示画面重建' },
  { id: 'preset-visual-cover', label: '视觉封面反推', desc: '社交媒体封面构图重建' },
  { id: 'preset-design-visual', label: '设计视觉反推', desc: '整套视觉系统重建' },
  { id: 'preset-gpt-portrait-tuned', label: 'GPT人像特调', desc: 'GPT 系模型人像特调（8 段标签）' },
  { id: 'preset-gpt-general-tuned', label: 'GPT通用特调', desc: 'GPT 系模型通用特调' },
  { id: 'preset-zit-portrait-tuned', label: 'ZIT人像特调', desc: 'Z-Image-Turbo 人像重建' },
  { id: 'preset-zit-general-tuned', label: 'ZIT通用特调', desc: 'Z-Image-Turbo 通用复刻' },
];

/** 反推 token 上限 */
export const ANALYZE_MAX_TOKENS = 1200;

/** 错误文案映射（见 PRD 4.12） */
export const ERROR_MESSAGES: Record<string, string> = {
  AUTH_INVALID: 'API Key 无效，请到设置检查',
  RATE_LIMITED: '额度不足或请求过快，请稍后重试',
  IMAGE_TOO_LARGE: '图片过大，已自动压缩',
  FETCH_BLOCKED: '该图片无法直接读取，请截图或下载后上传',
  TIMEOUT: '生图服务响应较慢（约需 1~7 分钟），请稍候或重试',
  NETWORK: '网络异常，请检查网络后重试',
  NO_FACE: '源图未检测到清晰人脸，无法换脸',
  INVALID_CARD: '人物卡无效，请重新创建',
  NOT_CONFIGURED: '请先完成 API 配置',
};
