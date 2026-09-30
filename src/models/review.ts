import {
  activeExemptions,
  isChangeStale,
  isConsumerUnconfirmed,
  type ApiContract,
  type ApiConsumer,
  type ContractChange,
  type EditSection,
  type Exemption,
  type ReleaseIssue,
} from './contract';

export type PendingKind = 'stale_change' | 'pending_change' | 'consumer_confirmation';

export interface PendingItem {
  kind: PendingKind;
  contractId: string;
  contractName: string;
  contractDomain: string;
  definitionVersion: number;
  changeId?: string;
  consumerId?: string;
  path?: string;
  method?: string;
  label: string;
  detail: string;
}

/**
 * 发布门禁：定义、有效结论和调用方确认都必须收敛，才能冻结版本。
 * 队列页、发布页和变更报告共用这一份判定结果。
 */
export function validateForRelease(contract: ApiContract): ReleaseIssue[] {
  const issues: ReleaseIssue[] = [];
  const definitionVersion = contract.definitionVersion;

  contract.changes.forEach((change) => {
    if (isChangeStale(change, definitionVersion)) {
      issues.push({
        id: `stale-${change.id}`,
        severity: 'blocker',
        title: '定义变更后结论失效，需要重新确认',
        detail: `${change.method} ${change.path} 的旧结论基于第 ${
          change.definitionVersion ?? 1
        } 版定义，当前定义已到第 ${definitionVersion} 版。`,
        changeId: change.id,
      });
      return;
    }
    if (change.reviewState === 'pending') {
      issues.push({
        id: `pending-${change.id}`,
        severity: 'blocker',
        title: '存在未处理变更',
        detail: `${change.method} ${change.path} 仍处于待评审状态。`,
        changeId: change.id,
      });
    }
  });

  contract.changes
    .filter(
      (change) =>
        !isChangeStale(change, definitionVersion) && change.reviewState !== 'exemption',
    )
    .forEach((change) => {
      if (change.compatibility === 'compatible') {
        return;
      }
      if (!change.impactStatement.trim()) {
        issues.push({
          id: `impact-${change.id}`,
          severity: 'blocker',
          title: '缺少调用方影响说明',
          detail: `${change.path} 需要说明受影响调用方、流量和业务影响。`,
          changeId: change.id,
        });
      }
      if (!change.migrationPlan.trim()) {
        issues.push({
          id: `migration-${change.id}`,
          severity: 'blocker',
          title: '缺少迁移方案',
          detail: `${change.path} 需要给出客户端升级、兼容层或回滚路径。`,
          changeId: change.id,
        });
      }
    });

  contract.consumers.forEach((consumer) => {
    if (isConsumerUnconfirmed(consumer, definitionVersion)) {
      issues.push({
        id: `consumer-${consumer.id}`,
        severity: 'blocker',
        title: '调用方未在当前定义上确认',
        detail: `${consumer.name}（${consumer.environment}）尚未基于第 ${definitionVersion} 版定义确认影响。`,
        consumerId: consumer.id,
      });
    }
  });

  contract.changes
    .filter(
      (change) =>
        !isChangeStale(change, definitionVersion) &&
        change.compatibility === 'breaking' &&
        change.reviewState === 'accepted' &&
        !activeExemptions(contract).some((item) => item.changeId === change.id),
    )
    .forEach((change) => {
      issues.push({
        id: `breaking-${change.id}`,
        severity: 'warning',
        title: '不兼容变更已接受但未登记有效豁免',
        detail: `${change.path} 需要记录兼容层的范围、原因和到期时间；失效豁免不计入。`,
        changeId: change.id,
      });
    });

  return issues;
}

export function getPendingItems(contract: ApiContract): PendingItem[] {
  const items: PendingItem[] = [];
  contract.changes.forEach((change) => {
    if (isChangeStale(change, contract.definitionVersion)) {
      items.push({
        kind: 'stale_change',
        contractId: contract.id,
        contractName: contract.name,
        contractDomain: contract.domain,
        definitionVersion: contract.definitionVersion,
        changeId: change.id,
        path: change.path,
        method: change.method,
        label: `${change.method} ${change.path}`,
        detail: `定义已更新到第 ${contract.definitionVersion} 版，旧「${
          change.reviewState === 'pending' ? '待评审' : change.reviewState
        }」结论失效，需要重新确认。`,
      });
    } else if (change.reviewState === 'pending') {
      items.push({
        kind: 'pending_change',
        contractId: contract.id,
        contractName: contract.name,
        contractDomain: contract.domain,
        definitionVersion: contract.definitionVersion,
        changeId: change.id,
        path: change.path,
        method: change.method,
        label: `${change.method} ${change.path}`,
        detail: '尚未给出逐条评审结论。',
      });
    }
  });
  contract.consumers.forEach((consumer) => {
    if (isConsumerUnconfirmed(consumer, contract.definitionVersion)) {
      items.push({
        kind: 'consumer_confirmation',
        contractId: contract.id,
        contractName: contract.name,
        contractDomain: contract.domain,
        definitionVersion: contract.definitionVersion,
        consumerId: consumer.id,
        label: consumer.name,
        detail: consumer.confirmation
          ? `上一次确认基于第 ${consumer.confirmation.definitionVersion} 版定义，需要在第 ${contract.definitionVersion} 版上重新确认。`
          : '调用方负责人尚未确认本次变化的影响。',
      });
    }
  });
  return items;
}

export function getAllPendingItems(contracts: ApiContract[]): PendingItem[] {
  return contracts.flatMap(getPendingItems);
}

export function pendingSummary(contract: ApiContract): {
  staleChanges: number;
  pendingChanges: number;
  consumers: number;
  total: number;
} {
  const items = getPendingItems(contract);
  return {
    staleChanges: items.filter((item) => item.kind === 'stale_change').length,
    pendingChanges: items.filter((item) => item.kind === 'pending_change').length,
    consumers: items.filter((item) => item.kind === 'consumer_confirmation').length,
    total: items.length,
  };
}

/* ----------------------- 区段级差异（冲突对话框用） ----------------------- */

function changeSignature(change: ContractChange): string {
  return [
    change.reviewState,
    change.reviewer,
    change.reviewComment,
    change.impactStatement,
    change.migrationPlan,
  ].join('');
}

function exemptionSignature(item: Exemption): string {
  return [
    item.changeId,
    item.scope,
    item.reason,
    item.approvedBy,
    item.expiresAt,
    item.active,
    item.definitionVersion,
  ].join('');
}

function consumerSignature(consumer: ApiConsumer): string {
  return consumer.confirmation
    ? [
        consumer.confirmation.state,
        consumer.confirmation.confirmedBy,
        consumer.confirmation.definitionVersion,
        consumer.confirmation.comment,
      ].join('')
    : 'unconfirmed';
}

/** 比较两个契约快照，列出发生变化的区段。 */
export function changedSections(before: ApiContract, after: ApiContract): EditSection[] {
  const sections: EditSection[] = [];
  if (before.openapi !== after.openapi || before.definitionVersion !== after.definitionVersion) {
    sections.push('definition');
  }
  const beforeChanges = new Map(before.changes.map((change) => [change.id, change]));
  if (
    after.changes.some(
      (change) => changeSignature(change) !== changeSignature(beforeChanges.get(change.id)!),
    )
  ) {
    sections.push('reviews');
  }
  const beforeConsumers = new Map(before.consumers.map((consumer) => [consumer.id, consumer]));
  if (
    after.consumers.some(
      (consumer) =>
        consumerSignature(consumer) !== consumerSignature(beforeConsumers.get(consumer.id)!),
    )
  ) {
    sections.push('consumers');
  }
  const beforeExemptions = new Map(before.exemptions.map((item) => [item.id, item]));
  if (
    after.exemptions.length !== before.exemptions.length ||
    after.exemptions.some(
      (item) => exemptionSignature(item) !== exemptionSignature(beforeExemptions.get(item.id)!),
    )
  ) {
    sections.push('exemptions');
  }
  return sections;
}

/** 生成一段人话的区段变化摘要，冲突对话框与提示条共用。 */
export function describeSectionChange(
  before: ApiContract,
  after: ApiContract,
  section: EditSection,
): string {
  switch (section) {
    case 'definition':
      return `契约定义由第 ${before.definitionVersion} 版更新到第 ${after.definitionVersion} 版`;
    case 'reviews': {
      const updated = after.changes.filter((change) => {
        const previous = before.changes.find((item) => item.id === change.id);
        return previous && changeSignature(change) !== changeSignature(previous);
      });
      return updated
        .slice(0, 3)
        .map((change) => `${change.method} ${change.path}：${change.reviewState}`)
        .join('；');
    }
    case 'consumers': {
      const confirmed = after.consumers.filter((consumer) => {
        const previous = before.consumers.find((item) => item.id === consumer.id);
        return previous && consumerSignature(consumer) !== consumerSignature(previous);
      });
      return confirmed.map((consumer) => consumer.name).join('、') + ' 的确认状态变化';
    }
    case 'exemptions': {
      const added = after.exemptions.length - before.exemptions.length;
      const voided = after.exemptions.filter(
        (item) =>
          item.active === false &&
          before.exemptions.find((previous) => previous.id === item.id)?.active !== false,
      ).length;
      if (added > 0) return `新增 ${added} 条兼容层豁免`;
      if (voided > 0) return `${voided} 条豁免因定义变更失效`;
      return '兼容层豁免发生变化';
    }
  }
}
