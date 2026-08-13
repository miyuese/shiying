/**
 * 拾影 ShiYing · DOM 渲染咽喉
 * setHtml：写 innerHTML + 立即水合图标（全站动态渲染统一入口）。
 * renderPreserved：重建前捕获焦点/光标/滚动位，重建后恢复 ——
 *   解决「每次 setState 全量 innerHTML 重建」导致的失焦、丢字、滚动跳动。
 */

import { hydrateIcons } from './icons';

/** 写入 HTML 并水合图标 */
export function setHtml(container: HTMLElement, html: string): void {
  container.innerHTML = html;
  hydrateIcons(container);
}

interface FocusSnapshot {
  id?: string;
  tag?: string;
  value?: string;
  selStart?: number | null;
  selEnd?: number | null;
}

/**
 * 重建前捕获当前焦点元素（需在当前容器内、且有 id 才可恢复）与滚动位置，
 * 重建后按 id 找回并恢复焦点/光标/值/滚动。
 */
export function renderPreserved(
  container: HTMLElement,
  html: string,
  scrollContainer?: HTMLElement | null
): void {
  const active = document.activeElement as HTMLElement | null;
  let snapshot: FocusSnapshot | null = null;
  if (active && active.isConnected && container.contains(active)) {
    const tag = active.tagName;
    const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const el = active as HTMLInputElement | HTMLTextAreaElement;
    snapshot = {
      id: active.id || undefined,
      tag,
      value: isEditable ? el.value : undefined,
      selStart: isEditable ? el.selectionStart : null,
      selEnd: isEditable ? el.selectionEnd : null,
    };
  }
  const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

  setHtml(container, html);

  // 恢复延迟到微任务：shell 重建后视图内容还会同步填充（如 panel renderShell
  // 先重建 #view 再渲染视图），等本轮同步渲染跑完再找回目标元素才稳定。
  queueMicrotask(() => {
    if (snapshot?.id) {
      const target = container.querySelector<HTMLElement>('#' + CSS.escape(snapshot.id));
      if (target && target.tagName === snapshot.tag) {
        const editable = target as HTMLInputElement | HTMLTextAreaElement;
        if (snapshot.tag === 'INPUT' || snapshot.tag === 'TEXTAREA' || snapshot.tag === 'SELECT') {
          if (snapshot.value !== undefined) editable.value = snapshot.value;
          if (snapshot.selStart != null) {
            try {
              editable.setSelectionRange(snapshot.selStart, snapshot.selEnd ?? snapshot.selStart);
            } catch {
              /* select 等不支持的控件忽略 */
            }
          }
        }
        target.focus({ preventScroll: true });
      }
    }
    if (scrollContainer && scrollTop > 0) scrollContainer.scrollTop = scrollTop;
  });
}
