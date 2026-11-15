/**
 * 设置页入口
 */

import '../shared/fonts';
import { send, toast } from '../panel/ui';
import { iconSvg, hydrateIcons } from '../shared/icons';
import { setHtml } from '../shared/dom';
import type { Settings, PersonCard } from '../shared/types';
import { PROFILE_OPTIONS, ASPECT_OPTIONS, DEFAULT_SETTINGS } from '../shared/constants';
import { installErrorCapture } from '../background/store/errorLog';

// 全局错误捕获（options 端）
installErrorCapture('options');

const $ = (id: string): HTMLElement => document.getElementById(id)!;

async function init(): Promise<void> {
  let settings: Settings;
  try {
    settings = await send<Settings>('settings-get');
  } catch {
    settings = { ...DEFAULT_SETTINGS } as Settings;
  }

  // 反推方案下拉
  const profileSel = $('reverse-profile') as HTMLSelectElement;
  profileSel.innerHTML = PROFILE_OPTIONS.map(
    (p) => `<option value="${p.id}">${p.label} · ${p.desc}</option>`
  ).join('');

  // 填充表单
  ($('reverse-base') as HTMLInputElement).value = settings.reverseApi.baseUrl;
  ($('reverse-key') as HTMLInputElement).value = settings.reverseApi.apiKey;
  ($('reverse-model') as HTMLInputElement).value = settings.reverseApi.model;
  profileSel.value = settings.reverseApi.profileId;

  ($('generate-base') as HTMLInputElement).value = settings.generateApi.baseUrl;
  ($('generate-key') as HTMLInputElement).value = settings.generateApi.apiKey;
  ($('generate-model') as HTMLInputElement).value = settings.generateApi.model;

  const aspectSel = $('aspect-default') as HTMLSelectElement;
  aspectSel.innerHTML = ASPECT_OPTIONS.map(
    (a) => `<option value="${a}" ${a === settings.defaultAspect ? 'selected' : ''}>${a}</option>`
  ).join('');

  // 默认人物卡
  const cardSel = $('default-card') as HTMLSelectElement;
  let cards: PersonCard[] = [];
  try {
    cards = await send<PersonCard[]>('person-card-list');
  } catch {
    /* 忽略 */
  }
  cardSel.innerHTML =
    '<option value="">无（每次选择）</option>' +
    cards
      .map((c) => `<option value="${c.id}" ${c.id === settings.defaultPersonCardId ? 'selected' : ''}>${c.name}</option>`)
      .join('');

  // 首次引导
  renderGuide(!settings.onboarded);

  // 测试连接
  $('test-reverse').addEventListener('click', () => testConn('reverse'));
  $('test-generate').addEventListener('click', () => testConn('generate'));

  // 最近任务状态查看器
  const refreshTasks = async () => {
    const box = $('task-log');
    try {
      const tasks = await send<{ id: string; type: string; status: string; error?: string; statusText?: string; createdAt: number; progress?: number }[]>('task-list', { limit: 10 });
      if (tasks.length === 0) {
        setHtml(box, '<p style="color:var(--ink-3);">暂无任务</p>');
        return;
      }
      const label: Record<string, string> = { faceswap: '换脸', suite: '拍一套', personCard: '人物卡', redraw: '重绘' };
      const statusColor: Record<string, string> = { done: 'var(--green)', failed: 'var(--red)', running: 'var(--blue)', pending: 'var(--amber)', cancelled: 'var(--ink-3)' };
      setHtml(box, tasks
        .map(
          (t) =>
            `<div style="margin-bottom:6px;border-bottom:0.5px solid var(--hairline);padding-bottom:5px;">
              <div>
                <span style="color:${statusColor[t.status] ?? 'var(--ink-2)'};font-weight:600;">${label[t.type] ?? t.type} · ${t.status}${t.progress ? ' ' + t.progress + '%' : ''}</span>
              </div>
              ${t.error ? `<div style="color:var(--red);white-space:pre-wrap;">${escapeHtml(t.error)}</div>` : ''}
              ${t.statusText ? `<div style="color:var(--ink-2);">阶段：${escapeHtml(t.statusText)}</div>` : ''}
              <div style="color:var(--ink-3);font-size:9px;">${t.id} · ${new Date(t.createdAt).toLocaleString()}</div>
            </div>`
        )
        .join(''));
    } catch (err) {
      setHtml(box, `<p style="color:var(--red);">读取失败：${escapeHtml((err as Error).message)}</p>`);
    }
  };
  $('btn-refresh-tasks').addEventListener('click', () => void refreshTasks());
  $('btn-unlock-tasks').addEventListener('click', async () => {
    if (!confirm('把所有卡在「生成中」的任务直接判为失败？\n用于服务商已失败但一直不返回、导致人物卡提示 BUSY 的情况。')) return;
    try {
      const res = await send<{ unlocked: number }>('task-force-unlock');
      toast(res.unlocked > 0 ? `已解锁 ${res.unlocked} 条卡死任务` : '没有卡死的任务');
      await refreshTasks();
    } catch (e) {
      toast((e as Error).message);
    }
  });
  $('btn-clear-tasks').addEventListener('click', async () => {
    if (!confirm('清除全部历史任务？未存入相册的成图会一并删除，此操作不可恢复。')) return;
    try {
      const res = await send<{ cleared: number; kept: number; blobs: number }>('tasks-clear');
      toast(
        res.cleared > 0
          ? `已清除 ${res.cleared} 条任务${res.kept ? `，${res.kept} 条进行中已保留` : ''}`
          : '没有可清除的任务'
      );
      await refreshTasks();
    } catch (e) {
      toast((e as Error).message);
    }
  });
  void refreshTasks();

  // 错误日志查看器
  const refreshErrors = async () => {
    const box = $('error-log');
    try {
      const errors = await send<{ source: string; message: string; stack?: string; createdAt: number }[]>('errors-list', { limit: 30 });
      if (errors.length === 0) {
        setHtml(box, '<p style="color:var(--green);">暂无错误日志</p>');
        return;
      }
      setHtml(box, errors
        .map(
          (e) =>
            `<div style="margin-bottom:8px;border-bottom:0.5px solid var(--hairline);padding-bottom:6px;">
              <div style="color:var(--red);">[${e.source}] ${escapeHtml(e.message)}</div>
              ${e.stack ? `<div style="color:var(--ink-3);white-space:pre-wrap;">${escapeHtml(e.stack.slice(0, 300))}</div>` : ''}
              <div style="color:var(--ink-3);font-size:9px;">${new Date(e.createdAt).toLocaleString()}</div>
            </div>`
        )
        .join(''));
    } catch (err) {
      setHtml(box, `<p style="color:var(--red);">读取失败：${escapeHtml((err as Error).message)}</p>`);
    }
  };
  $('btn-refresh-errors').addEventListener('click', () => void refreshErrors());
  $('btn-clear-errors').addEventListener('click', async () => {
    if (!confirm('清除全部错误日志？')) return;
    try {
      await send('errors-clear');
      toast('错误日志已清除');
      await refreshErrors();
    } catch (e) {
      toast((e as Error).message);
    }
  });
  void refreshErrors();

  // 保存
  $('btn-save').addEventListener('click', async () => {
    const next: Settings = {
      reverseApi: {
        baseUrl: ($('reverse-base') as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.reverseApi.baseUrl,
        apiKey: ($('reverse-key') as HTMLInputElement).value.trim(),
        model: ($('reverse-model') as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.reverseApi.model,
        profileId: profileSel.value as Settings['reverseApi']['profileId'],
      },
      generateApi: {
        baseUrl: ($('generate-base') as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.generateApi.baseUrl,
        apiKey: ($('generate-key') as HTMLInputElement).value.trim(),
        model: ($('generate-model') as HTMLInputElement).value.trim() || DEFAULT_SETTINGS.generateApi.model,
      },
      defaultPersonCardId: cardSel.value,
      defaultAspect: aspectSel.value,
      onboarded: true,
    };
    await send('settings-save', next);
    toast('设置已保存');
  });

  async function testConn(which: 'reverse' | 'generate'): Promise<void> {
    // 先临时保存当前输入，测试连接用内存值
    const btn = $(which === 'reverse' ? 'test-reverse' : 'test-generate') as HTMLButtonElement;
    const out = $(which === 'reverse' ? 'result-reverse' : 'result-generate')!;
    const icon = which === 'reverse' ? 'scan-line' : 'sparkles';
    btn.disabled = true;
    btn.innerHTML = `${iconSvg('loader-2', { size: 13, className: 'lucide spin' })} 测试中…`;
    out.innerHTML = '';
    try {
      const tmp = { ...settings };
      tmp.reverseApi = {
        baseUrl: ($('reverse-base') as HTMLInputElement).value.trim(),
        apiKey: ($('reverse-key') as HTMLInputElement).value.trim(),
        model: ($('reverse-model') as HTMLInputElement).value.trim(),
        profileId: profileSel.value as Settings['reverseApi']['profileId'],
      };
      tmp.generateApi = {
        baseUrl: ($('generate-base') as HTMLInputElement).value.trim(),
        apiKey: ($('generate-key') as HTMLInputElement).value.trim(),
        model: ($('generate-model') as HTMLInputElement).value.trim(),
      };
      await send('settings-save', tmp);
      const res = await send<{ ok: boolean; detail: string }>('settings-test', { which });
      setHtml(out, res.ok
        ? `${iconSvg('circle-check', { size: 13, className: 'lucide' })} <span style="color:var(--green);">${res.detail}</span>`
        : `${iconSvg('alert-triangle', { size: 13, className: 'lucide' })} <span style="color:var(--red);">${res.detail}</span>`);
    } catch (e) {
      setHtml(out, `${iconSvg('alert-triangle', { size: 13, className: 'lucide' })} <span style="color:var(--red);">${(e as Error).message}</span>`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${iconSvg(icon, { size: 13, className: 'lucide' })} ${which === 'reverse' ? '测试反推连接' : '测试生图连接'}`;
    }
  }

  // 静态 HTML 里的图标水合
  hydrateIcons(document);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderGuide(show: boolean): void {
  const box = $('guide');
  if (!show) {
    setHtml(box, '');
    return;
  }
  setHtml(box, `
    <p class="section-label" style="margin-bottom:10px;">快速上手 · 2 步完成配置</p>
    <div class="guide-step">
      <div class="guide-num">1</div>
      <div>
        <p style="font-size:13px;color:var(--ink-1);margin:0 0 2px;">配置反推 API</p>
        <p style="font-size:11px;color:var(--ink-3);margin:0;">填 Base URL / Key / 模型（如 gpt-4o-mini），选一个反推方案，点「测试反推连接」</p>
      </div>
    </div>
    <div class="guide-step">
      <div class="guide-num">2</div>
      <div>
        <p style="font-size:13px;color:var(--ink-1);margin:0 0 2px;">配置生图 API</p>
        <p style="font-size:11px;color:var(--ink-3);margin:0;">填 Base URL / Key / 模型（如 gpt-image-2），点「测试生图连接」</p>
      </div>
    </div>
    <p style="font-size:11px;color:var(--ink-3);margin:8px 0 0;">配置完成后点「保存设置」，即可回到工作台使用。</p>
  `);
}

init();
