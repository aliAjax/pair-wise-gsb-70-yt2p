import type {
  ApiContract,
  ConsumerConfirmation,
  ContractChange,
  ContractVersion,
} from '../models/contract';
import {
  isConclusionCurrent,
  isConfirmationCurrent,
  validateForRelease,
} from '../models/contract';

/** 评审队列 / 发布页 / 变更报告共用的待确认项 */
export type PendingKind = 'change' | 'consumer';

export interface PendingChangeItem {
  kind: 'change';
  key: string;
  contractId: string;
  contractName: string;
  definitionRevision: number;
  change: ContractChange;
  /** true 表示曾有结论但被定义变更冲掉，需要重新确认 */
  stale: boolean;
}

export interface PendingConsumerItem {
  kind: 'consumer';
  key: string;
  contractId: string;
  contractName: string;
  definitionRevision: number;
  consumerId: string;
  consumerName: string;
  environment: string;
  clientVersion: string;
  confirmation?: ConsumerConfirmation;
  stale: boolean;
}

export type PendingItem = PendingChangeItem | PendingConsumerItem;

/** 当前定义下需要重新/首次确认的逐条结论 */
export function pendingChanges(contract: ApiContract): PendingChangeItem[] {
  return contract.changes
    .filter((change) => !isConclusionCurrent(change, contract))
    .map((change) => ({
      kind: 'change',
      key: `${contract.id}:change:${change.id}`,
      contractId: contract.id,
      contractName: contract.name,
      definitionRevision: contract.definitionRevision,
      change,
      stale: change.reviewState !== 'pending' || change.history.length > 0,
    }));
}

/** 当前定义下未完成确认的调用方 */
export function pendingConsumers(contract: ApiContract): PendingConsumerItem[] {
  return contract.consumers.flatMap((consumer) => {
    const confirmation = contract.confirmations.find(
      (item) => item.consumerId === consumer.id,
    );
    const current = confirmation ? isConfirmationCurrent(confirmation, contract) : false;
    if (current) return [];
    return [
      {
        kind: 'consumer' as const,
        key: `${contract.id}:consumer:${consumer.id}`,
        contractId: contract.id,
        contractName: contract.name,
        definitionRevision: contract.definitionRevision,
        consumerId: consumer.id,
        consumerName: consumer.name,
        environment: consumer.environment,
        clientVersion: consumer.clientVersion,
        confirmation,
        stale: Boolean(
          confirmation && confirmation.state === 'confirmed' && !current,
        ),
      },
    ];
  });
}

/** 评审队列、发布页和变更报告使用的同一批待确认项 */
export function pendingItems(contracts: ApiContract[]): PendingItem[] {
  return contracts.flatMap((contract) => [
    ...pendingChanges(contract),
    ...pendingConsumers(contract),
  ]);
}

export function pendingCounts(contract: ApiContract): {
  staleChanges: number;
  pendingChanges: number;
  staleConsumers: number;
  pendingConsumers: number;
  total: number;
} {
  const staleChanges = contract.changes.filter(
    (change) => !isConclusionCurrent(change, contract) && change.reviewState !== 'pending',
  ).length;
  const freshPendingChanges = contract.changes.filter(
    (change) => isConclusionCurrent(change, contract) && change.reviewState === 'pending',
  ).length;
  const invalidatedChanges = contract.changes.filter(
    (change) => !isConclusionCurrent(change, contract),
  ).length;

  let staleConsumers = 0;
  let freshPendingConsumers = 0;
  contract.consumers.forEach((consumer) => {
    const confirmation = contract.confirmations.find(
      (item) => item.consumerId === consumer.id,
    );
    if (!confirmation) {
      freshPendingConsumers += 1;
    } else if (!isConfirmationCurrent(confirmation, contract)) {
      staleConsumers += 1;
    }
  });

  return {
    staleChanges,
    pendingChanges: freshPendingChanges + invalidatedChanges,
    staleConsumers,
    pendingConsumers: freshPendingConsumers,
    total:
      freshPendingChanges +
      invalidatedChanges +
      staleConsumers +
      freshPendingConsumers,
  };
}

/** 不可变版本按发布时间倒序存放，最新版本即最终版本 */
export function latestVersion(contract: ApiContract): ContractVersion | undefined {
  return contract.versions[0];
}

/** 发布门禁是否通过（所有页面共用同一判断） */
export function releaseGate(contract: ApiContract): {
  blockers: ReturnType<typeof validateForRelease>;
  warnings: ReturnType<typeof validateForRelease>;
  passed: boolean;
} {
  const issues = validateForRelease(contract);
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { blockers, warnings, passed: blockers.length === 0 };
}
