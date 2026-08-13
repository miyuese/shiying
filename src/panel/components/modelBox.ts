/**
 * 模型盒组件（反推重绘 / 换脸 / 拍一套 三处共用）
 * 显示当前生图模型，点击提示到设置页配置。
 */

export function modelBoxHtml(model: string | undefined): string {
  return `
    <div class="field-box" title="模型在设置页配置">
      <span class="field-label">模型</span>
      <span class="model-chip">${model ?? '未配置'}</span>
    </div>
  `;
}
