/**
 * 拾影 ShiYing · 消息类型常量
 */

import type { MessageType } from './types';

export const MESSAGE_TYPES: readonly MessageType[] = [
  'settings-get',
  'settings-save',
  'settings-test',
  'errors-list',
  'errors-clear',
  'image-collect',
  'album-list',
  'album-delete',
  'album-get',
  'person-card-create',
  'person-card-list',
  'person-card-delete',
  'person-card-set-default',
  'person-card-clear-error',
  'person-card-get',
  'analyze-image',
  'generate-image',
  'task-status',
  'task-force-fail',
  'task-list',
  'download-file',
  'open-panel',
  'open-panel-fallback',
  'open-options',
  'inject-content',
  'get-last-image',
  'image-from-url',
  'image-from-album',
  'image-upload',
  'image-exists',
  'image-by-key',
  'album-add-generated',
  'set-pending-image',
  'get-pending-image',
  'clear-pending-image',
] as const;

/** 长连接名称（任务广播） */
export const WORKBENCH_CHANNEL = 'shiyin-workbench';

/** 任务状态变更广播 */
export const TASK_CHANGED_EVENT = 'task-changed';

/** 挂起图就绪广播（后台 set-pending-image 后通知已打开的面板即时应用） */
export const PENDING_IMAGE_READY_EVENT = 'pending-image-ready';
