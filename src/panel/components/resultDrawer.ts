/**
 * 生成结果抽屉（全局底部，默认收起）
 * - 收起时只占一条 ~40px 的窄条：缩略图 + 「生成结果 · 类型 · 时间」
 * - 点开才展开抽屉：大图预览 + 下载 / 存相册 / 再生成 / 送去拍一套
 * - 拍一套：按配比切回逐张（人像 + 配图）一起呈现，下载 / 存相册一次处理全部
 * - 只展示最近一次成功结果；失败原因不在工作台呈现（统一到设置页诊断区查看）
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { iconSvg } from '../../shared/icons';
import { timeAgo } from '../../shared/utils/text';
import { suiteItemsFor, suiteMixOf, suiteMixLabel, type SuiteItem } from './suiteResult';
import type { GenerateIntent, GeneratePayload, Task } from '../../shared/types';

/** 抽屉展开状态：会话内保留，视图重渲染不重置（用户点开就一直开着） */
let open = false;
/** 缩略图缓存：同一个 key 只取一次图，避免每次重渲染都读 IndexedDB */
let cachedKey = '';
let cachedUrl = '';

const TYPE_LABEL: Record<string, string> = {
  faceswap: '换脸',
  suite: '拍一套',
  personCard: '人物卡',
  redraw: '重绘',
  analyze: '反推',
};

export function renderResultDrawer(container: HTMLElement): void {
  const latest = getState().results.find((t) => t.status === 'done' && t.result?.blobKeys?.length);

  // 无成图 → 整条不渲染，绝不留空占位
  if (!latest) {
    container.innerHTML = '';
    container.classList.remove('has-result', 'open');
    open = false;
    return;
  }

  const isSuite = latest.type === 'suite';
  const mix = isSuite ? suiteMixOf(latest) : null;
  const isCustom = (latest.inputs as { intent?: string } | undefined)?.intent === 'custom';
  const label = isSuite && mix ? `拍一套 · ${suiteMixLabel(mix)}` : isCustom ? '自定义' : (TYPE_LABEL[latest.type] ?? '生成');
  const headTitle = isSuite ? '套图结果' : `${label}结果`;
  const title = `${label} · ${timeAgo(latest.createdAt)}`;
  const prompt = latest.result?.prompt?.trim() ?? '';
  /** 套图切分结果（异步填充；按钮点击时若还没好会 await 一次） */
  let suiteItems: SuiteItem[] | null = null;

  container.classList.add('has-result');
  container.classList.toggle('open', open);
  container.innerHTML = `
    <div class="dock-panel">
      <div class="dock-body${isSuite ? ' is-suite' : ''}">
        ${isSuite ? '<div class="dock-suite" id="dock-suite"></div>' : '<div class="frame dock-frame" id="dock-thumb"></div>'}
        <div style="flex:1;min-width:0;">
          <p style="font-size:13px;color:var(--ink-1);margin:0;font-weight:500;">${headTitle}${isSuite && mix ? `<span style="color:var(--ink-3);font-weight:400;"> · ${suiteMixLabel(mix)}</span>` : ''}</p>
          <p style="font-size:11px;color:var(--ink-3);margin:2px 0 0;">${timeAgo(latest.createdAt)}生成<span id="dock-count"></span></p>
          <p class="dock-prompt">${prompt ? escapeHtml(prompt) : '这次生成没有提示词'}</p>
        </div>
      </div>
      <div class="dock-actions">
        <button class="btn btn-secondary dock-act" data-act="regenerate">${iconSvg('refresh-cw', { size: 13, className: 'lucide' })} 再生成</button>
        <button class="btn btn-secondary dock-act" data-act="download">${iconSvg('download', { size: 13, className: 'lucide' })} 下载</button>
        <button class="btn btn-secondary dock-act" data-act="save">${iconSvg('bookmark-plus', { size: 13, className: 'lucide' })} 存相册</button>
        <button class="btn btn-secondary dock-act" data-act="suite">${iconSvg('layout-grid', { size: 13, className: 'lucide' })} 拍一套</button>
      </div>
    </div>
    <button class="dock-tab" id="dock-toggle" aria-expanded="${open ? 'true' : 'false'}">
      <span class="dock-tab-thumb" id="dock-tab-thumb">${iconSvg('image', { size: 13, className: 'lucide' })}</span>
      <span class="dock-tab-text">${open ? '收起生成结果' : `生成结果 · ${title}`}</span>
      <span class="dock-caret">${iconSvg('chevron-up', { size: 14, className: 'lucide' })}</span>
    </button>
  `;

  if (isSuite) {
    // 套图：切回逐张（人像在前、配图在后），4 张一起呈现
    void suiteItemsFor(latest)
      .then((items) => {
        if (!container.isConnected) return;
        suiteItems = items;
        const grid = container.querySelector<HTMLElement>('#dock-suite');
        if (grid) {
          grid.innerHTML = items
            .map(
              (it) => `
              <div class="frame">
                <img src="${it.url}" data-preview="1" alt="${it.kind === 'portrait' ? '人像' : '配图'}">
                <span class="frame-mark">${it.kind === 'portrait' ? '人像' : '配图'}</span>
              </div>`
            )
            .join('');
        }
        const count = container.querySelector<HTMLElement>('#dock-count');
        if (count) count.textContent = ` · 共 ${items.length} 张`;
        const small = container.querySelector<HTMLElement>('#dock-tab-thumb');
        if (small && items[0]) small.innerHTML = `<img src="${items[0].url}" alt="">`;
      })
      .catch(() => {
        /* 切分失败：保持占位，不影响下载 / 存相册外的其它操作 */
      });
  } else {
    // 单图：折叠条小图 + 抽屉大图共用一张 dataURL
    void ensureThumb(latest.result!.blobKeys[0]!).then((url) => {
      if (!url || !container.isConnected) return;
      const big = container.querySelector<HTMLElement>('#dock-thumb');
      if (big) big.innerHTML = `<img src="${url}" data-preview="1" alt="${label}结果">`;
      const small = container.querySelector<HTMLElement>('#dock-tab-thumb');
      if (small) small.innerHTML = `<img src="${url}" alt="">`;
    });
  }

  container.querySelector('#dock-toggle')!.addEventListener('click', () => {
    open = !open;
    container.classList.toggle('open', open);
    const tab = container.querySelector<HTMLElement>('#dock-toggle');
    const text = container.querySelector<HTMLElement>('.dock-tab-text');
    if (tab) tab.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (text) text.textContent = open ? '收起生成结果' : `生成结果 · ${title}`;
  });

  container.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!latest.result?.blobKeys?.length) return;
      const act = btn.dataset.act;
      try {
        // 再生成不需要成图，直接用原任务的配置 + 落盘输入图重新提交
        if (act === 'regenerate') {
          await regenerate(latest);
          return;
        }

        // 套图 → 全部切好的单张；其它 → 单张成图
        const results: SuiteItem[] = isSuite
          ? suiteItems ?? (await suiteItemsFor(latest))
          : [{ url: (await send<{ dataUrl: string }>('image-by-key', { key: latest.result.blobKeys[0]! })).dataUrl, kind: 'portrait' }];
        if (results.length === 0) return;

        if (act === 'download') {
          for (const [i, it] of results.entries()) {
            await send('download-file', {
              url: it.url,
              filename: `shiyin-${latest.type}-${latest.id}${results.length > 1 ? `-${i + 1}` : ''}.jpg`,
            });
          }
          toast(results.length > 1 ? `已开始下载 ${results.length} 张` : '已开始下载');
        } else if (act === 'save') {
          for (const it of results) {
            await send('album-add-generated', {
              dataUrl: it.url,
              prompt: latest.result?.prompt,
              model: latest.inputs.model,
              taskType: latest.type,
            });
          }
          toast(results.length > 1 ? `已存入相册（${results.length} 张）` : '已存入相册');
        } else if (act === 'suite') {
          // 成图接管「当前选中图」：拍一套页读 selectedImage，自然以成图为底图。
          // 套图取第一张（人像优先），避免把配图当底图。
          const typeLabel: Record<string, string> = {
            faceswap: '成图（换脸）',
            redraw: '成图（重绘）',
            suite: '成图（套图）',
            personCard: '成图（人物卡）',
            analyze: '成图（反推）',
          };
          setState({
            selectedImage: results[0]!.url,
            selectedImageMeta: { source: typeLabel[latest.type] ?? '成图' },
            suiteCardId: getState().selectedCardId,
            tab: 'suite',
          });
        }
      } catch (e) {
        toast((e as Error).message);
      }
    });
  });
}

/** 取缩略图 dataURL（带缓存；key 变了才重新读） */
async function ensureThumb(key: string): Promise<string> {
  if (cachedKey === key && cachedUrl) return cachedUrl;
  try {
    const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key });
    cachedKey = key;
    cachedUrl = dataUrl;
    return dataUrl;
  } catch {
    return '';
  }
}

/**
 * 再生成：用原任务相同的配置 + 输入图（落盘的 blob）重新生成一次。
 * 依赖后台 persistRegenInputs 在创建任务时把 dataURL 输入图落盘为 regen-src:/regen-face: blob。
 */
async function regenerate(task: Task): Promise<void> {
  if (task.type === 'personCard') {
    toast('人物卡暂不支持在这里再生成，请到人物卡页操作');
    return;
  }
  const inputs = (task.inputs ?? {}) as Partial<GeneratePayload>;
  if (!inputs.sourceBlobKey) {
    toast('源图已清理，无法再生成（重新选一张图即可）');
    return;
  }
  // 自定义模式的任务类型仍记为 redraw，但再生成要沿用原始意图，避免把用户原话套上重绘说明
  const intent: GenerateIntent =
    inputs.intent === 'custom'
      ? 'custom'
      : task.type === 'faceswap'
        ? 'faceswap'
        : task.type === 'suite'
          ? 'suite'
          : 'redraw';
  await send<{ taskId: string }>('generate-image', {
    prompt: inputs.prompt ?? task.result?.prompt ?? '',
    intent,
    sourceBlobKey: inputs.sourceBlobKey,
    faceBlobKey: inputs.faceBlobKey,
    faceBlobKeys: inputs.faceBlobKeys,
    aspectRatio: inputs.aspectRatio ?? '3:4',
    quality: inputs.quality,
    // 拍一套的配比要一起带上，否则再生成会退化成「4 张人像」
    suiteMix: inputs.suiteMix,
    keepSourceBlob: true,
  });
  toast('已重新生成，进度见底部任务条');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
