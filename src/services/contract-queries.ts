import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConsumerConfirmation, ContractChange, ReviewState } from '../models/contract';
import {
  addExemption,
  bulkReviewChanges,
  confirmConsumer,
  freezeVersion,
  getContract,
  listContracts,
  reviewChange,
  saveContract,
  saveContractSection,
} from './contract-service';

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

interface SectionInput {
  contractId: string;
  expectedRevision: number;
  openapi?: string;
  changes?: ContractChange[];
  confirmations?: ConsumerConfirmation[];
}

export function useSaveDefinition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SectionInput) =>
      saveContractSection({
        contractId: input.contractId,
        expectedRevision: input.expectedRevision,
        section: 'definition',
        openapi: input.openapi,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveChanges() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SectionInput) =>
      saveContractSection({
        contractId: input.contractId,
        expectedRevision: input.expectedRevision,
        section: 'changes',
        changes: input.changes,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveConfirmations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SectionInput) =>
      saveContractSection({
        contractId: input.contractId,
        expectedRevision: input.expectedRevision,
        section: 'confirmations',
        confirmations: input.confirmations,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useReviewChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      changeId: string;
      state: ReviewState;
      reviewer: string;
      comment: string;
      expectedRevision: number;
    }) =>
      reviewChange({
        contractId: input.contractId,
        changeId: input.changeId,
        reviewState: input.state,
        reviewer: input.reviewer,
        comment: input.comment,
        expectedRevision: input.expectedRevision,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useBulkReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      selections: Array<{ contractId: string; changeId: string }>;
      state: ReviewState;
      reviewer: string;
      comment: string;
      expectedRevisions: Record<string, number>;
    }) =>
      bulkReviewChanges({
        selections: input.selections,
        reviewState: input.state,
        reviewer: input.reviewer,
        comment: input.comment,
        expectedRevisions: input.expectedRevisions,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useSaveContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveContract,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useConfirmConsumer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      consumerId: string;
      confirmed: boolean;
      confirmer: string;
      comment: string;
      expectedRevision: number;
    }) => confirmConsumer(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useAddExemption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      changeId: string;
      scope: string;
      reason: string;
      approvedBy: string;
      expiresAt: string;
      expectedRevision: number;
    }) => addExemption(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}

export function useFreezeVersion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contractId: string;
      expectedRevision: number;
      version: string;
      notes: string;
      idempotencyKey: string;
    }) => freezeVersion(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contractKeys.all }),
  });
}
