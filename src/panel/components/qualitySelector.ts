/**
 * 画质选择器组件（反推重绘 / 换脸 / 拍一套 三处共用）
 * 档位：1K 标准 / 2K 高清 / 4K 超清
 * - 与画幅下拉并排（各占一半宽）
 * - 本次会话记住选择（模块级 liveQuality），视图重渲染/切 Tab 不丢
 * - 默认 1K（与生图核心缺省行为一致：保持现状）
 */

import { GENERATE_QUALITIES } from '../../shared/constants';

/** 会话内记住的最近一次画质选择（null = 用默认 1K） */
let liveQuality: string | null = null;

/** 画质下拉 HTML（三视图生成区与画幅并排） */
export function qualitySelectHtml(): string {
  const q = liveQuality ?? '1K';
  return `
    <select class="select" id="sel-quality" style="flex:1;" aria-label="画质">
      ${GENERATE_QUALITIES.map((v) => `<option value="${v}" ${v === q ? 'selected' : ''}>画质 ${v}</option>`).join('')}
    </select>
  `;
}

/** 读取当前画质档位（生成提交时调用） */
export function currentQuality(): string {
  return liveQuality ?? '1K';
}

/** 在视图容器上绑定画质下拉变更（记住本次会话的选择） */
export function bindQualitySelect(container: HTMLElement): void {
  const sel = container.querySelector<HTMLSelectElement>('#sel-quality');
  if (sel) sel.addEventListener('change', () => { liveQuality = sel.value; });
}
