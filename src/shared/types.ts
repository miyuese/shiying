/**
 * 拾影 ShiYing · 全局共享类型
 * ★ 所有端共享（无 chrome API 依赖）
 */

/** API 配置（反推 / 生图分开） */
export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings {
  /** 反推（视觉理解）配置 */
  reverseApi: ApiConfig & { profileId: string };
  /** 生图配置 */
  generateApi: ApiConfig;
  /** 默认人物卡 id */
  defaultPersonCardId: string;
  /** 默认画幅（UI 选项值，见 ASPECT_RATIOS） */
  defaultAspect: string;
  /** 是否完成过首次引导 */
  onboarded: boolean;
}

export interface PersonCard {
  id: string;
  name: string;
  /** IndexedDB 图片 blob 引用 key */
  blobKeys: string[];
  /** 建卡用了几张源图（导入的成品卡为 0） */
  sourceCount: number;
  isDefault: boolean;
  createdAt: number;
  /** 三视图卡生成失败原因（未失败则为空） */
  genError?: string;
}

export type AlbumKind = 'collect' | 'generate';

export interface AlbumItem {
  id: string;
  kind: AlbumKind;
  blobKey: string;
  /** collect 时记录来源页面 */
  sourceUrl?: string;
  sourcePageUrl?: string;
  /** generate 时记录 */
  prompt?: string;
  model?: string;
  taskType?: string;
  aspect?: string;
  createdAt: number;
}

export type TaskType = 'analyze' | 'faceswap' | 'redraw' | 'suite' | 'personCard';

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  /** 参数快照（含 blobKey 引用） */
  inputs: Record<string, unknown>;
  result?: {
    blobKeys: string[];
    prompt?: string;
    /** 拍一套拆分出的 4 张单图 blobKey */
    splitBlobKeys?: string[];
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** 进度 0-100（可选） */
  progress?: number;
  /** 阶段状态文字（如「生成中」「接收图片…」），供进度条展示 */
  statusText?: string;
  /** 硬性截止时间戳（超时判定用，不依赖 setTimeout） */
  deadline?: number;
}

/** 图片输入来源 */
export type ImageSource = 'web' | 'album' | 'upload';

/** 统一消息响应 */
export type MsgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/* ---------------- 消息类型 ---------------- */

export type MessageType =
  | 'settings-get'
  | 'settings-save'
  | 'settings-test'
  | 'errors-list'
  | 'errors-clear'
  | 'image-collect'
  | 'album-list'
  | 'album-delete'
  | 'album-get'
  | 'person-card-create'
  | 'person-card-list'
  | 'person-card-delete'
  | 'person-card-set-default'
  | 'person-card-clear-error'
  | 'person-card-rename'
  | 'person-card-get'
  | 'analyze-image'
  | 'generate-image'
  | 'task-status'
  | 'task-force-fail'
  | 'task-list'
  | 'tasks-clear'
  | 'task-force-unlock'
  | 'download-file'
  | 'open-panel'
  | 'open-panel-fallback'
  | 'open-options'
  | 'inject-content'
  | 'get-last-image'
  | 'image-from-url'
  | 'image-from-album'
  | 'image-upload'
  | 'image-exists'
  | 'image-by-key'
  | 'album-add-generated'
  | 'set-pending-image'
  | 'get-pending-image'
  | 'clear-pending-image';

/** 反推方案 id（对应 prompts.ts 内嵌方案） */
export type ProfileId =
  | 'preset-general-fast'
  | 'preset-general-2'
  | 'preset-general-1'
  | 'preset-product-image'
  | 'preset-visual-cover'
  | 'preset-design-visual'
  | 'preset-gpt-portrait-tuned'
  | 'preset-gpt-general-tuned'
  | 'preset-zit-portrait-tuned'
  | 'preset-zit-general-tuned';

export interface AnalyzePayload {
  /** dataURL（已压缩） */
  imageDataUrl: string;
  profileId: ProfileId;
}

/**
 * 生图意图
 * custom：自定义提示词模式——用户手写的提示词原样送出，不追加 REDRAW_GUIDE（任务类型仍记为 redraw）
 */
export type GenerateIntent = 'faceswap' | 'redraw' | 'suite' | 'personCard' | 'custom';

export interface GeneratePayload {
  prompt: string;
  intent: GenerateIntent;
  /** 构图参考图 dataURL（与 sourceBlobKey 二选一；优先用 blobKey 走原图直传） */
  sourceRef?: string;
  /** 人脸参考图 dataURL（与 faceBlobKey 二选一） */
  faceRef?: string;
  /** 多张人脸参考图 dataURL（直接上传的面部参考照片，同一人；优先于 faceRef） */
  faceRefs?: string[];
  /** 构图参考图 IndexedDB blobKey（推荐：避免占 storage 配额 + 原图直传不压缩） */
  sourceBlobKey?: string;
  /**
   * 多张构图/身份参考图 IndexedDB blobKey（intent=personCard 时使用：
   * 把卡上全部源图都作为三视图生成的身份参考；优先于 sourceBlobKey）
   */
  sourceBlobKeys?: string[];
  /** 人脸参考图 IndexedDB blobKey */
  faceBlobKey?: string;
  /** 多张人脸参考图 IndexedDB blobKey（persistRegenInputs 把 faceRefs 落盘后回填；优先于 faceBlobKey） */
  faceBlobKeys?: string[];
  aspectRatio: string;
  /**
   * 拍一套配比：人像张数 / 配图张数（合计 4）。
   * 有值时后台拆成两批串行请求（人像批带人脸参考、配图批只带底图），结果合并进同一任务；
   * 缺省时按旧的「4 张人像四宫格」处理。
   */
  suiteMix?: { portrait: number; scene: number };
  /** 画质档位（'1K' | '2K' | '4K'；缺省/1K 保持现状：具体像素尺寸、不传 quality） */
  quality?: string;
  /** 关联的人物卡 id（仅 intent=personCard 时使用） */
  cardId?: string;
  /** 为 true 时，生成成功/失败都不删除 sourceBlobKey/faceBlobKey（源图属于人物卡资产） */
  keepSourceBlob?: boolean;
}

export interface TaskStatusPayload {
  taskId: string;
}

export interface DownloadPayload {
  url: string;
  filename: string;
}

export interface CollectPayload {
  imageUrl: string;
  pageUrl: string;
  alt?: string;
}

export interface AlbumListPayload {
  cursor?: number;
  limit?: number;
}

export interface AlbumDeletePayload {
  id: string;
}

export interface PersonCardCreatePayload {
  /** dataURL 列表（1-5 张，兼容旧调用）；新面板走 blobKeys 原图直传 */
  images?: string[];
  /** 已由面板存入 IndexedDB 的源图 blobKey 列表（优先于 images） */
  blobKeys?: string[];
  name?: string;
  /**
   * 导入成品卡（设备迁移场景）：上传的图本身就是成品三视图卡，
   * 只入库、不触发三视图生成，sourceCount 记为 0。
   * 仅用于创建这一个动作，不落库——导入的卡与生成的卡在数据上完全同构。
   */
  skipGenerate?: boolean;
}

export interface PersonCardDeletePayload {
  id: string;
}

export interface PersonCardSetDefaultPayload {
  id: string;
}

/** 人物卡改名 */
export interface PersonCardRenamePayload {
  id: string;
  name: string;
}

export interface TestConnPayload {
  which: 'reverse' | 'generate';
}

export interface ImageFromUrlPayload {
  url: string;
}

export interface ImageFromAlbumPayload {
  id: string;
}

export interface ImageUploadPayload {
  dataUrl: string;
}

export interface ImageExistsPayload {
  key: string;
}

export interface AlbumAddGeneratedPayload {
  dataUrl: string;
  prompt?: string;
  model?: string;
  taskType?: string;
  aspect?: string;
}

/** 通用消息体（background router 使用） */
export interface MsgEnvelope<P = unknown> {
  type: MessageType;
  payload?: P;
}
