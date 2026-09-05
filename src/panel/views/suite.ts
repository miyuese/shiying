/**
 * 拍一套 Tab
 * 参考图 + （可选）人物卡 → 生成 2×2 四宫格 → 本地切 4 张
 * 暗房：编号化区块 + contact-sheet 接触印 + Lucide 图标
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
import { splitPhotoSuiteGrid } from '../../shared/utils/image';
import type { GeneratePayload, Task } from '../../shared/types';

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
          <p class="section-label" style="margin:0;">面部参考（可选）</p>
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
  renderFaceReferenceSelector(container.querySelector('#card-selector')!, { suiteMode: true });
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
      // 面部参考（可选）：直接上传照片（1~2 张）优先；否则用拍一套页自己的卡片选择，不继承全局默认卡
      const payload: GeneratePayload = {
        prompt: '',
        intent: 'suite',
        sourceRef: state.selectedImage,
        aspectRatio: aspect,
        quality,
      };
      if (state.directFaceImages.length > 0) {
        payload.faceRefs = state.directFaceImages;
      } else if (state.suiteCardId) {
        const faceCard = state.personCards.find((c) => c.id === state.suiteCardId);
        if (faceCard) {
          const card = await send<{ dataUrl: string }>('person-card-get', { id: faceCard.id });
          payload.faceRef = card.dataUrl;
        }
      }
      const { taskId } = await send<{ taskId: string }>('generate-image', payload);
      // 立即在本页渲染「排队中」卡片，让用户马上看到任务已启动
      pollingTaskId = taskId;
      lastTaskSnapshot = { id: taskId, type: 'suite', status: 'pending' } as Task;
      const box = document.querySelector<HTMLElement>('#suite-result');
      if (box) renderInlineProgress(box, lastTaskSnapshot);
      toast('拍一套任务已提交');
      void pollTaskUntilSettled(taskId, {
        resultSelector: '#suite-result',
        label: '拍一套',
        onSnapshot: (t) => {
          lastTaskSnapshot = t;
        },
        resetButton: () => {
          const btn = document.querySelector('#btn-suite') as HTMLButtonElement | null;
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = SUITE_BTN();
          }
        },
        onDone: async (task) => {
          // 取大图 dataURL
          const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key: task.result!.blobKeys[0]! });
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
                      <img src="${q}" alt="四宫格 ${i + 1}" data-preview="1">
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
        },
      });
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
