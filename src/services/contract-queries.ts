import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReviewState } from '../models/contract';
import {
  bulkReviewChanges,
  confirmConsumer,
  createContract,
  getContract,
  listContracts,
  publishVersion,
  registerExemption,
  saveChangeTexts,
  saveDefinition,
  submitReview,
  BulkReviewConflictError,
  RevisionConflictError,
} from './contract-service';
import { useConflictStore } from '../store/conflict-store';
import { useNoticeStore } from '../store/notice-store';

export { useRepositorySync } from './repository-sync';

export const contractKeys = {
  all: ['contracts'] as const,
  detail: (id: string) => ['contracts', id] as const,
};

export function useContracts() {
  return useQuery({
    queryKey: contractKeys.all,
    queryFn: listContracts,
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: contractKeys.detail(id),
    queryFn: () => getContract(id),
    enabled: Boolean(id),
  });
}

function useCommitMutation<TVariables>(
  mutationFn: (variables: TVariables & { force?: boolean }) => Promise<{
    contract?: import('../models/contract').ApiContract;
    rebased?: boolean;
    details?: string[];
  }>,
) {
  const queryClient = useQueryClient();
  const showSingle = useConflictStore((state) => state.showSingle);
  const showBulk = useConflictStore((state) => state.showBulk);
  const notify = useNoticeStore((state) => state.notify);

  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      if (result.rebased && result.details) {
        notify(
          'info',
          '已自动合并对方的最新改动',
          `你们编辑的是不同区段：${result.details.join('；')}。`,
        );
      }
    },
    onError: (error) => {
      if (error instanceof RevisionConflictError) {
        showSingle(error.context);
      } else if (error instanceof BulkReviewConflictError) {
        showBulk(error.context);
      }
    },
  });
}

export function useSaveDefinition() {
  return useCommitMutation(saveDefinition);
}

export function useSubmitReview() {
  return useCommitMutation(submitReview);
}

export function useSaveChangeTexts() {
  return useCommitMutation(saveChangeTexts);
}

export function useRegisterExemption() {
  return useCommitMutation(registerExemption);
}

export function useConfirmConsumer() {
  return useCommitMutation(confirmConsumer);
}

export function useBulkReview() {
  const queryClient = useQueryClient();
  const showBulk = useConflictStore((state) => state.showBulk);
  const notify = useNoticeStore((state) => state.notify);

  return useMutation({
    mutationFn: bulkReviewChanges,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      if (result.conflicts.length) {
        notify('info', '批量结论已在最新版本上重试完成', undefined);
      }
    },
    onError: (error) => {
      if (error instanceof BulkReviewConflictError) {
        showBulk(error.context);
      }
    },
  });
}

export function usePublishVersion() {
  const queryClient = useQueryClient();
  const showSingle = useConflictStore((state) => state.showSingle);
  const notify = useNoticeStore((state) => state.notify);

  return useMutation({
    mutationFn: publishVersion,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contractKeys.all });
      notify('success', '正式版本已冻结', '定义、有效结论和豁免已随版固化，不可修改。');
    },
    onError: (error) => {
      if (error instanceof RevisionConflictError) {
        showSingle(error.context);
      }
    },
  });
}

export function useCreateContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createContract,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export interface BulkReviewVariables {
  selections: Array<{ contractId: string; changeId: string; baseRevision: number }>;
  state: ReviewState;
  reviewer: string;
  comment: string;
}
