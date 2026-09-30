import { create } from 'zustand';

export type NoticeTone = 'info' | 'success';

export interface Notice {
  id: number;
  tone: NoticeTone;
  title: string;
  detail?: string;
}

interface NoticeState {
  notice: Notice | null;
  notify: (tone: NoticeTone, title: string, detail?: string) => void;
  dismiss: () => void;
}

let noticeId = 0;

/** 全局轻提示：自动合并成功（rebase）、对方更新等非阻断信息走这里。 */
export const useNoticeStore = create<NoticeState>((set) => ({
  notice: null,
  notify: (tone, title, detail) =>
    set({ notice: { id: noticeId += 1, tone, title, detail } }),
  dismiss: () => set({ notice: null }),
}));
