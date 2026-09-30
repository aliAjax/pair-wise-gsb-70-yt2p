import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 保存冲突后保留自己的草稿，刷新页面也不丢。
 * - definition：OpenAPI 文本草稿
 * - change：逐条结论的影响说明 / 迁移方案 / 评审意见草稿
 * - confirmation：调用方确认意见草稿
 */
export interface ChangeDraft {
  impactStatement?: string;
  migrationPlan?: string;
  reviewComment?: string;
}

interface DraftState {
  definitions: Record<string, string>;
  changes: Record<string, ChangeDraft>;
  confirmations: Record<string, { confirmer: string; comment: string }>;
  saveDefinitionDraft: (contractId: string, value: string) => void;
  takeDefinitionDraft: (contractId: string) => string | undefined;
  saveChangeDraft: (contractId: string, changeId: string, draft: ChangeDraft) => void;
  takeChangeDraft: (contractId: string, changeId: string) => ChangeDraft | undefined;
  saveConfirmationDraft: (
    contractId: string,
    consumerId: string,
    draft: { confirmer: string; comment: string },
  ) => void;
  takeConfirmationDraft: (
    contractId: string,
    consumerId: string,
  ) => { confirmer: string; comment: string } | undefined;
  clearAll: () => void;
}

const definitionKey = (contractId: string) => contractId;
const changeKey = (contractId: string, changeId: string) => `${contractId}:${changeId}`;
const confirmationKey = (contractId: string, consumerId: string) =>
  `${contractId}:${consumerId}`;

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      definitions: {},
      changes: {},
      confirmations: {},
      saveDefinitionDraft: (contractId, value) =>
        set((state) => ({
          definitions: { ...state.definitions, [definitionKey(contractId)]: value },
        })),
      takeDefinitionDraft: (contractId) => {
        const value = get().definitions[definitionKey(contractId)];
        if (value === undefined) return undefined;
        set((state) => {
          const next = { ...state.definitions };
          delete next[definitionKey(contractId)];
          return { definitions: next };
        });
        return value;
      },
      saveChangeDraft: (contractId, changeId, draft) =>
        set((state) => ({
          changes: { ...state.changes, [changeKey(contractId, changeId)]: draft },
        })),
      takeChangeDraft: (contractId, changeId) => {
        const key = changeKey(contractId, changeId);
        const value = get().changes[key];
        if (value === undefined) return undefined;
        set((state) => {
          const next = { ...state.changes };
          delete next[key];
          return { changes: next };
        });
        return value;
      },
      saveConfirmationDraft: (contractId, consumerId, draft) =>
        set((state) => ({
          confirmations: {
            ...state.confirmations,
            [confirmationKey(contractId, consumerId)]: draft,
          },
        })),
      takeConfirmationDraft: (contractId, consumerId) => {
        const key = confirmationKey(contractId, consumerId);
        const value = get().confirmations[key];
        if (value === undefined) return undefined;
        set((state) => {
          const next = { ...state.confirmations };
          delete next[key];
          return { confirmations: next };
        });
        return value;
      },
      clearAll: () => set({ definitions: {}, changes: {}, confirmations: {} }),
    }),
    { name: 'pair-wise-gsb-70-drafts' },
  ),
);
