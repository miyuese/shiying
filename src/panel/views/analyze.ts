/**
 * 反推重绘 Tab（核心功能）
 * 选图 → 反推 → 编辑提示词 → 选人物卡 → 生成
 *
 * 稳定性：受控输入 —— 编辑中不再逐键 setState（避免每次按键触发全量重建的失焦/闪动），
 * 只同步本地 livePrompt + 字数，blur 时一次性回写 state。
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { renderImageSelector } from '../components/imageSelector';
import { renderFaceReferenceSelector } from '../components/faceReferenceSelector';
import { modelBoxHtml } from '../components/modelBox';
import { qualitySelectHtml, currentQuality, bindQualitySelect } from '../components/qualitySelector';
import { renderInlineProgress } from '../components/taskProgress';
import { pollTaskUntilSettled } from '../poll';
import { iconSvg } from '../../shared/icons';
import { blurImageDataUrl } from '../../shared/utils/image';
import { DEFAULT_PROFILE_ID, ASPECT_OPTIONS } from '../../shared/constants';
import type { GeneratePayload, ProfileId, Task } from '../../shared/types';

/** 编辑中的反推文本（受控输入缓冲，未 blur 前不写入 state） */
let livePrompt: string | null = null;

/** 本页轮询中的任务：id + 最近一次快照。视图因广播重渲染后据此恢复内联进度，避免闪烁 */
let pollingTaskId: string | null = null;
let lastTaskSnapshot: Task | null = null;

/** 高斯模糊结果缓存（同一张图 + 同一强度只算一次） */
let blurCache: { src: string; amount: number; result: string } | null = null;

async function getBlurred(src: string, amount: number): Promise<string> {
  if (amount <= 0) return src;
  if (blurCache && blurCache.src === src && blurCache.amount === amount) return blurCache.result;
  const result = await blurImageDataUrl(src, amount);
  blurCache = { src, amount, result };
  return result;
}

export function renderAnalyzeView(container: HTMLElement): void {
  const s = getState();
  const promptValue = livePrompt ?? s.reversePrompt;

  container.innerHTML = `
    <div style="padding-top:4px;">
      <section class="work-section">
        <div class="section-head">
          <span class="section-num">01</span>
          <p class="section-label" style="margin:0;">构图参考图</p>
        </div>
        <div id="img-selector"></div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:10px;">
          <span class="micro" style="flex-shrink:0;">高斯模糊</span>
          <input type="range" id="blur-range" min="0" max="100" step="5" value="${s.blurAmount}" style="flex:1;accent-color:var(--blue-text);">
          <span class="num" id="blur-label" style="font-size:12px;width:38px;text-align:right;flex-shrink:0;">${s.blurAmount}%</span>
        </div>
        <p class="micro" id="blur-hint" style="margin-top:6px;">${
          s.blurAmount > 0
            ? '生成时以模糊图作构图参考，人脸身份只来自人物卡；反推提示词仍用原图'
            : '把源图人脸模糊掉，可强制生成时身份不照抄源图、只跟随人物卡'
        }</p>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">02</span>
          <p class="section-label" style="margin:0;">反推提示词</p>
          <button class="btn btn-secondary" style="margin-left:auto;padding:6px 14px;font-size:var(--fs-xs);" id="btn-reverse">
            ${iconSvg('wand-sparkles', { size: 14, className: 'lucide' })} 反推
          </button>
        </div>
        <div class="card" style="padding:12px;">
          <textarea class="textarea" id="prompt-box" placeholder="选一张图片后点击「反推提示词」，结果会显示在这里，可自由编辑…" ${
            promptValue ? '' : 'disabled'
          }>${promptValue}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;">
            <span class="micro" id="prompt-count">${promptValue ? Array.from(promptValue).length + ' 字' : ''}</span>
            <button class="link" id="btn-copy" ${promptValue ? '' : 'disabled'}>复制</button>
          </div>
        </div>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">03</span>
          <p class="section-label" style="margin:0;">面部参考 · 人物卡或直接照片</p>
        </div>
        <div id="card-selector"></div>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">04</span>
          <p class="section-label" style="margin:0;">生成</p>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <select class="select" id="sel-aspect" style="flex:1;">
            ${ASPECT_OPTIONS.map((a) => `<option value="${a}" ${a === (s.settings?.defaultAspect ?? '3:4') ? 'selected' : ''}>画幅 ${a}</option>`).join('')}
          </select>
          ${qualitySelectHtml()}
        </div>
        <div style="margin-bottom:12px;">${modelBoxHtml(s.settings?.generateApi.model)}</div>
        <button class="btn btn-primary btn-block" style="padding:13px;" id="btn-generate" ${promptValue ? '' : 'disabled'}>
          ${iconSvg('sparkles', { size: 15, className: 'lucide' })} 生成新图
        </button>
        <div id="analyze-result" style="margin-top:16px;"></div>
      </section>
    </div>
  `;

  renderImageSelector(container.querySelector('#img-selector')!, {
    previewSrc: s.blurredImage ?? null,
    blurAmount: s.blurAmount,
  });
  renderFaceReferenceSelector(container.querySelector('#card-selector')!);
  bindQualitySelect(container);

  // 高斯模糊滑动条：拖动时只更新本地预览（不 setState，避免拖拽中断）；松手时提交
  const blurRange = container.querySelector('#blur-range') as HTMLInputElement;
  const blurLabel = container.querySelector('#blur-label') as HTMLElement;
  const blurHint = container.querySelector('#blur-hint') as HTMLElement;
  let blurTimer: number | null = null;
  blurRange.addEventListener('input', () => {
    const v = Number(blurRange.value);
    blurLabel.textContent = `${v}%`;
    blurHint.textContent =
      v > 0
        ? '生成时以模糊图作构图参考，人脸身份只来自人物卡；反推提示词仍用原图'
        : '把源图人脸模糊掉，可强制生成时身份不照抄源图、只跟随人物卡';
    if (blurTimer) window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(async () => {
      const img = getState().selectedImage;
      if (!img) return;
      const src = await getBlurred(img, v);
      const sel = container.querySelector('#img-selector img');
      if (sel) (sel as HTMLImageElement).src = src;
    }, 180);
  });
  blurRange.addEventListener('change', async () => {
    const v = Number(blurRange.value);
    const img = getState().selectedImage;
    if (!img) {
      setState({ blurAmount: v, blurredImage: null });
      return;
    }
    // 有缓存直接同步，否则异步计算后回写
    if (blurCache && blurCache.src === img && blurCache.amount === v) {
      setState({ blurAmount: v, blurredImage: v > 0 ? blurCache.result : null });
    } else {
      setState({ blurAmount: v });
      const src = await getBlurred(img, v);
      const st = getState();
      if (st.blurAmount === v && st.selectedImage === img) {
        setState({ blurredImage: v > 0 ? src : null });
      }
    }
  });

  // 反推
  container.querySelector('#btn-reverse')!.addEventListener('click', async () => {
    const img = getState().selectedImage;
    if (!img) {
      toast('请先选择一张图片');
      return;
    }
    const btn = container.querySelector('#btn-reverse') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '反推中…（较慢，约 15~60 秒）';
    try {
      const profileId = (getState().settings?.reverseApi.profileId as ProfileId) ?? DEFAULT_PROFILE_ID;
      const res = await send<{ prompt: string; charCount: number }>('analyze-image', {
        imageDataUrl: img,
        profileId,
      });
      livePrompt = res.prompt; // 受控缓冲与新反推结果同步，防止旧编辑内容顶掉新结果
      setState({ reversePrompt: res.prompt });
      toast('反推完成');
      renderAnalyzeView(container);
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.innerHTML = `${iconSvg('wand-sparkles', { size: 14, className: 'lucide' })} 反推`;
    }
  });

  // 编辑（受控：只更新本地缓冲 + 字数，blur 才写回 state）
  const box = container.querySelector('#prompt-box') as HTMLTextAreaElement;
  box.addEventListener('input', (e) => {
    livePrompt = (e.target as HTMLTextAreaElement).value;
    const count = container.querySelector('#prompt-count');
    if (count) count.textContent = `${Array.from(livePrompt).length} 字`;
  });
  box.addEventListener('blur', () => {
    if (livePrompt !== null) setState({ reversePrompt: livePrompt });
  });

  // 复制
  container.querySelector('#btn-copy')!.addEventListener('click', async () => {
    const val = livePrompt ?? getState().reversePrompt;
    if (!val) return;
    await navigator.clipboard.writeText(val);
    toast('提示词已复制');
  });

  // 生成
  container.querySelector('#btn-generate')!.addEventListener('click', async () => {
    const state = getState();
    const prompt = livePrompt ?? state.reversePrompt;
    if (!prompt) {
      toast('请先反推或输入提示词');
      return;
    }
    if (!state.selectedImage) {
      toast('请先选择构图参考图');
      return;
    }
    if (!state.selectedCardId && state.directFaceImages.length === 0) {
      toast('请选择人物卡或上传面部参考照片');
      return;
    }
    const aspect = (container.querySelector('#sel-aspect') as HTMLSelectElement).value;
    const quality = currentQuality();

    const btn = container.querySelector('#btn-generate') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '生成中…';
    try {
      const payload: GeneratePayload = {
        prompt,
        intent: 'redraw',
        sourceRef: state.selectedImage,
        aspectRatio: aspect,
        quality,
      };
      // 高斯模糊 > 0：构图参考用模糊图（人脸弱化，身份只来自人物卡）；反推提示词仍来自原图
      if (state.blurAmount > 0) {
        payload.sourceRef = await getBlurred(state.selectedImage, state.blurAmount);
      }
      if (state.directFaceImages.length > 0) {
        payload.faceRefs = state.directFaceImages; // 直接上传照片（1~2 张）优先于人物卡
      } else {
        const card = await send<{ dataUrl: string }>('person-card-get', { id: state.selectedCardId });
        payload.faceRef = card.dataUrl;
      }
      const { taskId } = await send<{ taskId: string }>('generate-image', payload);
      // 立即在本页渲染「排队中」卡片，让用户马上看到任务已启动
      pollingTaskId = taskId;
      lastTaskSnapshot = { id: taskId, type: 'redraw', status: 'pending' } as Task;
      const resultBox = document.querySelector<HTMLElement>('#analyze-result');
      if (resultBox) renderInlineProgress(resultBox, lastTaskSnapshot);
      toast('生成任务已提交，正在生成…');
      void pollTaskUntilSettled(taskId, {
        resultSelector: '#analyze-result',
        label: '生成',
        onSnapshot: (t) => {
          lastTaskSnapshot = t;
        },
      });
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.innerHTML = `${iconSvg('sparkles', { size: 15, className: 'lucide' })} 生成新图`;
    }
  });

  // 视图重建后恢复内联进度（activeTask 广播触发重渲染；优先还原正在轮询的任务）
  const resultBox = container.querySelector<HTMLElement>('#analyze-result');
  if (resultBox) {
    const active = getState().activeTask;
    const snap = active && active.id === pollingTaskId ? active : lastTaskSnapshot;
    if (snap) renderInlineProgress(resultBox, snap);
  }
}
