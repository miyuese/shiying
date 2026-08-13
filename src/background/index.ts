/**
 * Background Service Worker 入口
 * - onMessage 路由
 * - 长连接（任务广播）
 * - SW 唤醒恢复
 * - keep-alive
 */

import { dispatchMessage } from './router';
import { onTaskChange, recoverTasks, purgeTasksToFitQuota, watchdogStaleTasks } from './tasks';
import { WORKBENCH_CHANNEL, TASK_CHANGED_EVENT } from '../shared/messages';
import type { Task } from '../shared/types';
import { installErrorCapture, logError } from './store/errorLog';

// 全局错误捕获（background 端）——必须保证任何异常都不影响主流程
try {
  installErrorCapture('background');
  self.addEventListener('error', (e) => {
    void logError('background', e.message, e.error?.stack, e.filename, e.lineno, e.colno);
  });
  self.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as Error | undefined;
    void logError('background', r?.message ?? 'Unhandled promise rejection', r?.stack);
  });
} catch {
  /* 错误捕获自身失败也不阻塞扩展 */
}

// 长连接端口集合（面板监听任务广播）
const ports = new Set<chrome.runtime.Port>();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void dispatchMessage(msg).then(sendResponse);
  return true; // 异步响应
});

// 任务变更 → 广播给所有连接的面板
onTaskChange((task: Task) => {
  const payload = { event: TASK_CHANGED_EVENT, task };
  for (const port of ports) {
    try {
      port.postMessage(payload);
    } catch {
      ports.delete(port);
    }
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === WORKBENCH_CHANNEL) {
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
  }
});

// SW 启动时恢复中断任务
chrome.runtime.onStartup.addListener(() => {
  void recoverTasks();
  void purgeTasksToFitQuota();
});
chrome.runtime.onInstalled.addListener(() => {
  void recoverTasks();
  void purgeTasksToFitQuota();
});
// 立即执行一次（SW 当前进程启动时也跑）
void recoverTasks();
void purgeTasksToFitQuota();

// keep-alive：定期自唤醒（side panel 打开期间保持活跃）
chrome.alarms.create('shiyin-keepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'shiyin-keepalive') {
    // 空操作保持 SW 活跃
    void chrome.storage.local.get('_ping');
    // 看门狗：强制结束卡死的任务（SW 休眠后超时任务兜底）
    void watchdogStaleTasks();
  }
});

export {};
