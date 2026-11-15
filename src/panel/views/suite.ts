/**
 * 拍一套 Tab
 * 参考图 + （可选）人物卡 → 按配比拆成「人像批 + 配图批」→ 合并为 4 张
 * 人像批：同一人多机位（带人脸参考）；配图批：穿搭 / 美食 / 环境特写（只带底图，不带人脸）
 * 后台串行发两次请求，每批出一张拼图，面板按张数切分后合并展示
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
import { suiteItemsFor, peekSuiteItems, type SuiteItem } from '../components/suiteResult';
import type { GeneratePayload, Task } from '../../shared/types';

/** 配比档位：人像张数（其余为配图张数） */
const MIX_OPTIONS: { portrait: number; label: string }[] = [
  { portrait: 4, label: '4 人像' },
  { portrait: 3, label: '3+1' },
  { portrait: 2, label: '2+2' },
  { portrait: 1, label: '1+3' },
  { portrait: 0, label: '4 配图' },
];

function mixLabel(portrait: number): string {
  const scene = 4 - portrait;
  if (scene === 0) return '4 张人像';
  if (portrait === 0) return '4 张配图';
  return `${portrait} 人像 + ${scene} 配图`;
}

function suiteBtnHtml(portrait: number): string {
  return `${iconSvg('layout-grid', { size: 14, className: 'lucide' })} 拍一套 · ${mixLabel(portrait)}`;
}

/** 本页轮询中的任务：id + 最近一次快照。视图因广播重渲染后据此恢复内联进度 */
let pollingTaskId: string | null = null;
let lastTaskSnapshot: Task | null = null;
/** 最近一次完成的套图任务：视图重渲染后据此恢复切好的成图（否则会被进度卡盖掉） */
let lastDoneTask: Task | null = null;

/** 渲染合并后的套图结果（人像在前、配图在后，逐张可放大 / 下载） */
function renderSheet(box: HTMLElement, items: SuiteItem[], taskId: string): void {
  const portraitCount = items.filter((it) => it.kind === 'portrait').length;
  const sceneCount = items.length - portraitCount;
  const mixText =
    sceneCount === 0 ? '4 张人像' : portraitCount === 0 ? '4 张配图' : `${portraitCount} 人像 + ${sceneCount} 配图`;
  box.innerHTML = `
    <div class="section-head">
      <span class="section-num">＋</span>
      <p class="section-label" style="margin:0;">套图已生成 · ${mixText}</p>
    </div>
    <div class="contact-sheet">
      ${items
        .map(
          (it, i) => `
          <div class="frame" style="aspect-ratio:3/4;">
            <img src="${it.url}" alt="套图 ${i + 1}" data-preview="1">
            <span class="frame-mark">${it.kind === 'portrait' ? '人像' : '配图'} ${String(i + 1).padStart(2, '0')}</span>
            <button class="icon-btn" data-dl="${i}" title="下载单图" style="position:absolute;top:6px;right:6px;background:rgba(8,8,11,.72);z-index:2;">${iconSvg('download', { size: 14, className: 'lucide' })}</button>
          </div>`
        )
        .join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn btn-secondary" style="flex:1;font-size:12px;" id="save-all">${iconSvg('bookmark-plus', { size: 14, className: 'lucide' })} 全部存入相册</button>
    </div>
  `;
  box.querySelectorAll<HTMLElement>('[data-dl]').forEach((dlBtn) => {
    dlBtn.addEventListener('click', () => {
      const i = Number(dlBtn.dataset.dl);
      void send('download-file', {
        url: items[i]!.url,
        filename: `shiyin-suite-${taskId}-${i}.jpg`,
      });
      toast('开始下载');
    });
  });
  box.querySelector('#save-all')!.addEventListener('click', () => {
    for (const it of items) {
      void send('album-add-generated', {
        dataUrl: it.url,
        prompt: it.kind === 'portrait' ? '拍一套 · 人像' : '拍一套 · 配图',
        taskType: 'suite',
      }).catch(() => {});
    }
    toast(`已存入相册（${items.length} 张）`);
  });
}

export function renderSuiteView(container: HTMLElement): void {
  const s = getState();
  const portrait = s.suitePortraitCount;
  const scene = 4 - portrait;

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
        <p class="micro" style="margin-top:8px;">只用于人像批；配图批不会带上这里的人物，避免静物里冒出人脸</p>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">03</span>
          <p class="section-label" style="margin:0;">配比</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${MIX_OPTIONS.map(
            (o) => `<button class="chip" data-mix="${o.portrait}" style="${
              o.portrait === portrait ? 'border-color:var(--border-blue);background:var(--blue-soft);color:var(--ink-1);' : ''
            }">${o.label}</button>`
          ).join('')}
        </div>
        <p class="micro" style="margin-top:8px;">${
          scene === 0
            ? '只出人像：同一场景的四个机位，一次生成'
            : portrait === 0
              ? '只出配图：穿搭、美食、环境特写，不出现人脸与文字'
              : `人像 ${portrait} 张 + 配图 ${scene} 张：先出人像、再出配图，共两次生成`
        }</p>
      </section>

      <section class="work-section">
        <div class="section-head">
          <span class="section-num">04</span>
          <p class="section-label" style="margin:0;">生成</p>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">
          <span style="font-size:12px;color:var(--ink-3);flex:1;">单张 3:4 竖图 · 拼图内部均分</span>
          ${qualitySelectHtml()}
        </div>
        <div style="margin-bottom:12px;">${modelBoxHtml(s.settings?.generateApi.model)}</div>
        <button class="btn btn-primary btn-block" style="padding:13px;" id="btn-suite">${suiteBtnHtml(portrait)}</button>
        <div id="suite-result" style="margin-top:16px;"></div>
      </section>
    </div>
  `;

  renderImageSelector(container.querySelector('#img-selector')!);
  renderFaceReferenceSelector(container.querySelector('#card-selector')!, { suiteMode: true });
  bindQualitySelect(container);

  // 配比切换：只改 state，视图随之重渲染（按钮文案、提示文案同步变）
  container.querySelectorAll<HTMLElement>('[data-mix]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Number(btn.dataset.mix);
      if (next === getState().suitePortraitCount) return;
      setState({ suitePortraitCount: next });
    });
  });

  container.querySelector('#btn-suite')!.addEventListener('click', async () => {
    const state = getState();
    if (!state.selectedImage) {
      toast('请先选择参考图');
      return;
    }
    const portraitCount = state.suitePortraitCount;
    const sceneCount = 4 - portraitCount;
    const quality = currentQuality();
    const btn = container.querySelector('#btn-suite') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = portraitCount > 0 && sceneCount > 0 ? '生成中（人像 → 配图）…' : '生成中…';
    try {
      const payload: GeneratePayload = {
        prompt: '',
        intent: 'suite',
        sourceRef: state.selectedImage,
        aspectRatio: '1:1', // 实际画幅由后台按每批张数覆盖
        quality,
        suiteMix: { portrait: portraitCount, scene: sceneCount },
      };
      // 只有需要人像时才取面部参考：配图批不传人脸，避免静物格里冒出那个人
      if (portraitCount > 0) {
        if (state.directFaceImages.length > 0) {
          payload.faceRefs = state.directFaceImages;
        } else if (state.suiteCardId) {
          const faceCard = state.personCards.find((c) => c.id === state.suiteCardId);
          if (faceCard) {
            const card = await send<{ dataUrl: string }>('person-card-get', { id: faceCard.id });
            payload.faceRef = card.dataUrl;
          }
        }
      }
      const { taskId } = await send<{ taskId: string }>('generate-image', payload);
      // 立即在本页渲染「排队中」卡片，让用户马上看到任务已启动
      pollingTaskId = taskId;
      lastDoneTask = null; // 新一轮生成开始，旧的成图不该再被重渲染恢复
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
          const btn2 = document.querySelector('#btn-suite') as HTMLButtonElement | null;
          if (btn2) {
            btn2.disabled = false;
            btn2.innerHTML = suiteBtnHtml(getState().suitePortraitCount);
          }
        },
        onDone: async (task) => {
          const items = await suiteItemsFor(task);
          if (items.length === 0) return;
          lastDoneTask = task;
          const suiteBox = document.querySelector<HTMLElement>('#suite-result');
          if (suiteBox) renderSheet(suiteBox, items, task.id);
          toast(`套图生成完成，共 ${items.length} 张`);
        },
      });
    } catch (e) {
      toast((e as Error).message);
      btn.disabled = false;
      btn.innerHTML = suiteBtnHtml(getState().suitePortraitCount);
    }
  });

  // 视图重建后恢复内联结果：已完成优先恢复切好的套图，其次恢复进度卡
  const resultBox = container.querySelector<HTMLElement>('#suite-result');
  if (resultBox) {
    const active = getState().activeTask;
    const doneTask = lastDoneTask;
    const cached = doneTask ? peekSuiteItems(doneTask.id) : null;
    if (doneTask && cached) {
      renderSheet(resultBox, cached, doneTask.id);
    } else if (doneTask) {
      void suiteItemsFor(doneTask).then((items) => {
        const box = document.querySelector<HTMLElement>('#suite-result');
        if (box && items.length > 0) renderSheet(box, items, doneTask.id);
      });
    } else {
      const snap = active && active.id === pollingTaskId ? active : lastTaskSnapshot;
      if (snap) renderInlineProgress(resultBox, snap);
    }
    // 重渲染会造出新的按钮，生成中要重新禁用，否则能重复点到
    if (active && active.type === 'suite' && (active.status === 'running' || active.status === 'pending')) {
      const btn = container.querySelector('#btn-suite') as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = true;
        btn.textContent = '生成中…';
      }
    }
  }
}
