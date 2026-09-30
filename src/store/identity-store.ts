import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 当前评审人身份；两个标签页可以改成不同名字，模拟两位评审人同时操作。 */
interface IdentityState {
  editor: string;
  setEditor: (editor: string) => void;
}

export const useIdentityStore = create<IdentityState>()(
  persist(
    (set) => ({
      editor: '评审人 A',
      setEditor: (editor) => set({ editor: editor.trim() || '评审人 A' }),
    }),
    { name: 'pair-wise-gsb-70-identity' },
  ),
);
