import { create } from 'zustand';
import type {
  BulkConflictContext,
  ConflictContext,
} from '../services/contract-service';

interface ConflictState {
  single: ConflictContext | null;
  bulk: BulkConflictContext | null;
  resolving: boolean;
  showSingle: (context: ConflictContext) => void;
  showBulk: (context: BulkConflictContext) => void;
  setResolving: (resolving: boolean) => void;
  close: () => void;
}

/**
 * 保存冲突的全局状态。任何 mutation 命中 RevisionConflictError /
 * BulkReviewConflictError 都弹同一个对话框：先看对方改了什么，
 * 再决定丢弃自己的修改或带着草稿强制重试。
 */
export const useConflictStore = create<ConflictState>((set) => ({
  single: null,
  bulk: null,
  resolving: false,
  showSingle: (single) => set({ single, bulk: null, resolving: false }),
  showBulk: (bulk) => set({ bulk, single: null, resolving: false }),
  setResolving: (resolving) => set({ resolving }),
  close: () => set({ single: null, bulk: null, resolving: false }),
}));
