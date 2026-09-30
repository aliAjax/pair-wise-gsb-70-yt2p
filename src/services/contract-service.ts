import { seedContracts } from '../data/seed';
import type {
  ApiContract,
  ApiConsumer,
  ArchivedConclusion,
  ConfirmationSnapshot,
  ConsumerConfirmation,
  ContractChange,
  ContractVersion,
  Exemption,
  ExemptionSnapshot,
  ReviewState,
} from '../models/contract';
import { isConclusionCurrent, validateForRelease } from '../models/contract';
import { stableChecksum, formatDateTime } from '../lib/utils';

const STORAGE_KEY = 'pair-wise-gsb-70-contracts';
const LATENCY = 180;

/** 可以独立保存的内容段；冲突检测按整份契约的 revision 进行 */
export type ContractSection = 'definition' | 'changes' | 'confirmations' | 'exemptions';

/** 保存冲突：后提交的人拿到的是服务端最新副本与对方改动，不会直接覆盖 */
export class RevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;
  readonly server: ApiContract;
  readonly section: ContractSection;

  constructor(input: {
    expectedRevision: number;
    actualRevision: number;
    server: ApiContract;
    section: ContractSection;
  }) {
    const who = input.server.updatedAt;
    super(
      `契约已被他人更新（你基于第 ${input.expectedRevision} 版，当前为第 ${input.actualRevision} 版，最近更新 ${who}）`,
    );
    this.name = 'RevisionConflictError';
    this.expectedRevision = input.expectedRevision;
    this.actualRevision = input.actualRevision;
    this.server = input.server;
    this.section = input.section;
  }
}

export interface SaveSectionInput {
  contractId: string;
  expectedRevision: number;
  section: ContractSection;
  /** definition：新的 OpenAPI 文本；其余段不传 */
  openapi?: string;
  /** changes：要覆盖写入的完整变更集（只允许影响说明等编辑字段） */
  changes?: ContractChange[];
  /** confirmations：要覆盖写入的确认集 */
  confirmations?: ConsumerConfirmation[];
  /** exemptions：单条新增豁免 */
  exemption?: Omit<Exemption, 'id' | 'definitionRevision'>;
}

export interface ReviewChangeInput {
  contractId: string;
  changeId: string;
  reviewState: ReviewState;
  reviewer: string;
  comment: string;
  expectedRevision: number;
}

export interface BulkReviewInput {
  selections: Array<{ contractId: string; changeId: string }>;
  reviewState: ReviewState;
  reviewer: string;
  comment: string;
  expectedRevisions: Record<string, number>;
}

export interface ConfirmConsumerInput {
  contractId: string;
  consumerId: string;
  confirmed: boolean;
  confirmer: string;
  comment: string;
  expectedRevision: number;
}

export interface ReleaseInput {
  contractId: string;
  expectedRevision: number;
  version: string;
  notes: string;
  /** 幂等键：发布请求失败后用同一键重试，不会产生半个或重复版本 */
  idempotencyKey: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function wait(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, LATENCY);
  });
}

/* -------------------------------------------------------------------------- */
/* 存储适配：浏览器使用 localStorage；Node 测试可注入内存实现                     */
/* -------------------------------------------------------------------------- */

export interface StorageDriver {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let driver: StorageDriver | null = null;

function storage(): StorageDriver {
  if (driver) return driver;
  if (typeof localStorage !== 'undefined') {
    driver = {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    };
  } else {
    const memory = new Map<string, string>();
    driver = {
      getItem: (key) => (memory.has(key) ? (memory.get(key) as string) : null),
      setItem: (key, value) => void memory.set(key, value),
    };
  }
  return driver;
}

/** 仅供测试：重置存储驱动并清空数据 */
export function __setStorageDriver(custom: StorageDriver | null): void {
  driver = custom;
  if (custom) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* Node 环境忽略 */
  }
}

/* -------------------------------------------------------------------------- */
/* 旧数据归一化：为历史契约补齐 revision / definitionRevision 等字段             */
/* -------------------------------------------------------------------------- */

export function normalizeContract(raw: ApiContract): ApiContract {
  const contract: ApiContract = clone(raw);
  if (typeof contract.revision !== 'number') contract.revision = 1;
  if (typeof contract.definitionRevision !== 'number') {
    contract.definitionRevision = 1;
  }
  if (!Array.isArray(contract.confirmations)) {
    contract.confirmations = contract.consumers.map((consumer) => ({
      consumerId: consumer.id,
      state: 'pending',
      confirmer: '',
      comment: '',
      definitionRevision: contract.definitionRevision,
    }));
  }
  contract.changes = contract.changes.map((change) => ({
    ...change,
    definitionRevision: change.definitionRevision ?? contract.definitionRevision,
    history: Array.isArray(change.history) ? change.history : [],
  }));
  contract.exemptions = contract.exemptions.map((exemption) => ({
    ...exemption,
    definitionRevision:
      exemption.definitionRevision ?? contract.definitionRevision,
  }));
  contract.versions = contract.versions.map((version) => ({
    ...version,
    definitionRevision: version.definitionRevision ?? 1,
    changes: Array.isArray(version.changes)
      ? version.changes
      : version.changeIds.map((changeId) => ({
          changeId,
          reviewState: 'accepted' as ReviewState,
          reviewer: '',
          reviewComment: '',
          definitionRevision: version.definitionRevision ?? 1,
        })),
    confirmations: Array.isArray(version.confirmations) ? version.confirmations : [],
    exemptions: Array.isArray(version.exemptions)
      ? version.exemptions
      : contract.exemptions
          .filter((exemption) => version.changeIds.includes(exemption.changeId))
          .map(toExemptionSnapshot),
  }));
  return contract;
}

/* -------------------------------------------------------------------------- */
/* 读取                                                                        */
/* -------------------------------------------------------------------------- */

function readContracts(): ApiContract[] {
  const stored = storage().getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ApiContract[];
      const normalized = parsed.map(normalizeContract);
      const changed = JSON.stringify(parsed) !== JSON.stringify(normalized);
      if (changed) persistContracts(normalized);
      return normalized;
    } catch {
      storage().setItem(STORAGE_KEY, '');
    }
  }
  const seeded = seedContracts.map(normalizeContract);
  persistContracts(seeded);
  return clone(seeded);
}

export async function listContracts(): Promise<ApiContract[]> {
  await wait();
  return clone(readContracts());
}

export async function getContract(id: string): Promise<ApiContract | undefined> {
  const contracts = await listContracts();
  return contracts.find((contract) => contract.id === id);
}

/* -------------------------------------------------------------------------- */
/* 并发控制核心                                                                  */
/* -------------------------------------------------------------------------- */

function assertRevision(
  contract: ApiContract,
  expectedRevision: number,
  section: ContractSection,
): void {
  if (contract.revision !== expectedRevision) {
    throw new RevisionConflictError({
      expectedRevision,
      actualRevision: contract.revision,
      server: clone(contract),
      section,
    });
  }
}

/** 定义变化时：当前定义上的旧结论归档并失效、调用方确认失效。
 *  注意：本来就针对更旧定义的失效结论保持原修订号，绝不能抬到新版冒充有效。 */
function invalidateForNewDefinition(
  contract: ApiContract,
  currentDefinitionRevision: number,
  nextRevision: number,
): void {
  const now = new Date().toISOString();
  contract.changes = contract.changes.map((change) => {
    // 只处理"绑定当前定义且有结论"的项；已失效的旧结论维持旧修订号不动
    if (change.definitionRevision !== currentDefinitionRevision) {
      return change;
    }
    if (change.reviewState !== 'pending') {
      const archived: ArchivedConclusion = {
        reviewState: change.reviewState,
        reviewer: change.reviewer,
        reviewComment: change.reviewComment,
        reviewedAt: change.reviewedAt ?? now,
        definitionRevision: change.definitionRevision,
        archivedAt: now,
      };
      return {
        ...change,
        reviewState: 'pending',
        reviewer: '',
        reviewComment: '',
        reviewedAt: undefined,
        definitionRevision: nextRevision,
        history: [archived, ...change.history].slice(0, 20),
      };
    }
    // 当前定义下仍处于待评审：跟随到新版，等同一批新结论
    return { ...change, definitionRevision: nextRevision };
  });
  contract.confirmations = contract.confirmations.map((confirmation) => ({
    ...confirmation,
    // 已确认但针对旧定义的，保留签名信息但标记为待重新确认
    state: 'pending',
    definitionRevision: nextRevision,
  }));
  // 豁免登记在具体变更上，发布时以当时的豁免快照为准，这里保留
}

function commit(
  contractId: string,
  expectedRevision: number,
  section: ContractSection,
  mutate: (
    contract: ApiContract,
    currentDefinitionRevision: number,
    nextDefinitionRevision: number,
  ) => void,
): ApiContract {
  const contracts = readContracts();
  const index = contracts.findIndex((item) => item.id === contractId);
  if (index < 0) {
    throw new Error('契约不存在');
  }
  assertRevision(contracts[index], expectedRevision, section);

  const base = contracts[index];
  const next: ApiContract = clone(base);
  const nextDefinitionRevision = base.definitionRevision + 1;
  mutate(next, base.definitionRevision, nextDefinitionRevision);
  next.revision = base.revision + 1;
  next.updatedAt = new Date().toISOString();

  // 单次写入：整份列表原子落盘，调用方拿到的永远是完整状态
  persistContracts(
    contracts.map((item) => (item.id === contractId ? next : item)),
  );
  return clone(next);
}

/** 创建契约不走冲突检查 */
export async function saveContract(updated: ApiContract): Promise<ApiContract> {
  await wait();
  const contracts = readContracts();
  const exists = contracts.some((contract) => contract.id === updated.id);
  const normalized = normalizeContract(updated);
  const now = new Date().toISOString();
  const saved: ApiContract = exists
    ? {
        ...normalized,
        revision: (contracts.find((item) => item.id === updated.id) as ApiContract)
          .revision,
        updatedAt: now,
      }
    : { ...normalized, revision: 1, updatedAt: now };
  const next = exists
    ? contracts.map((contract) => (contract.id === updated.id ? saved : contract))
    : [saved, ...contracts];
  persistContracts(next);
  return clone(saved);
}

/* -------------------------------------------------------------------------- */
/* 四类内容的分段保存                                                            */
/* -------------------------------------------------------------------------- */

export async function saveContractSection(
  input: SaveSectionInput,
): Promise<ApiContract> {
  const result = commit(
    input.contractId,
    input.expectedRevision,
    input.section,
    (draft, currentDefinitionRevision, nextDefinitionRevision) => {
      if (input.section === 'definition') {
        if (typeof input.openapi !== 'string') {
          throw new Error('保存定义必须提供 openapi 文本');
        }
        if (input.openapi !== draft.openapi) {
          draft.openapi = input.openapi;
          draft.definitionRevision = nextDefinitionRevision;
          invalidateForNewDefinition(draft, currentDefinitionRevision, nextDefinitionRevision);
        }
      } else if (input.section === 'changes') {
        if (!input.changes) throw new Error('保存逐条结论必须提供 changes');
        draft.changes = input.changes.map((change) => ({
          ...change,
          // 定义修订号以服务端为准，客户端不能伪造"仍有效"
          definitionRevision: draft.definitionRevision,
        }));
      } else if (input.section === 'confirmations') {
        if (!input.confirmations) {
          throw new Error('保存调用方确认必须提供 confirmations');
        }
        draft.confirmations = reconcileConfirmations(
          draft.consumers,
          input.confirmations,
          draft.definitionRevision,
        );
      } else if (input.section === 'exemptions') {
        if (!input.exemption) throw new Error('登记豁免必须提供 exemption 内容');
        draft.exemptions = [
          ...draft.exemptions.filter(
            (item) => item.changeId !== input.exemption!.changeId,
          ),
          {
            ...input.exemption,
            id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            definitionRevision: draft.definitionRevision,
          },
        ];
        // 登记豁免同时把对应变更结论置为 exemption
        draft.changes = draft.changes.map((change) =>
          change.id === input.exemption!.changeId
            ? {
                ...change,
                reviewState: 'exemption',
                reviewer: input.exemption!.approvedBy,
                reviewComment: input.exemption!.reason,
                reviewedAt: new Date().toISOString(),
                definitionRevision: draft.definitionRevision,
              }
            : change,
        );
      }
    },
  );
  await wait();
  return result;
}

function reconcileConfirmations(
  consumers: ApiConsumer[],
  incoming: ConsumerConfirmation[],
  definitionRevision: number,
): ConsumerConfirmation[] {
  const byId = new Map(incoming.map((item) => [item.consumerId, item]));
  return consumers.map((consumer) => {
    const item = byId.get(consumer.id);
    if (!item) {
      return {
        consumerId: consumer.id,
        state: 'pending',
        confirmer: '',
        comment: '',
        definitionRevision,
      };
    }
    return {
      ...item,
      definitionRevision,
      state: item.state === 'confirmed' ? 'confirmed' : 'pending',
    };
  });
}

/* -------------------------------------------------------------------------- */
/* 逐条结论                                                                     */
/* -------------------------------------------------------------------------- */

export async function reviewChange(input: ReviewChangeInput): Promise<ApiContract> {
  const now = new Date().toISOString();
  const result = commit(
    input.contractId,
    input.expectedRevision,
    'changes',
    (draft) => {
      draft.changes = draft.changes.map((change) =>
        change.id === input.changeId
          ? {
              ...change,
              reviewState: input.reviewState,
              reviewer: input.reviewer,
              reviewComment: input.comment,
              reviewedAt: now,
              definitionRevision: draft.definitionRevision,
              history:
                change.reviewState !== 'pending'
                  ? [
                      {
                        reviewState: change.reviewState,
                        reviewer: change.reviewer,
                        reviewComment: change.reviewComment,
                        reviewedAt: change.reviewedAt ?? now,
                        definitionRevision: change.definitionRevision,
                        archivedAt: now,
                      },
                      ...change.history,
                    ].slice(0, 20)
                  : change.history,
            }
          : change,
      );
      if (draft.status === 'draft') draft.status = 'review';
    },
  );
  await wait();
  return result;
}

export async function bulkReviewChanges(
  input: BulkReviewInput,
): Promise<ApiContract[]> {
  await wait();
  const now = new Date().toISOString();
  const contracts = readContracts();
  // 先对所有涉及的契约做冲突校验，任一冲突即整体中止，保证不会写一半
  const byContract = new Map<string, string[]>();
  input.selections.forEach((selection) => {
    byContract.set(
      selection.contractId,
      [...(byContract.get(selection.contractId) ?? []), selection.changeId],
    );
  });
  byContract.forEach((changeIds, contractId) => {
    const contract = contracts.find((item) => item.id === contractId);
    if (!contract) throw new Error('契约不存在');
    const expected = input.expectedRevisions[contractId];
    if (contract.revision !== expected) {
      throw new RevisionConflictError({
        expectedRevision: expected ?? -1,
        actualRevision: contract.revision,
        server: clone(contract),
        section: 'changes',
      });
    }
    const missing = changeIds.filter(
      (changeId) => !contract.changes.some((change) => change.id === changeId),
    );
    if (missing.length) {
      throw new Error(`变更项已不存在：${missing.join(', ')}`);
    }
  });

  const selected = new Set(
    input.selections.map((item) => `${item.contractId}:${item.changeId}`),
  );
  const next = contracts.map((contract) => {
    if (!byContract.has(contract.id)) return contract;
    const updated: ApiContract = {
      ...contract,
      revision: contract.revision + 1,
      updatedAt: now,
      status: contract.status === 'draft' ? 'review' : contract.status,
      changes: contract.changes.map((change) =>
        selected.has(`${contract.id}:${change.id}`)
          ? {
              ...change,
              reviewState: input.reviewState,
              reviewer: input.reviewer,
              reviewComment: input.comment,
              reviewedAt: now,
              definitionRevision: contract.definitionRevision,
            }
          : change,
      ),
    };
    return updated;
  });
  persistContracts(next);
  return clone(next.filter((contract) => byContract.has(contract.id)));
}

/* -------------------------------------------------------------------------- */
/* 调用方确认                                                                    */
/* -------------------------------------------------------------------------- */

export async function confirmConsumer(
  input: ConfirmConsumerInput,
): Promise<ApiContract> {
  const now = new Date().toISOString();
  const result = commit(
    input.contractId,
    input.expectedRevision,
    'confirmations',
    (draft) => {
      const exists = draft.consumers.some(
        (consumer) => consumer.id === input.consumerId,
      );
      if (!exists) throw new Error('调用方不存在');
      const existing = draft.confirmations.find(
        (item) => item.consumerId === input.consumerId,
      );
      const nextConfirmation: ConsumerConfirmation = {
        consumerId: input.consumerId,
        state: input.confirmed ? 'confirmed' : 'pending',
        confirmer: input.confirmed ? input.confirmer : '',
        comment: input.confirmed ? input.comment : '',
        definitionRevision: draft.definitionRevision,
        confirmedAt: input.confirmed ? now : undefined,
      };
      draft.confirmations = existing
        ? draft.confirmations.map((item) =>
            item.consumerId === input.consumerId ? nextConfirmation : item,
          )
        : [...draft.confirmations, nextConfirmation];
    },
  );
  await wait();
  return result;
}

/* -------------------------------------------------------------------------- */
/* 豁免                                                                         */
/* -------------------------------------------------------------------------- */

export async function addExemption(input: {
  contractId: string;
  changeId: string;
  scope: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
  expectedRevision: number;
}): Promise<ApiContract> {
  return saveContractSection({
    contractId: input.contractId,
    expectedRevision: input.expectedRevision,
    section: 'exemptions',
    exemption: {
      changeId: input.changeId,
      scope: input.scope,
      reason: input.reason,
      approvedBy: input.approvedBy,
      expiresAt: input.expiresAt,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* 发布：原子快照 + 幂等重试                                                      */
/* -------------------------------------------------------------------------- */

function toChangeSnapshot(change: ContractChange) {
  return {
    changeId: change.id,
    reviewState: change.reviewState,
    reviewer: change.reviewer,
    reviewComment: change.reviewComment,
    reviewedAt: change.reviewedAt,
    definitionRevision: change.definitionRevision,
  };
}

function toExemptionSnapshot(exemption: Exemption): ExemptionSnapshot {
  return {
    changeId: exemption.changeId,
    scope: exemption.scope,
    reason: exemption.reason,
    approvedBy: exemption.approvedBy,
    expiresAt: exemption.expiresAt,
  };
}

function toConfirmationSnapshot(
  confirmation: ConsumerConfirmation,
): ConfirmationSnapshot {
  return {
    consumerId: confirmation.consumerId,
    confirmer: confirmation.confirmer,
    comment: confirmation.comment,
    definitionRevision: confirmation.definitionRevision,
    confirmedAt: confirmation.confirmedAt,
  };
}

/** 版本内容校验值：定义 + 有效结论 + 豁免 + 确认，任一不同校验值即不同 */
export function computeReleaseChecksum(input: {
  openapi: string;
  version: string;
  changes: Array<{
    changeId: string;
    reviewState: string;
    reviewer: string;
    reviewComment: string;
    definitionRevision: number;
  }>;
  confirmations: ConfirmationSnapshot[];
  exemptions: ExemptionSnapshot[];
}): string {
  const payload = JSON.stringify({
    version: input.version,
    openapi: input.openapi,
    changes: input.changes
      .map((item) => `${item.changeId}@${item.definitionRevision}:${item.reviewState}:${item.reviewer}:${item.reviewComment}`)
      .sort(),
    confirmations: input.confirmations
      .map((item) => `${item.consumerId}@${item.definitionRevision}:${item.confirmer}:${item.comment}`)
      .sort(),
    exemptions: input.exemptions
      .map((item) => `${item.changeId}:${item.scope}:${item.reason}:${item.approvedBy}:${item.expiresAt}`)
      .sort(),
  });
  return stableChecksum(payload);
}

export async function freezeVersion(input: ReleaseInput): Promise<ApiContract> {
  await wait();
  const contracts = readContracts();
  const index = contracts.findIndex((item) => item.id === input.contractId);
  if (index < 0) throw new Error('契约不存在');
  const contract = contracts[index];
  const releaseId = `rel-${input.idempotencyKey}`;

  // 幂等：同一幂等键的重试直接返回已发布结果。
  // 注意重试时本地 revision 可能已落后（例如失败发生在落盘之后、响应之前），
  // 因此幂等命中优先于 revision 检查，绝不留下第二个/半个版本。
  if (contract.versions.some((version) => version.id === releaseId)) {
    return clone(contract);
  }

  // 乐观并发：对方在你打开发布页后保存过，需要先刷新确认
  assertRevision(contract, input.expectedRevision, 'definition');

  if (!input.version.trim()) throw new Error('版本号不能为空');
  if (
    contract.versions.some((version) => version.version === input.version.trim())
  ) {
    throw new Error(`版本 ${input.version.trim()} 已存在，请使用新的版本号`);
  }

  // 发布前门禁在服务端复核：只打包当前定义下仍有效的结论与确认
  const blockers = validateForRelease(contract).filter(
    (issue) => issue.severity === 'blocker',
  );
  if (blockers.length) {
    throw new Error(`发布门禁未通过：${blockers[0].title}（${blockers[0].detail}）`);
  }

  const currentChanges = contract.changes.filter((change) =>
    isConclusionCurrent(change, contract),
  );
  const currentConfirmations = contract.confirmations
    .filter((item) => item.state === 'confirmed' && item.consumerId)
    .filter((item) => item.definitionRevision >= contract.definitionRevision);
  const changeSnapshots = currentChanges.map(toChangeSnapshot);
  const confirmationSnapshots = currentConfirmations.map(toConfirmationSnapshot);
  const exemptionSnapshots = contract.exemptions.map(toExemptionSnapshot);

  const release: ContractVersion = {
    id: releaseId,
    contractId: input.contractId,
    version: input.version.trim(),
    releasedAt: new Date().toISOString(),
    checksum: computeReleaseChecksum({
      version: input.version.trim(),
      openapi: contract.openapi,
      changes: changeSnapshots,
      confirmations: confirmationSnapshots,
      exemptions: exemptionSnapshots,
    }),
    notes: input.notes,
    changeIds: changeSnapshots.map((item) => item.changeId),
    definitionRevision: contract.definitionRevision,
    openapi: contract.openapi,
    changes: changeSnapshots,
    confirmations: confirmationSnapshots,
    exemptions: exemptionSnapshots,
  };

  const updated: ApiContract = {
    ...contract,
    revision: contract.revision + 1,
    version: release.version,
    status: 'frozen',
    versions: [release, ...contract.versions],
    updatedAt: release.releasedAt,
  };

  // 版本对象与契约状态在同一次写入中落盘——不存在"版本建了一半"
  persistContracts(
    contracts.map((item) => (item.id === input.contractId ? updated : item)),
  );
  return clone(updated);
}

function persistContracts(contracts: ApiContract[]): void {
  storage().setItem(STORAGE_KEY, JSON.stringify(contracts));
}

/* -------------------------------------------------------------------------- */
/* 报告与示例（纯函数）                                                           */
/* -------------------------------------------------------------------------- */

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
  const finalVersion = contract.versions[0];
  const staleChanges = contract.changes.filter(
    (change) => !isConclusionCurrent(change, contract),
  );
  const unconfirmedConsumers = contract.consumers.filter((consumer) => {
    const confirmation = contract.confirmations.find(
      (item) => item.consumerId === consumer.id,
    );
    return !confirmation || !isConclusionCurrentSafe(confirmation, contract);
  });

  const lines = [
    `# ${contract.name} ${contract.version} 契约变更报告`,
    '',
    `- 领域：${contract.domain}`,
    `- 负责人：${contract.owner}`,
    `- 状态：${contract.status}`,
    `- 当前定义修订：第 ${contract.definitionRevision} 版`,
    `- 最终发布版本：${finalVersion ? `v${finalVersion.version}（${formatDateTime(finalVersion.releasedAt)} · ${finalVersion.checksum}）` : '尚无正式版本'}`,
    `- 生成时间：${new Date().toISOString()}`,
    '',
    '## 待确认项（与评审队列、发布页同源）',
    ...(staleChanges.length === 0 && unconfirmedConsumers.length === 0
      ? ['- 无，当前定义下所有结论与调用方确认均有效。']
      : [
          ...staleChanges.map(
            (change) =>
              `- [重新评审] ${change.method} ${change.path}：结论基于第 ${change.definitionRevision} 版定义，已失效`,
          ),
          ...unconfirmedConsumers.map(
            (consumer) => `- [调用方确认] ${consumer.name}（${consumer.clientVersion}）未确认第 ${contract.definitionRevision} 版定义`,
          ),
        ]),
    '',
    '## 变更明细',
    ...contract.changes.flatMap((change) => {
      const current = isConclusionCurrent(change, contract);
      return [
        `### ${change.method} ${change.path} - ${change.kind}`,
        `- 结论有效性：${current ? `有效（针对第 ${change.definitionRevision} 版定义）` : `已失效（结论针对第 ${change.definitionRevision} 版，当前第 ${contract.definitionRevision} 版，需重新确认）`}`,
        `- 兼容性：${change.compatibility}`,
        `- 变更前：${change.before}`,
        `- 变更后：${change.after}`,
        `- 判定依据：${change.rationale}`,
        `- 调用方影响：${change.impactStatement || '未填写'}`,
        `- 迁移方案：${change.migrationPlan || '未填写'}`,
        `- 评审结论：${change.reviewState}${change.reviewer ? `（${change.reviewer}）` : ''}`,
        ...(change.history.length
          ? [
              `- 历史结论：`,
              ...change.history.map(
                (item) =>
                  `  - 第 ${item.definitionRevision} 版 · ${item.reviewState} · ${item.reviewer} · ${item.reviewComment}`,
              ),
            ]
          : []),
        '',
      ];
    }),
    '## 调用方确认',
    ...contract.consumers.map((consumer) => {
      const confirmation = contract.confirmations.find(
        (item) => item.consumerId === consumer.id,
      );
      const current = confirmation
        ? isConclusionCurrentSafe(confirmation, contract)
        : false;
      const who = confirmation?.confirmer ? ` / ${confirmation.confirmer}` : '';
      const comment = confirmation?.comment ? ` / ${confirmation.comment}` : '';
      return `- ${consumer.name} / ${consumer.owner} / ${consumer.environment} / ${consumer.clientVersion}：${
        current
          ? `已确认第 ${confirmation?.definitionRevision} 版${who}${comment}`
          : `待确认第 ${contract.definitionRevision} 版`
      }`;
    }),
    '',
    '## 豁免记录',
    ...(contract.exemptions.length
      ? contract.exemptions.map(
          (item) =>
            `- ${item.scope}：${item.reason}（批准人 ${item.approvedBy}，至 ${item.expiresAt}，登记于第 ${item.definitionRevision} 版定义）`,
        )
      : ['- 无']),
    '',
    '## 最终版本',
    ...(finalVersion
      ? [
          `### v${finalVersion.version}`,
          `- 发布时间：${formatDateTime(finalVersion.releasedAt)}`,
          `- 定义修订：第 ${finalVersion.definitionRevision} 版`,
          `- 校验值：${finalVersion.checksum}`,
          `- 发布说明：${finalVersion.notes}`,
          `- 随版结论（${finalVersion.changes.length} 条）：`,
          ...finalVersion.changes.map(
            (item) =>
              `  - ${item.changeId}：${item.reviewState}（${item.reviewer || '未署名'}）针对第 ${item.definitionRevision} 版`,
          ),
          `- 随版调用方确认（${finalVersion.confirmations.length} 条）：`,
          ...finalVersion.confirmations.map(
            (item) => `  - ${item.consumerId}：${item.confirmer}`,
          ),
          `- 随版豁免（${finalVersion.exemptions.length} 条）：`,
          ...(finalVersion.exemptions.length
            ? finalVersion.exemptions.map((item) => `  - ${item.changeId}：${item.scope}`)
            : ['  - 无']),
        ]
      : ['- 尚无不可变正式版本。']),
  ];
  return lines.join('\n');
}

function isConclusionCurrentSafe(
  confirmation: ConsumerConfirmation,
  contract: ApiContract,
): boolean {
  return (
    confirmation.state === 'confirmed' &&
    confirmation.definitionRevision >= contract.definitionRevision
  );
}

export function diffVersionSummary(contract: ApiContract): string {
  const previous = contract.versions[0];
  if (!previous) {
    return '无可比较的历史正式版本。';
  }
  return [
    `最终版本 v${previous.version}`,
    `发布于 ${formatDateTime(previous.releasedAt)}`,
    `校验值 ${previous.checksum}`,
    `随版有效结论 ${previous.changes.length} 项 / 豁免 ${previous.exemptions.length} 条 / 调用方确认 ${previous.confirmations.length} 方`,
    `当前工作副本定义第 ${contract.definitionRevision} 版，版本基于第 ${previous.definitionRevision} 版`,
  ].join('\n');
}
