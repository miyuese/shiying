/**
 * 换脸 Tab
 * 源图 + 人物卡 → 换脸
 * 暗房：编号化区块 + 取景框结果 + Lucide 图标
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { renderImageSelector } from '../components/imageSelector';
import { modelBoxHtml } from '../components/modelBox';
import { qualitySelectHtml, currentQuality, bindQualitySelect } from '../components/qualitySelector';
import { renderInlineProgress } from '../components/taskProgress';
import { iconSvg } from '../../shared/icons';
import type { Task } from '../../shared/types';

const SWAP_BTN = () => `${iconSvg('user-round', { size: 14, className: 'lucide' })} 换脸`;

/** 本页轮询中的任务：id + 最近一次快照。视图因广播重渲染后据此恢复内联进度 */
let pollingTaskId: string | null = null;
let lastTaskSnapshot: Task | null = null;

export function renderFaceswapView(container: HTMLElement): void {
  const s = getState();

  container.innerHTML = `
    <div style="padding-top:4px;">
      <section class="work-section">
        <div class="section-head">
          <span class="section-num">01</span>
          <p class="section-label" style="margin:0;">源图 · 作为底图</p>
        </div>
        <div id="img-selector"></div>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">02</span>
          <p class="section-label" style="margin:0;">人物卡 · 要换进去的脸</p>
          <span class="link" id="btn-to-cards" style="font-size:11px;margin-left:auto;">管理人物卡 →</span>
        </div>
        <div id="card-selector"></div>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">03</span>
          <p class="section-label" style="margin:0;">生成</p>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <select class="select" id="sel-aspect" style="flex:1;">
            <option value="1:1">画幅 1:1</option>
            <option value="3:4" selected>画幅 3:4</option>
            <option value="4:3">画幅 4:3</option>
            <option value="9:16">画幅 9:16</option>
          </select>
          ${qualitySelectHtml()}
        </div>
        <div style="margin-bottom:12px;">${modelBoxHtml(s.settings?.generateApi.model)}</div>
        <button class="btn btn-primary btn-block" style="padding:13px;" id="btn-swap">${SWAP_BTN()}</button>
        <p style="font-size:11px;color:var(--ink-3);margin:8px 0 0;text-align:center;">换脸 = 源图场景姿态光线全保留，只替换面部身份</p>
        <div id="swap-result" style="margin-top:16px;"></div>
      </section>
    </div>
  `;

  renderImageSelector(container.querySelector('#img-selector')!);
  renderFaceCardSelector(container.querySelector('#card-selector')!);
  bindQualitySelect(container);

  container.querySelector('#btn-to-cards')!.addEventListener('click', () => {
    setState({ tab: 'personCard' });
  });

  container.querySelector('#btn-swap')!.addEventListener('click', async () => {
    const state = getState();
    if (!state.selectedImage) {
      toast('请先选择源图');
      return;
    }
    if (!state.selectedCardId) {
      toast('请选择一张人物卡');
      return;
    }
    const aspect = (container.querySelector('#sel-aspect') as HTMLSelectElement).value;
    const quality = currentQuality();
    const btn = container.querySelector('#btn-swap') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '换脸中…';
    try {
      const card = await send<{ dataUrl: string }>('person-card-get', { id: state.selectedCardId });
      // 换脸模板（FACESWAP_PROMPT_TEMPLATE）自足，不需要反推 API
      const { taskId } = await send<{ taskId: string }>('generate-image', {
        prompt: '',
        intent: 'faceswap',
        sourceRef: state.selectedImage,
        faceRef: card.dataUrl,
        aspectRatio: aspect,
        quality,
      });
      // 立即在本页渲染「排队中」卡片，让用户马上看到任务已启动
      pollingTaskId = taskId;
      lastTaskSnapshot = { id: taskId, type: 'faceswap', status: 'pending' } as Task;
      const box = document.querySelector<HTMLElement>('#swap-result');
      if (box) renderInlineProgress(box, lastTaskSnapshot);
      toast('换脸任务已提交');
      void pollSwapTask(taskId);
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.innerHTML = SWAP_BTN();
    }
  });

  // 视图重建后恢复内联进度（activeTask 广播触发重渲染；优先还原正在轮询的任务）
  const resultBox = container.querySelector<HTMLElement>('#swap-result');
  if (resultBox) {
    const active = getState().activeTask;
    const snap = active && active.id === pollingTaskId ? active : lastTaskSnapshot;
    if (snap) renderInlineProgress(resultBox, snap);
  }
}

/** 换脸专用人物卡选择（单卡点击切换） */
function renderFaceCardSelector(container: HTMLElement): void {
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
          <p style="font-size:10px;color:var(--ink-3);margin:0;">${c.sourceCount} 张源图</p>
        </div>
        ${c.isDefault ? '<span class="pill pill-blue">默认</span>' : ''}
      </div>
    `
    )
    .join('');

  container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    el.addEventListener('click', () => {
      setState({ selectedCardId: el.dataset.cardId! });
      renderFaceCardSelector(container);
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

function pollSwapTask(taskId: string): void {
  let tries = 0;
  const startedAt = Date.now();
  const iv = setInterval(async () => {
    tries++;
    try {
      const task = await send<Task>('task-status', { taskId });
      lastTaskSnapshot = task;
      const box = document.querySelector<HTMLElement>('#swap-result');
      // 前端真实时钟兜底：超过截止时间强制失败（不依赖 SW 计时器，前端永不休眠）
      if (task.status === 'running' || task.status === 'pending') {
        const deadline = task.deadline ?? startedAt + 420_000;
        if (Date.now() > deadline) {
          clearInterval(iv);
          await send('task-force-fail', { taskId }).catch(() => {});
          const panel = (await import('../index')).panelApi;
          await panel.refreshTasks();
          const btn = document.querySelector('#btn-swap') as HTMLButtonElement;
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = SWAP_BTN();
          }
          const failed = { ...task, status: 'failed', error: '换脸生成超时（超过 7 分钟），请重试' } as Task;
          lastTaskSnapshot = failed;
          if (box) renderInlineProgress(box, failed);
          toast('换脸生成超时（超过 7 分钟），请重试');
          return;
        }
        if (box) renderInlineProgress(box, task);
      }
      if (task.status === 'done' && task.result?.blobKeys?.length) {
        clearInterval(iv);
        const panel = (await import('../index')).panelApi;
        await panel.refreshTasks();
        const btn = document.querySelector('#btn-swap') as HTMLButtonElement;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = SWAP_BTN();
        }
        // 展示结果图
        const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key: task.result.blobKeys[0]! });
        const box = document.querySelector<HTMLElement>('#swap-result');
        if (box) {
          box.innerHTML = `
            <div class="section-head">
              <span class="section-num">＋</span>
              <p class="section-label" style="margin:0;">换脸结果</p>
            </div>
            <div class="frame">
              <img src="${dataUrl}" alt="换脸结果">
              <span class="frame-mark">Face Swap</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-secondary" style="flex:1;font-size:12px;" id="swap-download">${iconSvg('download', { size: 14, className: 'lucide' })} 下载</button>
              <button class="btn btn-secondary" style="flex:1;font-size:12px;" id="swap-save">${iconSvg('bookmark-plus', { size: 14, className: 'lucide' })} 存入相册</button>
            </div>
          `;
          box.querySelector('#swap-download')!.addEventListener('click', () => {
            void send('download-file', { url: dataUrl, filename: `shiyin-faceswap-${taskId}.jpg` });
            toast('开始下载');
          });
          box.querySelector('#swap-save')!.addEventListener('click', () => {
            void send('album-add-generated', { dataUrl, prompt: '换脸结果', taskType: 'faceswap' }).catch(() => {});
            toast('已存入相册');
          });
        }
      } else if (task.status === 'failed') {
        clearInterval(iv);
        const panel = (await import('../index')).panelApi;
        await panel.refreshTasks();
        const box2 = document.querySelector<HTMLElement>('#swap-result');
        if (box2) renderInlineProgress(box2, task);
        toast(`换脸失败：${task.error ?? '未知原因'}`);
      } else if (task.status === 'cancelled') {
        clearInterval(iv);
        const box2 = document.querySelector<HTMLElement>('#swap-result');
        if (box2) renderInlineProgress(box2, task);
        toast('换脸已取消');
      }
    } catch {
      /* 忽略 */
    }
    if (tries > 120) clearInterval(iv);
  }, 3000);
}
