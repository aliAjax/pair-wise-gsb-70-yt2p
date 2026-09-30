import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChangeDraft {
  impactStatement?: string;
  migrationPlan?: string;
  comment?: string;
  exemptionReason?: string;
  updatedAt: string;
}

/**
 * 保存冲突时，后提交的人的草稿不能丢：定义草稿、逐条说明草稿和豁免理由
 * 全部按契约/变更落本地，冲突解决前不会清空。
 */
interface DraftState {
  definitions: Record<string, string>;
  changes: Record<string, ChangeDraft>;
  consumerComments: Record<string, string>;
  saveDefinitionDraft: (contractId: string, openapi: string) => void;
  clearDefinitionDraft: (contractId: string) => void;
  saveChangeDraft: (changeId: string, draft: Partial<ChangeDraft>) => void;
  clearChangeDraft: (changeId: string) => void;
  saveConsumerDraft: (consumerId: string, comment: string) => void;
  clearConsumerDraft: (consumerId: string) => void;
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      definitions: {},
      changes: {},
      consumerComments: {},
      saveDefinitionDraft: (contractId, openapi) =>
        set((state) => ({
          definitions: { ...state.definitions, [contractId]: openapi },
        })),
      clearDefinitionDraft: (contractId) =>
        set((state) => {
          const definitions = { ...state.definitions };
          delete definitions[contractId];
          return { definitions };
        }),
      saveChangeDraft: (changeId, draft) =>
        set((state) => {
          const previous = state.changes[changeId] ?? {};
          return {
            changes: {
              ...state.changes,
              [changeId]: { ...previous, ...draft, updatedAt: new Date().toISOString() },
            },
          };
        }),
      clearChangeDraft: (changeId) =>
        set((state) => {
          const changes = { ...state.changes };
          delete changes[changeId];
          return { changes };
        }),
      saveConsumerDraft: (consumerId, comment) =>
        set((state) => ({
          consumerComments: { ...state.consumerComments, [consumerId]: comment },
        })),
      clearConsumerDraft: (consumerId) =>
        set((state) => {
          const consumerComments = { ...state.consumerComments };
          delete consumerComments[consumerId];
          return { consumerComments };
        }),
    }),
    { name: 'pair-wise-gsb-70-drafts' },
  ),
);
