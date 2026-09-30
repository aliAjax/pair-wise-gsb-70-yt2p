import { create } from 'zustand';
import type { ApiContract } from '../models/contract';
import type { ContractSection } from '../services/contract-service';
import { RevisionConflictError } from '../services/contract-service';

/**
 * 保存冲突的全局状态：任意页面的保存动作撞到新 revision 后，
 * 统一在这里弹出"对方改了什么"，并保留自己的草稿。
 */
export interface ConflictState {
  contractId: string;
  contractName: string;
  section: ContractSection;
  expectedRevision: number;
  actualRevision: number;
  server: ApiContract;
  /** 触发冲突时用户试图保存的内容（定义文本 / 结构化草稿由调用方自行持久化） */
  draftSummary: string;
}

interface ConflictStore {
  conflict: ConflictState | null;
  reportConflict: (error: unknown, draftSummary?: string) => boolean;
  dismiss: () => void;
}

export function isConflictError(error: unknown): error is RevisionConflictError {
  return error instanceof RevisionConflictError;
}

export const useConflictStore = create<ConflictStore>((set) => ({
  conflict: null,
  reportConflict: (error, draftSummary = '') => {
    if (!isConflictError(error)) return false;
    set({
      conflict: {
        contractId: error.server.id,
        contractName: error.server.name,
        section: error.section,
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision,
        server: error.server,
        draftSummary,
      },
    });
    return true;
  },
  dismiss: () => set({ conflict: null }),
}));
