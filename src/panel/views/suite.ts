/**
 * 拍一套 Tab
 * 参考图 + （可选）人物卡 → 生成 2×2 四宫格 → 本地切 4 张
 * 暗房：编号化区块 + contact-sheet 接触印 + Lucide 图标
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { renderImageSelector } from '../components/imageSelector';
import { modelBoxHtml } from '../components/modelBox';
import { qualitySelectHtml, currentQuality, bindQualitySelect } from '../components/qualitySelector';
import { renderInlineProgress } from '../components/taskProgress';
import { iconSvg } from '../../shared/icons';
import { splitPhotoSuiteGrid } from '../../shared/utils/image';
import type { Task } from '../../shared/types';

const SUITE_BTN = () =>
  `${iconSvg('layout-grid', { size: 14, className: 'lucide' })} 拍一套 · 生成四宫格`;

/** 本页轮询中的任务：id + 最近一次快照。视图因广播重渲染后据此恢复内联进度 */
let pollingTaskId: string | null = null;
let lastTaskSnapshot: Task | null = null;

export function renderSuiteView(container: HTMLElement): void {
  const s = getState();

  container.innerHTML = `
    <div style="padding-top:4px;">
      <section class="work-section">
        <div class="section-head">
          <span class="section-num">01</span>
          <p class="section-label" style="margin:0;">参考图</p>
        </div>
        <div id="img-selector"></div>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">02</span>
          <p class="section-label" style="margin:0;">人物卡 · 面部参考（可选）</p>
        </div>
        <div id="card-selector"></div>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">03</span>
          <p class="section-label" style="margin:0;">生成</p>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">
          <span style="font-size:12px;color:var(--ink-3);flex:1;">画幅固定 1:1（四宫格 2×2 均分）</span>
          ${qualitySelectHtml()}
        </div>
        <div style="margin-bottom:12px;">${modelBoxHtml(s.settings?.generateApi.model)}</div>
        <button class="btn btn-primary btn-block" style="padding:13px;" id="btn-suite">${SUITE_BTN()}</button>
        <div id="suite-result" style="margin-top:16px;"></div>
      </section>
    </div>
  `;

  renderImageSelector(container.querySelector('#img-selector')!);
  renderSuiteCardSelector(container.querySelector('#card-selector')!);
  bindQualitySelect(container);

  container.querySelector('#btn-suite')!.addEventListener('click', async () => {
    const state = getState();
    if (!state.selectedImage) {
      toast('请先选择参考图');
      return;
    }
    const aspect = '1:1'; // 拍一套强制 1:1：四宫格由一张方图均分 2×2
    const quality = currentQuality();
    const btn = container.querySelector('#btn-suite') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '生成四宫格中…';
    try {
      // 取人物卡（可选，用拍一套页自己的选择，不继承全局默认卡）
      let faceRef: string | undefined;
      const faceCard = state.personCards.find((c) => c.id === state.suiteCardId);
      if (faceCard) {
        const card = await send<{ dataUrl: string }>('person-card-get', { id: faceCard.id });
        faceRef = card.dataUrl;
      }
      const { taskId } = await send<{ taskId: string }>('generate-image', {
        prompt: '',
        intent: 'suite',
        sourceRef: state.selectedImage,
        faceRef,
        aspectRatio: aspect,
        quality,
      });
      // 立即在本页渲染「排队中」卡片，让用户马上看到任务已启动
      pollingTaskId = taskId;
      lastTaskSnapshot = { id: taskId, type: 'suite', status: 'pending' } as Task;
      const box = document.querySelector<HTMLElement>('#suite-result');
      if (box) renderInlineProgress(box, lastTaskSnapshot);
      toast('拍一套任务已提交');
      void pollSuiteTask(taskId);
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.innerHTML = SUITE_BTN();
    }
  });

  // 视图重建后恢复内联进度（activeTask 广播触发重渲染；优先还原正在轮询的任务）
  const resultBox = container.querySelector<HTMLElement>('#suite-result');
  if (resultBox) {
    const active = getState().activeTask;
    const snap = active && active.id === pollingTaskId ? active : lastTaskSnapshot;
    if (snap) renderInlineProgress(resultBox, snap);
  }
}

function renderSuiteCardSelector(container: HTMLElement): void {
  const s = getState();
  const cards = s.personCards;
  if (cards.length === 0) {
    container.innerHTML = `
      <div class="card" style="padding:10px 14px;">
        <span style="font-size:12px;color:var(--ink-3);">没有人脸参考（可选，可不选直接生成）</span>
      </div>
    `;
    return;
  }
  const selected = s.suiteCardId;
  container.innerHTML = `
    <p class="micro" style="margin-bottom:8px;">${
      selected
        ? `已选 <strong class="num" style="color:var(--ink-1);">${cards.find((c) => c.id === selected)?.name ?? '人物卡'}</strong>，再点一下可取消`
        : '默认不选 · 点卡片选中，再点一下取消'
    }</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;">
      ${cards
        .map(
          (c) => `
          <div class="card card-hover" data-card-id="${c.id}" style="cursor:pointer;padding:5px;text-align:center;${
            c.id === selected ? 'border-color:var(--border-blue);background:var(--blue-soft);' : ''
          }">
            <div class="ratio-box" style="border-radius:6px;" data-card-thumb="${c.id}"></div>
            <div style="font-size:10px;color:${c.id === selected ? 'var(--ink-1)' : 'var(--ink-3)'};margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${c.id === selected ? iconSvg('check', { size: 11, className: 'lucide' }) + ' 已选' : c.name}
            </div>
          </div>
        `
        )
        .join('')}
    </div>
  `;
  container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    el.addEventListener('click', () => {
      const state = getState();
      setState({ suiteCardId: state.suiteCardId === el.dataset.cardId ? '' : el.dataset.cardId! });
      renderSuiteCardSelector(container);
    });
    const thumb = container.querySelector<HTMLElement>(`[data-card-thumb="${el.dataset.cardId}"]`);
    if (thumb) {
      void send<{ dataUrl: string }>('person-card-get', { id: el.dataset.cardId })
        .then((r) => {
          thumb.innerHTML = `<img src="${r.dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
        })
        .catch(() => {});
    }
  });
}

/** 轮询任务，完成后切图展示 */
function pollSuiteTask(taskId: string): void {
  let tries = 0;
  const startedAt = Date.now();
  const iv = setInterval(async () => {
    tries++;
    try {
      const task = await send<Task>('task-status', { taskId });
      lastTaskSnapshot = task;
      const box = document.querySelector<HTMLElement>('#suite-result');
      // 前端真实时钟兜底：超过截止时间强制失败（不依赖 SW 计时器，前端永不休眠）
      if (task.status === 'running' || task.status === 'pending') {
        const deadline = task.deadline ?? startedAt + 420_000;
        if (Date.now() > deadline) {
          clearInterval(iv);
          await send('task-force-fail', { taskId }).catch(() => {});
          const panel = (await import('../index')).panelApi;
          await panel.refreshTasks();
          const btn = document.querySelector('#btn-suite') as HTMLButtonElement;
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = SUITE_BTN();
          }
          const failed = { ...task, status: 'failed', error: '拍一套生成超时（超过 7 分钟），请重试' } as Task;
          lastTaskSnapshot = failed;
          if (box) renderInlineProgress(box, failed);
          toast('拍一套生成超时（超过 7 分钟），请重试');
          return;
        }
        if (box) renderInlineProgress(box, task);
      }
      if (task.status === 'done' && task.result?.blobKeys?.length) {
        clearInterval(iv);
        const panel = (await import('../index')).panelApi;
        await panel.refreshTasks();
        const btn = document.querySelector('#btn-suite') as HTMLButtonElement;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = SUITE_BTN();
        }
        // 取大图 dataURL
        const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key: task.result.blobKeys[0]! });
        // 本地切 4 格
        const quads = await splitPhotoSuiteGrid(dataUrl);
        const suiteBox = document.querySelector<HTMLElement>('#suite-result');
        if (suiteBox) {
          suiteBox.innerHTML = `
            <div class="section-head">
              <span class="section-num">＋</span>
              <p class="section-label" style="margin:0;">四宫格已切分 · 4 张单图</p>
            </div>
            <div class="contact-sheet">
              ${quads
                .map(
                  (q, i) => `
                  <div class="frame" style="aspect-ratio:1/1;">
                    <img src="${q}" alt="四宫格 ${i + 1}">
                    <span class="frame-mark">${String(i + 1).padStart(2, '0')}</span>
                    <button class="icon-btn" data-dl="${i}" title="下载单图" style="position:absolute;top:6px;right:6px;background:rgba(8,8,11,.72);z-index:2;">${iconSvg('download', { size: 14, className: 'lucide' })}</button>
                  </div>`
                )
                .join('')}
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-secondary" style="flex:1;font-size:12px;" id="save-all">${iconSvg('bookmark-plus', { size: 14, className: 'lucide' })} 全部存入相册</button>
            </div>
          `;
          suiteBox.querySelectorAll<HTMLElement>('[data-dl]').forEach((btn) => {
            btn.addEventListener('click', () => {
              void send('download-file', {
                url: quads[Number(btn.dataset.dl)]!,
                filename: `shiyin-suite-${taskId}-${btn.dataset.dl}.jpg`,
              });
              toast('开始下载');
            });
          });
          suiteBox.querySelector('#save-all')!.addEventListener('click', () => {
            for (const q of quads) {
              void send('album-add-generated', {
                dataUrl: q,
                prompt: '拍一套 · 切分单图',
                taskType: 'suite',
              }).catch(() => {});
            }
            toast('已存入相册');
          });
          // 切分图也挂到任务结果上
          toast('四宫格生成完成，已切分为 4 张');
        }
      } else if (task.status === 'failed') {
        clearInterval(iv);
        const panel = (await import('../index')).panelApi;
        await panel.refreshTasks();
        const btn = document.querySelector('#btn-suite') as HTMLButtonElement;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = SUITE_BTN();
        }
        const box2 = document.querySelector<HTMLElement>('#suite-result');
        if (box2) renderInlineProgress(box2, task);
        toast(`拍一套失败：${task.error ?? '未知原因'}`);
      } else if (task.status === 'cancelled') {
        clearInterval(iv);
        const btn = document.querySelector('#btn-suite') as HTMLButtonElement;
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = SUITE_BTN();
        }
        const box2 = document.querySelector<HTMLElement>('#suite-result');
        if (box2) renderInlineProgress(box2, task);
        toast('拍一套已取消');
      }
    } catch {
      /* 忽略 */
    }
    if (tries > 120) clearInterval(iv);
  }, 3000);
}
