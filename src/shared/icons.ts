/**
 * 拾影 ShiYing · Lucide 图标（统一图标体系，界面禁用 emoji）
 * - 具名导入子集（tree-shake，绝不引入全量 icons map）
 * - iconNode 是纯数据数组，这里零 DOM 依赖地序列化为内联 SVG 字符串
 *   （content 脚本运行在页面上下文，同样可用）
 */

import {
  AlertTriangle,
  Aperture,
  ArrowRight,
  BookmarkPlus,
  Check,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Clock,
  Copy,
  Download,
  Film,
  GalleryHorizontal,
  Hourglass,
  Image,
  Images,
  Info,
  LayoutGrid,
  Loader2,
  Menu,
  Plus,
  PenLine,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
  WandSparkles,
  X,
  type IconNode,
} from 'lucide';

/**
 * kebab 名 → iconNode 子集注册表。
 * 键名与模板里 `<i data-lucide="...">` 的值严格一致。
 */
export const ICONS: Record<string, IconNode> = {
  'alert-triangle': AlertTriangle,
  aperture: Aperture,
  'arrow-right': ArrowRight,
  'bookmark-plus': BookmarkPlus,
  check: Check,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'pen-line': PenLine,
  'circle-check': CircleCheck,
  clock: Clock,
  copy: Copy,
  download: Download,
  film: Film,
  'gallery-horizontal': GalleryHorizontal,
  hourglass: Hourglass,
  image: Image,
  images: Images,
  info: Info,
  'layout-grid': LayoutGrid,
  'loader-2': Loader2,
  menu: Menu,
  plus: Plus,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  'scan-line': ScanLine,
  settings: Settings,
  'sliders-horizontal': SlidersHorizontal,
  sparkles: Sparkles,
  star: Star,
  'trash-2': Trash2,
  upload: Upload,
  'user-round': UserRound,
  'wand-sparkles': WandSparkles,
  x: X,
};

export interface IconSvgOptions {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/** iconNode → 内联 SVG 字符串（统一描边风格：round cap/join、currentColor） */
export function iconSvg(name: string, opts: IconSvgOptions = {}): string {
  const node = ICONS[name];
  if (!node) {
    if (typeof console !== 'undefined') console.warn(`[shiyin] 未注册的图标: ${name}`);
    return '';
  }
  const { size = 16, strokeWidth = 1.75, className } = opts;
  const root = [
    'xmlns="http://www.w3.org/2000/svg"',
    `width="${size}" height="${size}"`,
    'viewBox="0 0 24 24"',
    'fill="none" stroke="currentColor"',
    `stroke-width="${strokeWidth}"`,
    'stroke-linecap="round" stroke-linejoin="round"',
    className ? `class="${className}"` : '',
    'aria-hidden="true"',
  ]
    .filter(Boolean)
    .join(' ');
  const inner = node
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => (v == null ? '' : `${k}="${v}"`))
        .join(' ');
      return `<${tag} ${attrStr}></${tag}>`;
    })
    .join('');
  return `<svg ${root}>${inner}</svg>`;
}

/**
 * 把 root 内所有 `<i data-lucide="...">` 占位替换为内联 SVG（幂等）。
 * 占位符替换成 `<svg>` 后自然消失，重复调用无副作用。
 */
export function hydrateIcons(root: ParentNode = document): void {
  if (!root) return;
  root.querySelectorAll('i[data-lucide]').forEach((el) => {
    const name = (el as HTMLElement).dataset.lucide;
    if (!name) return;
    const size = Number((el as HTMLElement).dataset.size) || 16;
    const html = iconSvg(name, { size, className: 'lucide' });
    if (html) el.outerHTML = html;
  });
}
