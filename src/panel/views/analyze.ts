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
import { modelBoxHtml } from '../components/modelBox';
import { qualitySelectHtml, currentQuality, bindQualitySelect } from '../components/qualitySelector';
import { renderInlineProgress } from '../components/taskProgress';
import { iconSvg } from '../../shared/icons';
import { DEFAULT_PROFILE_ID, ASPECT_OPTIONS } from '../../shared/constants';
import type { ProfileId, Task } from '../../shared/types';

/** 编辑中的反推文本（受控输入缓冲，未 blur 前不写入 state） */
let livePrompt: string | null = null;

/** 本页轮询中的任务：id + 最近一次快照。视图因广播重渲染后据此恢复内联进度，避免闪烁 */
let pollingTaskId: string | null = null;
let lastTaskSnapshot: Task | null = null;

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
          <p class="section-label" style="margin:0;">人物卡 · 人脸参考</p>
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

  renderImageSelector(container.querySelector('#img-selector')!);
  renderCardSelector(container.querySelector('#card-selector')!);
  bindQualitySelect(container);

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
    if (!state.selectedCardId) {
      toast('请先选择一张人物卡作为人脸参考');
      return;
    }
    const aspect = (container.querySelector('#sel-aspect') as HTMLSelectElement).value;
    const quality = currentQuality();

    const btn = container.querySelector('#btn-generate') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '生成中…';
    try {
      // 取选中人物卡的人脸图作为 faceRef（纯反推已移除，人脸参考必选）
      const card = await send<{ dataUrl: string }>('person-card-get', { id: state.selectedCardId });
      const faceRef = card.dataUrl;
      const { taskId } = await send<{ taskId: string }>('generate-image', {
        prompt,
        intent: 'redraw',
        sourceRef: state.selectedImage,
        faceRef,
        aspectRatio: aspect,
        quality,
      });
      // 立即在本页渲染「排队中」卡片，让用户马上看到任务已启动
      pollingTaskId = taskId;
      lastTaskSnapshot = { id: taskId, type: 'redraw', status: 'pending' } as Task;
      const resultBox = document.querySelector<HTMLElement>('#analyze-result');
      if (resultBox) renderInlineProgress(resultBox, lastTaskSnapshot);
      toast('生成任务已提交，正在生成…');
      void pollTask(taskId);
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

/** 人物卡选择器：卡片列表（含人脸图），点击切换 */
function renderCardSelector(container: HTMLElement): void {
  const s = getState();
  const cards = s.personCards;
  if (cards.length === 0) {
    container.innerHTML = `
      <div class="card" style="padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:12px;color:var(--ink-3);">还没有人物卡</span>
        <button class="link" id="go-create-card">去创建 →</button>
      </div>
    `;
    container.querySelector('#go-create-card')!.addEventListener('click', () => {
      setState({ tab: 'personCard' });
    });
    return;
  }

  container.innerHTML = cards
    .map(
      (c) => `
      <div class="card card-hover" data-card-id="${c.id}" style="margin-bottom:6px;display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;${
        c.id === s.selectedCardId ? 'border-color:var(--border-blue);background:var(--blue-soft);' : ''
      }">
        <div class="face-thumb" style="width:36px;height:36px;" data-card-thumb="${c.id}"></div>
        <div style="flex:1;min-width:0;">
          <p style="font-size:12px;color:var(--ink-1);margin:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</p>
          <p style="font-size:10px;color:var(--ink-3);margin:0;">${c.sourceCount} 张源图${c.isDefault ? ' · 默认' : ''}</p>
        </div>
        ${c.isDefault ? '<span class="pill pill-blue">默认</span>' : ''}
      </div>
    `
    )
    .join('');

  container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    el.addEventListener('click', () => {
      setState({ selectedCardId: el.dataset.cardId! });
      renderCardSelector(container);
    });
    const thumb = container.querySelector<HTMLElement>(`[data-card-thumb="${el.dataset.cardId}"]`);
    if (thumb) {
      void send<{ dataUrl: string }>('person-card-get', { id: el.dataset.cardId })
        .then((r) => {
          thumb.innerHTML = `<img src="${r.dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        })
        .catch(() => {});
    }
  });
}

/** 轮询任务直到完成，并在本页 #analyze-result 内联渲染进度 */
function pollTask(taskId: string): void {
  let tries = 0;
  const startedAt = Date.now();
  const iv = setInterval(async () => {
    tries++;
    try {
      const task = await send<Task>('task-status', { taskId });
      lastTaskSnapshot = task;
      const box = document.querySelector<HTMLElement>('#analyze-result');
      // 前端真实时钟兜底：超过截止时间强制失败（不依赖 SW 计时器，前端永不休眠）
      if (task.status === 'running' || task.status === 'pending') {
        const deadline = task.deadline ?? startedAt + 420_000;
        if (Date.now() > deadline) {
          clearInterval(iv);
          await send('task-force-fail', { taskId }).catch(() => {});
          const panel = (await import('../index')).panelApi;
          await panel.refreshTasks();
          const failed = { ...task, status: 'failed', error: '生成超时（超过 7 分钟），请重试' } as Task;
          lastTaskSnapshot = failed;
          if (box) renderInlineProgress(box, failed);
          toast('生成超时（超过 7 分钟），请重试');
          return;
        }
        if (box) renderInlineProgress(box, task);
      }
      if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
        clearInterval(iv);
        if (box) renderInlineProgress(box, task);
        // 触发结果区刷新
        const panel = (await import('../index')).panelApi;
        await panel.refreshTasks();
        if (task.status === 'failed') toast('生成失败');
      }
    } catch {
      /* 忽略 */
    }
    if (tries > 120) clearInterval(iv);
  }, 3000);
}
