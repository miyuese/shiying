/**
 * 结果区组件（全局底部）
 * 显示最近生成结果 + 操作（下载 / 存相册 / 复制 prompt / 送去拍一套）
 * 暗房：胶片条 layout + Lucide 图标
 */

import { getState, setState } from '../state';
import { send, toast } from '../ui';
import { iconSvg } from '../../shared/icons';
import { timeAgo } from '../../shared/utils/text';
import type { GenerateIntent, GeneratePayload, Task } from '../../shared/types';

export function renderResultBar(container: HTMLElement): void {
  const s = getState();
  const tasks = s.results.filter((t) => t.status === 'done' && t.result?.blobKeys?.length);

  if (tasks.length === 0) {
    container.innerHTML = `
      <p class="section-label" style="margin-bottom:0;">生成结果</p>
      <p style="font-size:12px;color:var(--ink-3);margin:0;">还没有生成结果，去上面完成一次生成吧</p>
    `;
    return;
  }

  const latest = tasks[0]!;
  const label = latest.type === 'faceswap' ? '换脸' : latest.type === 'suite' ? '拍一套' : latest.type === 'personCard' ? '人物卡' : '重绘';
  const statusText = latest.status === 'failed' ? '失败' : latest.status === 'running' ? '生成中' : '完成';

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <p class="section-label" style="margin:0;">生成结果 · ${timeAgo(latest.createdAt)}</p>
      <span class="pill ${latest.status === 'failed' ? 'pill-red' : latest.status === 'running' ? 'pill-amber' : 'pill-green'}">${statusText}</span>
    </div>
    <div class="film-strip">
      <div id="result-thumb" class="strip-thumb"></div>
      <div class="strip-info">
        <p class="strip-title">${label}</p>
        <p class="strip-prompt">${latest.result?.prompt ? latest.result.prompt.slice(0, 30) + '…' : '无提示词'}</p>
      </div>
      <div class="strip-actions">
        <button class="icon-btn" data-act="regenerate" title="再生成">${iconSvg('refresh-cw', { size: 15, className: 'lucide' })}</button>
        <button class="icon-btn" data-act="download" title="下载">${iconSvg('download', { size: 15, className: 'lucide' })}</button>
        <button class="icon-btn" data-act="save" title="存相册">${iconSvg('bookmark-plus', { size: 15, className: 'lucide' })}</button>
        <button class="icon-btn" data-act="suite" title="送去拍一套">${iconSvg('layout-grid', { size: 15, className: 'lucide' })}</button>
      </div>
    </div>
  `;

  // 加载缩略图
  const thumb = container.querySelector('#result-thumb');
  if (thumb && latest.result?.blobKeys?.[0]) {
    void send<{ dataUrl: string }>('image-by-key', { key: latest.result.blobKeys[0] })
      .then((r) => {
        thumb.innerHTML = `<img src="${r.dataUrl}" style="width:100%;height:100%;object-fit:cover;">`;
      })
      .catch(() => {});
  }

  container.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (!latest.result?.blobKeys?.length) return;
      try {
        // 再生成不需要成图，用原任务相同的配置 + 输入图（落盘的 blob）重新提交一次
        if (act === 'regenerate') {
          await regenerate(latest);
          return;
        }
        // 其余操作需要先取成图 dataURL
        const key = latest.result.blobKeys[0]!;
        const { dataUrl } = await send<{ dataUrl: string }>('image-by-key', { key });
        if (act === 'download') {
          await send('download-file', {
            url: dataUrl,
            filename: `shiyin-${latest.type}-${latest.id}.jpg`,
          });
          toast('已开始下载');
        } else if (act === 'save') {
          await send('album-add-generated', {
            dataUrl,
            prompt: latest.result?.prompt,
            model: latest.inputs.model,
            taskType: latest.type,
          });
          toast('已存入相册');
        } else if (act === 'suite') {
          // 方案 A：成图接管「当前选中图」，拍一套页（读 selectedImage）自然以成图为底图
          const typeLabel: Record<string, string> = {
            faceswap: '成图（换脸）',
            redraw: '成图（重绘）',
            suite: '成图（四宫格）',
            personCard: '成图（人物卡）',
            analyze: '成图（反推）',
          };
          setState({
            selectedImage: dataUrl,
            selectedImageMeta: { source: typeLabel[latest.type] ?? '成图' },
            // 预选：换脸/重绘刚用过的卡此刻仍记录在全局 selectedCardId，直接带过去（无则空 = 不选）
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

/**
 * 再生成：用原任务相同的配置 + 输入图（落盘的 blob）重新生成一次。
 * 依赖后台 persistRegenInputs 在创建任务时把 dataURL 输入图落盘为 regen-src:/regen-face: blob，
 * task.inputs 里以 sourceBlobKey/faceBlobKey 引用；sourceRef/faceRef 已被剥掉。
 */
async function regenerate(task: Task): Promise<void> {
  if (task.type === 'personCard') {
    toast('人物卡暂不支持在结果栏再生成，请到人物卡页操作');
    return;
  }
  const inputs = (task.inputs ?? {}) as Partial<GeneratePayload>;
  if (!inputs.sourceBlobKey) {
    toast('源图已清理，无法再生成（重新选一张图即可）');
    return;
  }
  const intent: GenerateIntent = task.type === 'faceswap' ? 'faceswap' : task.type === 'suite' ? 'suite' : 'redraw';
  await send<{ taskId: string }>('generate-image', {
    prompt: inputs.prompt ?? task.result?.prompt ?? '',
    intent,
    sourceBlobKey: inputs.sourceBlobKey,
    faceBlobKey: inputs.faceBlobKey,
    aspectRatio: inputs.aspectRatio ?? '3:4',
    quality: inputs.quality,
    keepSourceBlob: true, // 源图是再生成资产，成功/失败都不删（由后台 GC 统一回收）
  });
  toast('已重新生成，进度见上方任务条');
}
