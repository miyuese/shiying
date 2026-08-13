/**
 * 轻量 UI 渲染助手（无框架）
 * - h(): 创建元素
 * - el(): HTML 字符串转元素
 * - delegate(): 事件委托
 */

import { setHtml } from '../shared/dom';

export function el(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
}

/** 简易渲染器：container.innerHTML + 图标水合 + 事件委托 */
export function mount(
  container: HTMLElement,
  html: string,
  handlers?: Record<string, (e: Event) => void>
): void {
  setHtml(container, html);
  if (handlers) {
    for (const [selector, fn] of Object.entries(handlers)) {
      const els = container.querySelectorAll<HTMLElement>(selector);
      for (const e of els) {
        e.addEventListener('click', fn);
      }
    }
  }
}

/** 显示 Toast */
export function toast(text: string): void {
  const existing = document.querySelector('.shiyin-toast');
  existing?.remove();
  const t = document.createElement('div');
  t.className = 'shiyin-toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/** 请求封装：统一 { ok, data|error } */
export async function send<T = unknown>(
  type: string,
  payload?: unknown
): Promise<T> {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (!res) throw new Error('no-response');
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}
