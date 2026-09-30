import { seedContracts } from '../data/seed';
import {
  activeExemptions,
  isChangeStale,
  normalizeContract,
  type ApiContract,
  type ContractChange,
  type ContractVersion,
  type EditSection,
  type Exemption,
  type ReviewState,
} from '../models/contract';
import {
  changedSections,
  describeSectionChange,
  validateForRelease,
} from '../models/review';
import { stableChecksum, formatDateTime } from '../lib/utils';

export const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const LATENCY = 180;
const HISTORY_LIMIT = 20;

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, LATENCY));
}

/* ------------------------------- 存储仓库 ------------------------------- */

interface Repository {
  version: 2;
  contracts: ApiContract[];
  /** 每个契约最近若干次写入前的快照，用于拿到冲突三方合并的 base。 */
  revisions: Record<string, ApiContract[]>;
  /** 发布幂等键 -> 契约ID:版本记录ID，重试不会产生第二个版本。 */
  publishKeys: Record<string, string>;
}

function seedRepository(): Repository {
  return {
    version: 2,
    contracts: seedContracts.map((contract) =>
      normalizeContract(contract as Parameters<typeof normalizeContract>[0]),
    ),
    revisions: {},
    publishKeys: {},
  };
}

function readRepository(): Repository {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        // 旧格式：直接存的契约数组，迁移为带修订历史的仓库信封。
        return {
          version: 2,
          contracts: (parsed as Partial<ApiContract>[]).map((item) =>
            normalizeContract(item as Partial<ApiContract> & { id: string }),
          ),
          revisions: {},
          publishKeys: {},
        };
      }
      const repository = parsed as Repository;
      return {
        version: 2,
        contracts: repository.contracts.map((contract) => normalizeContract(contract)),
        revisions: repository.revisions ?? {},
        publishKeys: repository.publishKeys ?? {},
      };
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  const seeded = seedRepository();
  writeRepository(seeded);
  return seeded;
}

/**
 * 所有写操作最终都落到这一次 setItem：契约、修订历史和幂等键在同一个
 * JSON 信封里原子落盘，写入失败会保留旧值，不会留下半个版本。
 */
function writeRepository(repository: Repository): void {
  const payload = JSON.stringify(repository);
  const previous = localStorage.getItem(STORAGE_KEY);
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    if (previous !== null) localStorage.setItem(STORAGE_KEY, previous);
    throw new Error('契约仓库写入失败，请重试');
  }
}

function findContract(repository: Repository, contractId: string): ApiContract {
  const contract = repository.contracts.find((item) => item.id === contractId);
  if (!contract) {
    throw new Error('契约不存在');
  }
  return contract;
}

function pushRevision(repository: Repository, contract: ApiContract): void {
  const history = repository.revisions[contract.id] ?? [];
  history.push(clone(contract));
  repository.revisions[contract.id] = history.slice(-HISTORY_LIMIT);
}

function findBaseSnapshot(repository: Repository, contractId: string, revision: number) {
  const contract = findContract(repository, contractId);
  if (contract.revision === revision) {
    return { contract, exact: true as const };
  }
  const snapshot = (repository.revisions[contractId] ?? []).find(
    (item) => item.revision === revision,
  );
  return { contract: snapshot ?? null, exact: false as const };
}

/** 跨标签页：另一个评审人写入后，仓库的订阅者可以立刻刷新。 */
export function subscribeRepository(listener: () => void): () => void {
  const handler = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && event.newValue !== null) {
      listener();
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/* ------------------------------- 冲突模型 ------------------------------- */

export interface ConflictContext {
  contractId: string;
  contractName: string;
  baseRevision: number;
  currentRevision: number;
  editor: string;
  actionLabel: string;
  theirSections: EditSection[];
  mySections: EditSection[];
  base: ApiContract;
  theirs: ApiContract;
  mine: ApiContract;
  scope: 'single';
  mutate: (contract: ApiContract) => ApiContract;
  /** 保留草稿重试：用同一批操作参数、force=true 再提交一次。 */
  forceRetry: () => Promise<unknown>;
}

export class RevisionConflictError extends Error {
  readonly context: ConflictContext;

  constructor(context: ConflictContext) {
    super('契约已被另一位评审人更新，请先查看对方改动再决定如何合并');
    this.name = 'RevisionConflictError';
    this.context = context;
  }
}

export interface BulkConflictContext {
  scope: 'bulk';
  state: ReviewState;
  reviewer: string;
  comment: string;
  selections: Array<{ contractId: string; changeId: string }>;
  conflicts: Array<{
    contractId: string;
    contractName: string;
    baseRevision: number;
    currentRevision: number;
    theirSections: EditSection[];
    mySections: EditSection[];
    base: ApiContract;
    theirs: ApiContract;
  }>;
}

export class BulkReviewConflictError extends Error {
  readonly context: BulkConflictContext;

  constructor(context: BulkConflictContext) {
    super('批量结论与他人的最新保存冲突，请查看冲突后重试');
    this.name = 'BulkReviewConflictError';
    this.context = context;
  }
}

export class ReleaseGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseGateError';
  }
}

/* --------------------------- 定义变更级联失效 --------------------------- */

/**
 * 应用一次提交后的定义级联：openapi 内容一旦改变，旧逐条结论与调用方确认
 * 立即失效（结论回到待评审、确认清空），有效豁免作废但保留历史记录。
 */
function applyDefinitionEffects(
  contract: ApiContract,
  previousOpenapi: string,
  previousDefinitionVersion: number,
): ApiContract {
  const result: ApiContract = { ...contract };
  const now = new Date().toISOString();

  if (contract.openapi !== previousOpenapi) {
    result.definitionVersion = previousDefinitionVersion + 1;
    result.definitionUpdatedAt = now;
    result.changes = contract.changes.map((change) => {
      const hasConclusion = change.reviewState !== 'pending';
      if (!hasConclusion) {
        return { ...change, invalidatedByDefinition: false };
      }
      return {
        ...change,
        reviewState: 'pending' as ReviewState,
        reviewComment: change.reviewComment
          ? `【旧结论已失效】${change.reviewComment}`
          : '【旧结论已失效，需要重新确认】',
        definitionVersion: previousDefinitionVersion,
        invalidatedByDefinition: true,
      };
    });
    result.exemptions = contract.exemptions.map((item) =>
      item.active === false
        ? item
        : {
            ...item,
            active: false,
            voidedAt: now,
            voidReason: `契约定义已更新到第 ${previousDefinitionVersion + 1} 版`,
          },
    );
    result.consumers = contract.consumers.map((consumer) => ({
      ...consumer,
      confirmation: undefined,
    }));
    if (result.status !== 'draft') {
      result.status = 'review';
    }
  }

  result.revision = contract.revision + 1;
  result.updatedAt = now;
  return result;
}

/* ----------------------------- 区段三方合并 ----------------------------- */

const REVIEW_FIELDS = [
  'reviewState',
  'reviewer',
  'reviewComment',
  'reviewedAt',
  'impactStatement',
  'migrationPlan',
] as const;

function overlayReviews(target: ApiContract, base: ApiContract, source: ApiContract): void {
  const baseById = new Map(base.changes.map((change) => [change.id, change]));
  const targetById = new Map(target.changes.map((change) => [change.id, change]));
  source.changes.forEach((sourceChange) => {
    const baseChange = baseById.get(sourceChange.id);
    const targetChange = targetById.get(sourceChange.id);
    if (!baseChange || !targetChange) {
      if (!targetChange) {
        target.changes.push(clone(sourceChange));
      }
      return;
    }
    const touched = REVIEW_FIELDS.some(
      (field) => sourceChange[field] !== baseChange[field],
    );
    if (touched) {
      REVIEW_FIELDS.forEach((field) => {
        targetChange[field] = sourceChange[field] as never;
      });
    }
  });
}

function overlayConsumers(target: ApiContract, base: ApiContract, source: ApiContract): void {
  const baseById = new Map(base.consumers.map((consumer) => [consumer.id, consumer]));
  source.consumers.forEach((sourceConsumer) => {
    const targetConsumer = target.consumers.find((item) => item.id === sourceConsumer.id);
    const baseConsumer = baseById.get(sourceConsumer.id);
    if (!targetConsumer) {
      target.consumers.push(clone(sourceConsumer));
      return;
    }
    if (!baseConsumer || sourceConsumer.confirmation !== baseConsumer.confirmation) {
      targetConsumer.confirmation = clone(sourceConsumer.confirmation);
    }
  });
}

function overlayExemptions(target: ApiContract, base: ApiContract, source: ApiContract): void {
  const baseById = new Map(base.exemptions.map((item) => [item.id, item]));
  source.exemptions.forEach((sourceItem) => {
    const targetItem = target.exemptions.find((item) => item.id === sourceItem.id);
    const baseItem = baseById.get(sourceItem.id);
    if (!targetItem) {
      target.exemptions.push(clone(sourceItem));
      return;
    }
    if (!baseItem || JSON.stringify(sourceItem) !== JSON.stringify(baseItem)) {
      Object.assign(targetItem, clone(sourceItem));
    }
  });
}

/** 把我在 base 上对某区段的改动叠加到对方最新版本之上（不同区段互不覆盖）。 */
function mergeSections(
  theirs: ApiContract,
  base: ApiContract,
  mine: ApiContract,
  sections: EditSection[],
): ApiContract {
  const merged: ApiContract = {
    ...theirs,
    changes: clone(theirs.changes),
    consumers: clone(theirs.consumers),
    exemptions: clone(theirs.exemptions),
  };
  sections.forEach((section) => {
    if (section === 'definition') {
      merged.openapi = mine.openapi;
    } else if (section === 'reviews') {
      overlayReviews(merged, base, mine);
    } else if (section === 'consumers') {
      overlayConsumers(merged, base, mine);
    } else {
      overlayExemptions(merged, base, mine);
    }
  });
  return applyDefinitionEffects(merged, theirs.openapi, theirs.definitionVersion);
}

export interface CommitDraftInput {
  contractId: string;
  baseRevision: number;
  editor: string;
  actionLabel: string;
  mutate: (contract: ApiContract) => ApiContract;
  force?: boolean;
}

export interface CommitResult {
  contract: ApiContract;
  rebased: boolean;
  mergedSections: EditSection[];
  theirSections: EditSection[];
  details: string[];
}

/**
 * 统一提交入口（乐观锁）：
 * - revision 未变：直接提交；
 * - revision 已变且改动区段不相交：自动 rebase 到对方版本之后；
 * - revision 已变且区段相交：抛出 RevisionConflictError，调用方先展示对方改动，
 *   由用户带着 force=true 重试（用我的版本覆盖冲突区段），不允许静默覆盖。
 */
export async function commitDraft(input: CommitDraftInput): Promise<CommitResult> {
  const repository = readRepository();
  const current = findContract(repository, input.contractId);

  const buildConflict = (base: ApiContract, mine: ApiContract, sections: EditSection[]) =>
    new RevisionConflictError({
      contractId: input.contractId,
      contractName: current.name,
      baseRevision: input.baseRevision,
      currentRevision: current.revision,
      editor: input.editor,
      actionLabel: input.actionLabel,
      theirSections: changedSections(base, current),
      mySections: sections,
      base: clone(base),
      theirs: clone(current),
      mine: clone(mine),
      scope: 'single',
      mutate: input.mutate,
      forceRetry: () => commitDraft({ ...input, force: true }),
    });

  if (current.revision === input.baseRevision) {
    const candidate = applyDefinitionEffects(
      input.mutate(clone(current)),
      current.openapi,
      current.definitionVersion,
    );
    pushRevision(repository, current);
    persistContract(repository, current.id, candidate);
    writeRepository(repository);
    await wait();
    return {
      contract: clone(candidate),
      rebased: false,
      mergedSections: [],
      theirSections: [],
      details: [],
    };
  }

  const baseLookup = findBaseSnapshot(repository, input.contractId, input.baseRevision);
  if (!baseLookup.contract) {
    throw buildConflict(
      current,
      applyDefinitionEffects(
        input.mutate(clone(current)),
        current.openapi,
        current.definitionVersion,
      ),
      ['definition', 'reviews', 'consumers', 'exemptions'],
    );
  }

  const base = baseLookup.contract;
  const mine = applyDefinitionEffects(
    input.mutate(clone(base)),
    base.openapi,
    base.definitionVersion,
  );
  const theirSections = changedSections(base, current);
  const mySections = changedSections(base, mine);
  const overlap = mySections.filter((section) => theirSections.includes(section));

  if (overlap.length > 0 && !input.force) {
    throw buildConflict(base, mine, mySections);
  }

  const merged = mergeSections(current, base, mine, mySections);
  pushRevision(repository, current);
  persistContract(repository, current.id, merged);
  writeRepository(repository);
  await wait();
  return {
    contract: clone(merged),
    rebased: true,
    mergedSections: mySections,
    theirSections,
    details: theirSections.map((section) => describeSectionChange(base, current, section)),
  };
}

function persistContract(repository: Repository, contractId: string, next: ApiContract): void {
  repository.contracts = repository.contracts.map((item) =>
    item.id === contractId ? next : item,
  );
}

/* ------------------------------ 领域操作封装 ------------------------------ */

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  return clone(readRepository().contracts);
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = readRepository().contracts;
  return contracts.find((contract) => contract.id === id);
}

export async function createContract(contract: ApiContract): Promise<ApiContract> {
  const repository = readRepository();
  const normalized = normalizeContract({ ...contract, revision: 1, definitionVersion: 1 });
  if (repository.contracts.some((item) => item.id === normalized.id)) {
    throw new Error('契约已存在');
  }
  repository.contracts.unshift(normalized);
  writeRepository(repository);
  await wait();
  return clone(normalized);
}

export interface SaveDefinitionInput {
  contractId: string;
  baseRevision: number;
  editor: string;
  openapi: string;
  force?: boolean;
}

export async function saveDefinition(input: SaveDefinitionInput): Promise<CommitResult> {
  return commitDraft({
    contractId: input.contractId,
    baseRevision: input.baseRevision,
    editor: input.editor,
    actionLabel: '保存契约定义',
    force: input.force,
    mutate: (contract) => ({ ...contract, openapi: input.openapi, lastEditedBy: input.editor }),
  });
}

export interface SubmitReviewInput {
  contractId: string;
  baseRevision: number;
  changeId: string;
  state: ReviewState;
  reviewer: string;
  comment: string;
  force?: boolean;
}

export async function submitReview(input: SubmitReviewInput): Promise<CommitResult> {
  return commitDraft({
    contractId: input.contractId,
    baseRevision: input.baseRevision,
    editor: input.reviewer,
    actionLabel: '保存逐条结论',
    force: input.force,
    mutate: (contract) => ({
      ...contract,
      status: contract.status === 'draft' ? 'review' : contract.status,
      lastEditedBy: input.reviewer,
      changes: contract.changes.map((change) =>
        change.id === input.changeId
          ? {
              ...change,
              reviewState: input.state,
              reviewer: input.reviewer,
              reviewComment: input.comment,
              reviewedAt: new Date().toISOString(),
              definitionVersion: contract.definitionVersion,
              invalidatedByDefinition: false,
            }
          : change,
      ),
    }),
  });
}

export interface SaveChangeTextsInput {
  contractId: string;
  baseRevision: number;
  editor: string;
  changeId: string;
  impactStatement?: string;
  migrationPlan?: string;
  force?: boolean;
}

/** 保存影响说明 / 迁移方案草稿，不代表重新确认，不会清除失效标记。 */
export async function saveChangeTexts(input: SaveChangeTextsInput): Promise<CommitResult> {
  return commitDraft({
    contractId: input.contractId,
    baseRevision: input.baseRevision,
    editor: input.editor,
    actionLabel: '保存调用方影响与迁移说明',
    force: input.force,
    mutate: (contract) => ({
      ...contract,
      changes: contract.changes.map((change) =>
        change.id === input.changeId
          ? {
              ...change,
              impactStatement: input.impactStatement ?? change.impactStatement,
              migrationPlan: input.migrationPlan ?? change.migrationPlan,
            }
          : change,
      ),
    }),
  });
}

export interface RegisterExemptionInput {
  contractId: string;
  baseRevision: number;
  changeId: string;
  reason: string;
  editor: string;
  force?: boolean;
}

export async function registerExemption(input: RegisterExemptionInput): Promise<CommitResult> {
  return commitDraft({
    contractId: input.contractId,
    baseRevision: input.baseRevision,
    editor: input.editor,
    actionLabel: '登记兼容层豁免',
    force: input.force,
    mutate: (contract) => {
      const target = contract.changes.find((change) => change.id === input.changeId);
      const exemption: Exemption = {
        id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        changeId: input.changeId,
        scope: target?.path ?? '未指定',
        reason: input.reason,
        approvedBy: input.editor,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        definitionVersion: contract.definitionVersion,
        active: true,
      };
      return {
        ...contract,
        lastEditedBy: input.editor,
        exemptions: [...contract.exemptions, exemption],
        changes: contract.changes.map((change) =>
          change.id === input.changeId
            ? {
                ...change,
                reviewState: 'exemption',
                reviewer: input.editor,
                reviewComment: input.reason,
                reviewedAt: new Date().toISOString(),
                definitionVersion: contract.definitionVersion,
                invalidatedByDefinition: false,
              }
            : change,
        ),
      };
    },
  });
}

export interface ConfirmConsumerInput {
  contractId: string;
  baseRevision: number;
  consumerId: string;
  reviewer: string;
  comment: string;
  force?: boolean;
}

export async function confirmConsumer(input: ConfirmConsumerInput): Promise<CommitResult> {
  return commitDraft({
    contractId: input.contractId,
    baseRevision: input.baseRevision,
    editor: input.reviewer,
    actionLabel: '保存调用方确认',
    force: input.force,
    mutate: (contract) => ({
      ...contract,
      lastEditedBy: input.reviewer,
      consumers: contract.consumers.map((consumer) =>
        consumer.id === input.consumerId
          ? {
              ...consumer,
              confirmation: {
                state: 'confirmed',
                confirmedBy: input.reviewer,
                confirmedAt: new Date().toISOString(),
                definitionVersion: contract.definitionVersion,
                comment: input.comment,
              },
            }
          : consumer,
      ),
    }),
  });
}

/* ------------------------------ 批量逐条结论 ------------------------------ */

export interface BulkReviewInput {
  selections: Array<{ contractId: string; changeId: string; baseRevision: number }>;
  state: ReviewState;
  reviewer: string;
  comment: string;
  force?: boolean;
}

export interface BulkReviewResult {
  contracts: ApiContract[];
  conflicts: Array<{ contractId: string; contractName: string }>;
}

/**
 * 跨契约批量结论：两阶段——先对所有涉及的契约做冲突预检（不写任何数据），
 * 全部通过后才在同一个仓库信封里一次落盘，避免写入一半。
 */
export async function bulkReviewChanges(input: BulkReviewInput): Promise<BulkReviewResult> {
  const repository = readRepository();
  const grouped = new Map<string, { changeIds: string[]; baseRevision: number }>();
  input.selections.forEach(({ contractId, changeId, baseRevision }) => {
    const group = grouped.get(contractId) ?? {
      changeIds: [],
      baseRevision,
    };
    group.changeIds.push(changeId);
    group.baseRevision = baseRevision;
    grouped.set(contractId, group);
  });

  const conflicts: BulkConflictContext['conflicts'] = [];
  const nextByContract = new Map<string, ApiContract>();

  grouped.forEach(({ changeIds, baseRevision }, contractId) => {
    const current = findContract(repository, contractId);
    if (current.revision !== baseRevision && !input.force) {
      const base =
        (repository.revisions[contractId] ?? []).find((item) => item.revision === baseRevision) ??
        current;
      const candidate = applyBulkReview(current, base, changeIds, input);
      conflicts.push({
        contractId,
        contractName: current.name,
        baseRevision,
        currentRevision: current.revision,
        theirSections: changedSections(base, current),
        mySections: changedSections(base, candidate),
        base: clone(base),
        theirs: clone(current),
      });
      return;
    }
    nextByContract.set(contractId, applyBulkReview(current, current, changeIds, input));
  });

  if (conflicts.length > 0 && !input.force) {
    throw new BulkReviewConflictError({
      scope: 'bulk',
      state: input.state,
      reviewer: input.reviewer,
      comment: input.comment,
      selections: input.selections.map(({ contractId, changeId }) => ({ contractId, changeId })),
      conflicts,
    });
  }

  // force 重试：以最新版本重新套用结论。
  if (conflicts.length > 0) {
    conflicts.forEach(({ contractId }) => {
      const latest = findContract(repository, contractId);
      const { changeIds } = grouped.get(contractId)!;
      nextByContract.set(contractId, applyBulkReview(latest, latest, changeIds, input));
    });
  }

  repository.contracts.forEach((contract) => {
    const next = nextByContract.get(contract.id);
    if (next) {
      pushRevision(repository, contract);
    }
  });
  repository.contracts = repository.contracts.map(
    (contract) => nextByContract.get(contract.id) ?? contract,
  );
  writeRepository(repository);
  await wait();
  return {
    contracts: clone(repository.contracts),
    conflicts: input.force ? conflicts.map((item) => ({ ...item })) : [],
  };
}

function applyBulkReview(
  target: ApiContract,
  base: ApiContract,
  changeIds: string[],
  input: BulkReviewInput,
): ApiContract {
  const selected = new Set(changeIds);
  const now = new Date().toISOString();
  const withReviews: ApiContract = {
    ...target,
    status: target.status === 'draft' ? 'review' : target.status,
    lastEditedBy: input.reviewer,
    changes: target.changes.map((change) =>
      selected.has(change.id)
        ? {
            ...change,
            reviewState: input.state,
            reviewer: input.reviewer,
            reviewComment: input.comment,
            reviewedAt: now,
            definitionVersion: base.definitionVersion,
            invalidatedByDefinition: false,
          }
        : change,
    ),
  };
  return applyDefinitionEffects(withReviews, target.openapi, target.definitionVersion);
}

/* ------------------------------ 原子发布 ------------------------------ */

export interface PublishVersionInput {
  contractId: string;
  baseRevision: number;
  version: string;
  notes: string;
  editor: string;
  idempotencyKey: string;
  force?: boolean;
}

const inFlightPublishes = new Map<string, Promise<ApiContract>>();

/**
 * 事务性发布：
 * 1. 同一幂等键的重试直接返回已创建版本，绝不产生第二条记录；
 * 2. 发布前重新跑服务端门禁，阻断项存在则拒绝；
 * 3. 定义、有效结论、有效豁免和调用方确认一次性深拷贝进不可变快照，
 *    与修订号、幂等键在同一次 setItem 里落盘，失败整体回滚。
 */
export function publishVersion(input: PublishVersionInput): Promise<ApiContract> {
  const existing = inFlightPublishes.get(input.idempotencyKey);
  if (existing) return existing;
  const task = publishVersionInternal(input).finally(() => {
    inFlightPublishes.delete(input.idempotencyKey);
  });
  inFlightPublishes.set(input.idempotencyKey, task);
  return task;
}

async function publishVersionInternal(input: PublishVersionInput): Promise<ApiContract> {
  const repository = readRepository();
  const current = findContract(repository, input.contractId);

  const deduped = repository.publishKeys[input.idempotencyKey];
  if (deduped) {
    const [contractId, releaseId] = deduped.split(':');
    const contract = repository.contracts.find((item) => item.id === contractId);
    const version = contract?.versions.find((item) => item.id === releaseId);
    if (contract && version) {
      await wait();
      return clone(contract);
    }
  }

  if (current.revision !== input.baseRevision && !input.force) {
    throw new RevisionConflictError({
      contractId: input.contractId,
      contractName: current.name,
      baseRevision: input.baseRevision,
      currentRevision: current.revision,
      editor: input.editor,
      actionLabel: '冻结并发布正式版本',
      theirSections: changedSections(
        (repository.revisions[input.contractId] ?? []).find(
          (item) => item.revision === input.baseRevision,
        ) ?? current,
        current,
      ),
      mySections: [],
      base: clone(
        (repository.revisions[input.contractId] ?? []).find(
          (item) => item.revision === input.baseRevision,
        ) ?? current,
      ),
      theirs: clone(current),
      mine: clone(current),
      scope: 'single',
      mutate: (contract) => contract,
      forceRetry: () => publishVersion({ ...input, force: true }),
    });
  }

  if (current.versions.some((version) => version.version === input.version)) {
    throw new ReleaseGateError(`版本号 ${input.version} 已存在，请使用新的版本号`);
  }

  const issues = validateForRelease(current);
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  if (blockers.length > 0) {
    throw new ReleaseGateError(`发布门禁未通过：${blockers[0].title}（${blockers[0].detail}）`);
  }

  const releaseId = `ver-${stableChecksum(input.idempotencyKey)}`;
  if (current.versions.some((version) => version.id === releaseId)) {
    await wait();
    return clone(current);
  }

  const valid = current.changes.filter(
    (change) =>
      change.reviewState !== 'pending' &&
      !isChangeStale(change, current.definitionVersion),
  );
  const release: ContractVersion = {
    id: releaseId,
    contractId: input.contractId,
    version: input.version,
    releasedAt: new Date().toISOString(),
    checksum: releaseSnapshotChecksum(current, valid),
    notes: input.notes,
    changeIds: current.changes.map((change) => change.id),
    validChangeIds: valid.map((change) => change.id),
    openapi: current.openapi,
    definitionVersion: current.definitionVersion,
    contractRevision: current.revision,
    changes: clone(current.changes),
    exemptions: clone(activeExemptions(current)),
    consumers: clone(current.consumers),
    immutable: true,
    publishedBy: input.editor,
  };

  const updated: ApiContract = {
    ...current,
    version: input.version,
    status: 'released',
    versions: [release, ...current.versions],
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
    lastEditedBy: input.editor,
  };

  pushRevision(repository, current);
  persistContract(repository, current.id, updated);
  repository.publishKeys[input.idempotencyKey] = `${current.id}:${releaseId}`;
  writeRepository(repository);
  await wait();
  return clone(updated);
}

function releaseSnapshotChecksum(contract: ApiContract, valid: ContractChange[]): string {
  return stableChecksum(
    JSON.stringify({
      openapi: contract.openapi,
      definitionVersion: contract.definitionVersion,
      validChanges: valid.map((change) => [
        change.id,
        change.reviewState,
        change.reviewer,
        change.reviewComment,
      ]),
      exemptions: activeExemptions(contract).map((item) => [
        item.changeId,
        item.scope,
        item.reason,
        item.expiresAt,
      ]),
    }),
  );
}

/* ------------------------------ 报告与示例 ------------------------------ */

export function generateExampleRequest(contract: ApiContract, change?: ContractChange): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contract.openapi);
  } catch {
    parsed = null;
  }
  const openapi = parsed as
    | {
        paths?: Record<string, Record<string, { summary?: string }>>;
      }
    | null;
  const candidates = openapi?.paths ? Object.entries(openapi.paths) : [];
  const selectedPath = change?.path ?? candidates[0]?.[0] ?? '/resource';
  const selectedMethod = (
    change?.method ??
    (candidates[0]?.[1] ? Object.keys(candidates[0][1])[0] : 'get')
  ).toUpperCase();
  const fields = change
    ? [change.after.replace(/^新增|移除|变为/g, '').trim()]
    : ['orderId: ORD-20260929-001', 'requestId: req-local-demo'];

  return JSON.stringify(
    {
      method: selectedMethod,
      url: `https://api.example.com${selectedPath.replace('{orderId}', 'ORD-20260929-001').replace('{paymentId}', 'PAY-90218').replace('{userId}', 'U-1024')}`,
      headers: {
        Authorization: 'Bearer <token>',
        'X-Client-Version': contract.version,
      },
      body:
        selectedMethod === 'GET'
          ? undefined
          : Object.fromEntries(
              fields.map((field) => {
                const [key, value] = field.split(':').map((item) => item.trim());
                return [key || 'field', value || 'value'];
              }),
            ),
    },
    null,
    2,
  );
}

export function buildChangeReport(contract: ApiContract): string {
  const valid = contract.changes.filter(
    (change) =>
      change.reviewState !== 'pending' &&
      !isChangeStale(change, contract.definitionVersion),
  );
  const stale = contract.changes.filter((change) =>
    isChangeStale(change, contract.definitionVersion),
  );
  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 状态：${contract.status}`,
    `- 定义版本：第 ${contract.definitionVersion} 版（修订 ${contract.revision}）`,
    `- 有效逐条结论：${valid.length} / ${contract.changes.length}`,
    `- 因定义变更待重新确认：${stale.length} 项`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => [
      `### ${change.method} ${change.path} - ${change.kind}`,
      `- 兼容性：${change.compatibility}`,
      `- 变更前：${change.before}`,
      `- 变更后：${change.after}`,
      `- 判定依据：${change.rationale}`,
      `- 调用方影响：${change.impactStatement || '未填写'}`,
      `- 迁移方案：${change.migrationPlan || '未填写'}`,
      `- 评审结论：${change.reviewState}${
        isChangeStale(change, contract.definitionVersion) ? '（已失效，待重新确认）' : ''
      }`,
      `- 结论基于定义版本：第 ${change.definitionVersion ?? 1} 版`,
      '',
    ]),
    '## 调用方确认',
    ...contract.consumers.map((consumer) => {
      const confirmation = consumer.confirmation;
      if (!confirmation) {
        return `- ${consumer.name} / ${consumer.owner} / ${consumer.environment}：未确认`;
      }
      const staleConsumer = confirmation.definitionVersion < contract.definitionVersion;
      return `- ${consumer.name} / ${consumer.owner} / ${consumer.environment}：${
        confirmation.confirmedBy
      } 于 ${formatDateTime(confirmation.confirmedAt)} 确认（基于第 ${
        confirmation.definitionVersion
      } 版定义${staleConsumer ? '，已失效待重新确认' : ''}）`;
    }),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions.map((item) => {
          const active =
            item.active !== false &&
            (item.definitionVersion ?? 1) >= contract.definitionVersion;
          return `- ${item.scope}：${item.reason}（至 ${item.expiresAt}，${
            active ? '有效' : `已作废：${item.voidReason ?? '定义已变更'}`
          }）`;
        })
      : ['- 无']),
  ];
  return lines.join('\n');
}

/** 正式版本的归档报告：数据来自不可变快照，与当前工作副本无关。 */
export function buildVersionReport(contract: ApiContract, version: ContractVersion): string {
  const changes = version.changes ?? contract.changes;
  const exemptions = version.exemptions ?? [];
  const consumers = version.consumers ?? [];
  const lines = [
    `# ${contract.name} ${version.version} 正式版本归档`,
    '',
    `- 发布时间：${formatDateTime(version.releasedAt)}`,
    `- 发布人：${version.publishedBy ?? '未记录'}`,
    `- 定义版本：第 ${version.definitionVersion ?? 1} 版`,
    `- 工作副本修订：${version.contractRevision ?? '-'}`,
    `- 校验值：${version.checksum}`,
    `- 有效结论：${(version.validChangeIds ?? []).length} 项`,
    `- 发布说明：${version.notes}`,
    '',
    '## 随版冻结的有效结论',
    ...changes
      .filter((change) => version.validChangeIds?.includes(change.id))
      .flatMap((change) => [
        `### ${change.method} ${change.path} - ${change.kind}`,
        `- 兼容性：${change.compatibility}`,
        `- 评审结论：${change.reviewState}（${change.reviewer}）`,
        `- 调用方影响：${change.impactStatement || '未填写'}`,
        `- 迁移方案：${change.migrationPlan || '未填写'}`,
        '',
      ]),
    '## 随版冻结的豁免',
    ...(exemptions.length
      ? exemptions.map(
          (item) => `- ${item.scope}：${item.reason}（${item.approvedBy}，至 ${item.expiresAt}）`,
        )
      : ['- 无']),
    '',
    '## 随版冻结的调用方确认',
    ...consumers.map((consumer) =>
      consumer.confirmation
        ? `- ${consumer.name}：${consumer.confirmation.confirmedBy} 确认`
        : `- ${consumer.name}：未确认`,
    ),
  ];
  return lines.join('\n');
}

export function diffVersionSummary(contract: ApiContract, version?: ContractVersion): string {
  const selected = version ?? contract.versions[0];
  if (!selected) {
    return '无可比较的历史正式版本。';
  }
  return [
    `正式版本 ${selected.version}（第 ${selected.definitionVersion ?? 1} 版定义）`,
    `发布于 ${formatDateTime(selected.releasedAt)}`,
    `校验值 ${selected.checksum}`,
    `随版有效结论 ${(selected.validChangeIds ?? selected.changeIds).length} 项`,
    `当前工作副本第 ${contract.definitionVersion} 版定义 / 修订 ${contract.revision}`,
  ].join('\n');
}
