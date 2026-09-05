/**
 * 轻量全局状态（Tab / 选择 / 结果）
 */

import type { Settings, PersonCard, AlbumItem, Task } from '../shared/types';

export interface PanelState {
  tab: 'analyze' | 'faceswap' | 'suite' | 'album' | 'personCard';
  settings: Settings | null;
  /** 当前反推结果 */
  reversePrompt: string;
  reverseProfileId: string;
  /** 当前选中的输入图 dataURL */
  selectedImage: string | null;
  selectedImageMeta: { name?: string; source?: string } | null;
  /** 当前选中人物卡 */
  personCards: PersonCard[];
  selectedCardId: string;
  /** 直接上传的面部参考照片 dataURL（1~2 张；与人物卡互斥，有值则生成时优先用作面部参考） */
  directFaceImages: string[];
  /** 反推重绘页：高斯模糊强度 0-100（生成时以模糊图作构图参考，身份只来自人物卡） */
  blurAmount: number;
  /** 模糊后的源图 dataURL（blurAmount > 0 且有图时） */
  blurredImage: string | null;
  /** 结果区 */
  results: Task[];
  loading: boolean;
  /** 拍一套页本次选中的面部参考人物卡（默认不选，与全局 selectedCardId 解耦） */
  suiteCardId: string;
  /** 当前进行中的任务（用于全局进度提示） */
  activeTask: Task | null;
}

export const initialState: PanelState = {
  tab: 'analyze',
  settings: null,
  reversePrompt: '',
  reverseProfileId: 'preset-general-fast',
  selectedImage: null,
  selectedImageMeta: null,
  personCards: [],
  selectedCardId: '',
  directFaceImages: [],
  blurAmount: 0,
  blurredImage: null,
  results: [],
  loading: false,
  suiteCardId: '',
  activeTask: null,
};

type Listener = (s: PanelState) => void;

const listeners = new Set<Listener>();
let state: PanelState = { ...initialState };

export function getState(): PanelState {
  return state;
}

export function setState(patch: Partial<PanelState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetState(): void {
  state = { ...initialState };
}
