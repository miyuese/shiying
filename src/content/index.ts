/**
 * Content Script · 悬浮层
 * 借鉴 同类产品 的识别机制：
 * - pointermove + requestAnimationFrame 节流（比 mouseover 更稳，不丢事件）
 * - target.closest('img') 找不到时，用 document.elementsFromPoint() 穿透查找
 *   （很多网页图片被遮罩/覆盖层挡住，直接取 event.target 拿不到 img）
 * - 尺寸门槛 96px，取 currentSrc || src
 *
 * 自包含约束（重要）：manifest 声明的 content script 不是 ES module，不支持顶层 import，
 * 顶层 import 会让脚本整份加载失败（SyntaxError: Cannot use import statement outside a module）。
 * 因此本文件不 import 任何 shared 模块，图标数据直接内联（渲染与 shared/icons.ts 保持一致）。
 */

/** 本地图标注册表（Lucide iconNode 数据，仅悬浮层用到的 3 个） */
const CONTENT_ICONS: Record<string, Array<[string, Record<string, string>]>> = {
  aperture: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm14.31 8 5.74 9.94' }],
    ['path', { d: 'M9.69 8h11.48' }],
    ['path', { d: 'm7.38 12 5.74-9.94' }],
    ['path', { d: 'M9.69 16 3.95 6.06' }],
    ['path', { d: 'M14.31 16H2.83' }],
    ['path', { d: 'm16.62 12-5.74 9.94' }],
  ],
  plus: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'M12 5v14' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
};

/** iconNode → 内联 SVG 字符串（渲染参数与 shared/icons.ts 的 iconSvg 对齐，视觉一致） */
function iconSvg(name: string, opts: { size?: number; className?: string } = {}): string {
  const node = CONTENT_ICONS[name];
  if (!node) return '';
  const { size = 16, className } = opts;
  const root = [
    'xmlns="http://www.w3.org/2000/svg"',
    `width="${size}" height="${size}"`,
    'viewBox="0 0 24 24"',
    'fill="none" stroke="currentColor"',
    'stroke-width="1.75"',
    'stroke-linecap="round" stroke-linejoin="round"',
    className ? `class="${className}"` : '',
    'aria-hidden="true"',
  ]
    .filter(Boolean)
    .join(' ');
  const inner = node
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}></${tag}>`;
    })
    .join('');
  return `<svg ${root}>${inner}</svg>`;
}

const STYLE = `
:host { all: initial; }
.host {
  position: absolute;
  z-index: 2147483647;
  pointer-events: none;
}
.btn {
  pointer-events: auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease, background .18s ease, border-color .18s ease;
}
.btn:hover { transform: scale(1.12); box-shadow: 0 4px 18px -4px rgba(77,141,255,.55); }
.btn:active { transform: scale(.94); }
.btn-open {
  background: linear-gradient(135deg, #4d8dff 0%, #8b5cf6 100%);
  color: #fff;
  box-shadow: 0 2px 12px -4px rgba(77,141,255,.5);
}
.btn-open .ic { filter: drop-shadow(0 0 4px rgba(255,255,255,.35)); }
.btn-collect {
  background: rgba(16,16,22,.92);
  color: #a6a6b8;
  border: .5px solid rgba(255,255,255,.12);
  box-shadow: 0 2px 10px -4px rgba(0,0,0,.5);
}
.btn-collect:hover { color: #f2f2f7; }
.btn-collect.done {
  background: rgba(52,211,153,.14);
  color: #34d399;
  border-color: rgba(52,211,153,.4);
}
@media (prefers-reduced-motion: reduce) {
  .btn, .btn:hover { transform: none; transition: none; animation: none; }
}
`;

/** 我们自己的 UI 根选择器（用于排除自身） */
const UI_ROOT_SELECTOR = 'shiyin-ui-root';

/** 当前悬停的图片 */
let hoverImage: HTMLImageElement | null = null;

/** 最近一次指针位置 */
let hoverPointer: { clientX: number; clientY: number } | null = null;
let hoverPointerEvent: PointerEvent | null = null;
let hoverPointerFrame: number | null = null;

let overlayHost: HTMLElement | null = null;
let overlayRoot: ShadowRoot | null = null;
let lastImageUrl = '';
let hoverDebounceTimer: number | null = null;

/* ---------------- 浮层创建 ---------------- */

function ensureOverlay(): { host: HTMLElement; root: ShadowRoot } {
  if (overlayHost && overlayRoot) return { host: overlayHost, root: overlayRoot };

  const host = document.createElement('div');
  host.setAttribute('data-shiyin-ignore', '');
  host.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLE;
  root.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'host';
  wrap.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;flex-direction:column;gap:6px;';
  root.appendChild(wrap);

  // 打开拾影
  const openBtn = document.createElement('button');
  openBtn.className = 'btn btn-open';
  openBtn.title = '打开拾影';
  openBtn.setAttribute('aria-label', '打开拾影');
  openBtn.innerHTML = iconSvg('aperture', { size: 15, className: 'ic' });
  openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoverImage) void openShiYing(hoverImage);
  });
  wrap.appendChild(openBtn);

  // 收集
  const collectBtn = document.createElement('button');
  collectBtn.className = 'btn btn-collect';
  collectBtn.title = '收集到相册';
  collectBtn.setAttribute('aria-label', '收集到相册');
  collectBtn.innerHTML = iconSvg('plus', { size: 15, className: 'ic' });
  collectBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hoverImage) void collect(hoverImage, collectBtn);
  });
  wrap.appendChild(collectBtn);

  document.body.appendChild(host);
  overlayHost = host;
  overlayRoot = root;
  return { host, root };
}

function hideOverlay(): void {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
    overlayRoot = null;
  }
  hoverImage = null;
}

function positionOverlay(img: HTMLImageElement): void {
  const { host } = ensureOverlay();
  const rect = img.getBoundingClientRect();
  if (rect.width < 96 || rect.height < 96 || rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
    host.style.display = 'none';
    return;
  }
  host.style.display = 'block';
  host.style.top = `${rect.top + window.scrollY}px`;
  host.style.left = `${rect.left + window.scrollX}px`;
  host.style.width = `${rect.width}px`;
  host.style.height = `${rect.height}px`;
}

/* ---------------- 图片识别（同类产品 机制） ---------------- */

function findEligibleImage(startNode: Element | null): HTMLImageElement | null {
  if (!startNode) return null;
  const image = startNode.closest('img');
  if (!image) return null;
  if (image.closest('[data-shiyin-ignore]')) return null;
  const rect = image.getBoundingClientRect();
  const src = image.currentSrc || image.src;
  if (!src || src.startsWith('data:') || rect.width < 96 || rect.height < 96) return null;
  return image;
}

/** 从指针位置解析可用的图片：先看 target，再穿透 elementsFromPoint */
function resolveEligibleImageFromPointer(event: PointerEvent): HTMLImageElement | null {
  if (!(event.target instanceof Element)) return null;

  const targetImage = findEligibleImage(event.target);
  if (targetImage) return targetImage;

  if (typeof document.elementsFromPoint !== 'function') return null;
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;

  for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
    if (!(element instanceof Element)) continue;
    if (element === overlayHost || element.closest('[data-shiyin-ignore]')) continue;
    const image = findEligibleImage(element);
    if (image) return image;
  }

  return null;
}

/** 根据最近指针位置重新解析（用于定位浮层时） */
function resolveHoverImageFromPointer(): HTMLImageElement | null {
  if (!hoverPointer || typeof document.elementsFromPoint !== 'function') return null;
  for (const element of document.elementsFromPoint(hoverPointer.clientX, hoverPointer.clientY)) {
    if (!(element instanceof Element)) continue;
    if (element === overlayHost || element.closest('[data-shiyin-ignore]')) continue;
    const image = findEligibleImage(element);
    if (image) return image;
  }
  return null;
}

/* ---------------- 事件处理（同类产品：pointermove + rAF 节流） ---------------- */

function handlePointerMove(event: PointerEvent): void {
  hoverPointerEvent = {
    target: event.target,
    clientX: event.clientX,
    clientY: event.clientY,
  } as unknown as PointerEvent;

  if (hoverPointerFrame) return;

  const frame = requestAnimationFrame(() => {
    if (hoverPointerFrame !== frame) return;
    hoverPointerFrame = null;
    const latest = hoverPointerEvent;
    hoverPointerEvent = null;
    if (latest) processPointerMove(latest);
  });
  hoverPointerFrame = frame;
}

function processPointerMove(event: PointerEvent): void {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
  hoverPointer = { clientX: event.clientX, clientY: event.clientY };

  const image = resolveEligibleImageFromPointer(event);
  if (!image) {
    // 没找到图 → 延迟隐藏（避免划过图片间隙时闪烁）
    if (hoverDebounceTimer) window.clearTimeout(hoverDebounceTimer);
    hoverDebounceTimer = window.setTimeout(() => {
      if (hoverImage && !hoverImage.matches(':hover')) hideOverlay();
    }, 120);
    return;
  }

  if (hoverDebounceTimer) {
    window.clearTimeout(hoverDebounceTimer);
    hoverDebounceTimer = null;
  }

  hoverImage = image;
  lastImageUrl = image.currentSrc || image.src;
  positionOverlay(image);
}

function handleDocumentScroll(): void {
  if (hoverImage && hoverImage.isConnected) {
    positionOverlay(hoverImage);
  } else {
    hideOverlay();
  }
}

function handleWindowResize(): void {
  if (hoverImage && hoverImage.isConnected) {
    positionOverlay(hoverImage);
  }
}

/* ---------------- 动作 ---------------- */

async function openShiYing(img: HTMLImageElement): Promise<void> {
  const src = img.currentSrc || img.src;
  // 图片转 dataURL 存后台，panel 启动后读取
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'image-from-url',
      payload: { url: src },
    });
    if (r?.ok && r.data?.dataUrl) {
      await chrome.runtime.sendMessage({
        type: 'set-pending-image',
        payload: { dataUrl: r.data.dataUrl, pageUrl: location.href },
      });
    } else {
      showToast(r?.error ?? '图片获取失败，试试截图或下载后上传');
    }
  } catch {
    /* 图片抓取失败不阻塞打开，但给出提示 */
    showToast('图片获取失败，试试截图或下载后上传');
  }
  // 打开面板：background 内部先试 sidePanel，失败自动兜底独立窗口
  await chrome.runtime.sendMessage({ type: 'open-panel' });
}

async function collect(img: HTMLImageElement, btn: HTMLButtonElement): Promise<void> {
  const src = img.currentSrc || img.src;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'image-collect',
      payload: { imageUrl: src, pageUrl: location.href, alt: img.alt },
    });
    if (res?.ok) {
      btn.classList.add('done');
      btn.innerHTML = iconSvg('check', { size: 15, className: 'ic' });
      showToast(res.data.duplicate ? '已在相册中' : '已存入相册');
    } else {
      showToast(res?.error ?? '收集失败');
    }
  } catch {
    showToast('收集失败');
  }
}

function showToast(text: string): void {
  const host = document.createElement('div');
  host.setAttribute('data-shiyin-ignore', '');
  host.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
  .t {
    background: rgba(8,8,11,.92); border: .5px solid rgba(255,255,255,.14);
    border-left: 2px solid #4d8dff; color: #f2f2f7; padding: 10px 18px;
    border-radius: 8px; font-size: 12px;
    font-family: -apple-system,'PingFang SC',sans-serif;
    box-shadow: 0 8px 24px -8px rgba(0,0,0,.6), 0 0 20px -8px rgba(77,141,255,.35);
    animation: in .22s cubic-bezier(.22,1,.36,1);
  }
  @keyframes in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @media (prefers-reduced-motion: reduce) { .t { animation: none; } }
  `;
  root.appendChild(style);
  const el = document.createElement('div');
  el.className = 't';
  el.textContent = text;
  root.appendChild(el);
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 2200);
}

/* ---------------- 初始化 ---------------- */

function init(): void {
  // 同类产品 方式：pointermove + capture，rAF 节流
  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('scroll', handleDocumentScroll, true);
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('beforeunload', hideOverlay);

  // 兜底：如果页面是扩展页 / 浏览器内页，不启用
  if (location.protocol === 'chrome-extension:') return;
}

// 供 popup 查询最近悬停图片
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'shiyin-get-last-image') {
    sendResponse({ imageUrl: lastImageUrl });
  }
});

init();
