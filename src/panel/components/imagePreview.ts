/**
 * 悬浮大图预览（面板通用）
 * 用法：给任意 <img>（或其包裹容器）加 data-preview 属性，initImagePreview() 全局委托自动绑定。
 * 交互：
 *  - 鼠标悬浮并停留（约 0.5 秒）→ 弹出大图预览（全图适配窗口，居中）
 *  - 滚轮 → 1x~4x 缩放（以鼠标位置为中心）
 *  - 拖拽 → 缩放后平移看图
 *  - 移开 / ESC / 移出窗口 → 关闭
 *  - 「打开原图」→ 新标签页打开 100% 原图（dataURL 转 objectURL，避免超大 URL）
 * 原理：缩略图与预览共用同一张全分辨率 dataURL，零额外网络请求，只放大渲染。
 * 悬浮延时：光标在同一张图上停留 HOVER_DELAY 才弹出，划过屏幕不会误触。
 */

let layer: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let previewImg: HTMLImageElement | null = null;
let zoomBadge: HTMLElement | null = null;

let currentSrc = '';
let scale = 1;
let tx = 0;
let ty = 0;

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartTx = 0;
let dragStartTy = 0;

/** 悬浮停留多久才弹出预览（ms） */
const HOVER_DELAY = 500;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let lastHost: HTMLElement | null = null;

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function clearHoverTimer(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function ensureLayer(): void {
  if (layer) return;
  layer = document.createElement('div');
  layer.className = 'img-preview-layer';
  layer.innerHTML = `
    <div class="img-preview-stage" data-role="stage">
      <img data-role="img" alt="预览">
      <span class="img-preview-zoom" data-role="zoom">100%</span>
    </div>
    <span class="img-preview-hint">滚轮缩放 · 拖拽平移 · 点击空白或 ESC 关闭</span>
    <button class="img-preview-open" data-role="open">打开原图</button>
  `;
  document.body.appendChild(layer);
  stage = layer.querySelector('[data-role="stage"]') as HTMLElement;
  previewImg = layer.querySelector('[data-role="img"]') as HTMLImageElement;
  zoomBadge = layer.querySelector('[data-role="zoom"]') as HTMLElement;

  const openBtn = layer.querySelector('[data-role="open"]') as HTMLButtonElement;
  openBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentSrc) void openOriginal(currentSrc);
    hidePreview();
  });

  // 点击遮罩空白处关闭
  layer.addEventListener('click', (e) => {
    if (e.target === layer) hidePreview();
  });

  // 滚轮缩放（以鼠标位置为中心）
  layer.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.25 : 0.8);
    },
    { passive: false }
  );

  // 拖拽平移
  stage!.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartTx = tx;
    dragStartTy = ty;
    stage!.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging || !previewImg) return;
    const imgW = previewImg.clientWidth || 1;
    const imgH = previewImg.clientHeight || 1;
    tx = clamp(dragStartTx + (e.clientX - dragStartX), -(imgW * (scale - 1)) / 2, (imgW * (scale - 1)) / 2);
    ty = clamp(dragStartTy + (e.clientY - dragStartY), -(imgH * (scale - 1)) / 2, (imgH * (scale - 1)) / 2);
    applyTransform();
  });
  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      if (stage) stage.style.cursor = 'grab';
    }
  });
}

/** 以屏幕坐标 (clientX, clientY) 为中心缩放 */
function zoomAt(clientX: number, clientY: number, factor: number): void {
  if (!previewImg || !stage) return;
  const imgW = previewImg.clientWidth || 1;
  const imgH = previewImg.clientHeight || 1;
  const sRect = stage.getBoundingClientRect();
  const cx = clientX - (sRect.left + sRect.width / 2);
  const cy = clientY - (sRect.top + sRect.height / 2);
  const next = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
  if (next === scale) return;
  // 保持鼠标下的图片点位置不动
  const px = (cx - tx) / scale;
  const py = (cy - ty) / scale;
  scale = next;
  tx = clamp(cx - px * scale, -(imgW * (scale - 1)) / 2, (imgW * (scale - 1)) / 2);
  ty = clamp(cy - py * scale, -(imgH * (scale - 1)) / 2, (imgH * (scale - 1)) / 2);
  applyTransform();
}

function applyTransform(): void {
  if (!previewImg) return;
  previewImg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  if (zoomBadge) zoomBadge.textContent = scale <= 1 ? '100%' : `${Math.round(scale * 100)}%`;
}

function resetView(): void {
  scale = 1;
  tx = 0;
  ty = 0;
  applyTransform();
}

export function showPreview(src: string): void {
  if (!src) return;
  ensureLayer();
  if (!layer) return;
  if (currentSrc !== src) {
    currentSrc = src;
    previewImg!.src = src;
    resetView();
  }
  layer.style.display = 'flex';
}

export function hidePreview(): void {
  if (!layer) return;
  layer.style.display = 'none';
  currentSrc = '';
  dragging = false;
  if (stage) stage.style.cursor = 'grab';
}

/** 启动悬浮延时：光标在同一元素上停留 HOVER_DELAY 才弹出 */
function schedulePreview(host: HTMLElement, src: string): void {
  clearHoverTimer();
  lastHost = host;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    // 期间若移走，mouseover 已取消定时器；能走到这里说明一直停留
    showPreview(src);
  }, HOVER_DELAY);
}

/** 新标签打开原图：dataURL 先转 objectURL（超大 dataURL 放地址栏不可靠） */
async function openOriginal(src: string): Promise<void> {
  try {
    const resp = await fetch(src);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch {
    window.open(src, '_blank');
  }
}

/**
 * 全局委托绑定：面板初始化时调用一次。
 * 任何带 data-preview 的 img（或其包裹容器）悬浮停留即弹出预览；重渲染后无需重新绑定。
 */
export function initImagePreview(): void {
  document.addEventListener('mouseover', (e) => {
    const t = e.target as HTMLElement;
    if (layer && layer.contains(t)) return; // 在预览层内（允许缩放/平移）
    const host = t.closest?.('[data-preview]');
    if (host) {
      const img = host instanceof HTMLImageElement ? host : host.querySelector('img');
      const src = img?.src ?? '';
      if (!src) {
        clearHoverTimer();
        return;
      }
      // 同一元素内部移动（如 wrapper 下 img 补渲染）→ 保持原定时器，不重启
      if (host === lastHost && hoverTimer) return;
      schedulePreview(host as HTMLElement, src);
      return;
    }
    // 移到了非预览区域 → 取消待弹出的定时器并关闭已弹出的预览
    clearHoverTimer();
    lastHost = null;
    hidePreview();
  });
  // 移出浏览器窗口 → 取消定时器并关闭
  document.addEventListener('mouseout', (e) => {
    if (!(e as MouseEvent).relatedTarget) {
      clearHoverTimer();
      hidePreview();
    }
  });
  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearHoverTimer();
      hidePreview();
    }
  });
}
