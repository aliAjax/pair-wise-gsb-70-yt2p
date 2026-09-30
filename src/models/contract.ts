export type ContractStatus = 'draft' | 'review' | 'ready' | 'released' | 'frozen';
export type ChangeKind =
  | 'field_added'
  | 'field_removed'
  | 'optionality_changed'
  | 'enum_expanded'
  | 'error_code_added'
  | 'error_code_removed';
export type Compatibility = 'compatible' | 'warning' | 'breaking';
export type ReviewState = 'pending' | 'accepted' | 'returned' | 'exemption';

/** 可并发编辑的四个区段，冲突检测与自动合并都以区段为粒度。 */
export type EditSection = 'definition' | 'reviews' | 'consumers' | 'exemptions';

export interface ConsumerConfirmation {
  state: 'confirmed';
  confirmedBy: string;
  confirmedAt: string;
  /** 确认所基于的定义版本，低于契约当前定义版本即视为失效。 */
  definitionVersion: number;
  comment: string;
}

export interface ContractChange {
  id: string;
  path: string;
  method: string;
  kind: ChangeKind;
  before: string;
  after: string;
  compatibility: Compatibility;
  rationale: string;
  impactStatement: string;
  migrationPlan: string;
  reviewState: ReviewState;
  reviewer: string;
  reviewComment: string;
  reviewedAt?: string;
  /** 结论基于的定义版本。 */
  definitionVersion?: number;
  /** 定义变更后旧结论被置为失效，等待重新确认。 */
  invalidatedByDefinition?: boolean;
}

export interface ApiConsumer {
  id: string;
  name: string;
  owner: string;
  environment: '生产' | '预发' | '灰度';
  clientVersion: string;
  requestsPerDay: number;
  contact: string;
  confirmation?: ConsumerConfirmation;
}

export interface Exemption {
  id: string;
  changeId: string;
  scope: string;
  reason: string;
  approvedBy: string;
  expiresAt: string;
  /** 登记时对应的定义版本；定义变更后豁免被作废（active=false），记录保留。 */
  definitionVersion?: number;
  active?: boolean;
  voidedAt?: string;
  voidReason?: string;
}

export interface ContractVersion {
  id: string;
  contractId: string;
  version: string;
  releasedAt: string;
  checksum: string;
  notes: string;
  changeIds: string[];
  openapi: string;
  /** 以下为不可变快照字段，发布时刻一次性固化，之后不再随工作副本变化。 */
  definitionVersion?: number;
  contractRevision?: number;
  validChangeIds?: string[];
  changes?: ContractChange[];
  exemptions?: Exemption[];
  consumers?: ApiConsumer[];
  immutable?: boolean;
  publishedBy?: string;
}

export interface ApiContract {
  id: string;
  name: string;
  version: string;
  domain: string;
  owner: string;
  protocol: 'REST' | 'GraphQL' | 'gRPC-Web';
  status: ContractStatus;
  updatedAt: string;
  openapi: string;
  changes: ContractChange[];
  consumers: ApiConsumer[];
  exemptions: Exemption[];
  versions: ContractVersion[];
  /** 乐观锁修订号，每次写入 +1。 */
  revision: number;
  /** 契约定义版本，openapi 内容变化时 +1，并级联失效结论/豁免/调用方确认。 */
  definitionVersion: number;
  definitionUpdatedAt?: string;
  lastEditedBy?: string;
}

export interface ReleaseIssue {
  id: string;
  severity: 'blocker' | 'warning';
  title: string;
  detail: string;
  changeId?: string;
  consumerId?: string;
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  field_added: '新增字段',
  field_removed: '删除字段',
  optionality_changed: '可选性变化',
  enum_expanded: '枚举扩展',
  error_code_added: '新增错误码',
  error_code_removed: '删除错误码',
};

export const COMPATIBILITY_LABELS: Record<Compatibility, string> = {
  compatible: '兼容',
  warning: '警告',
  breaking: '不兼容',
};

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  pending: '待评审',
  accepted: '已接受',
  returned: '已退回',
  exemption: '兼容层豁免',
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: '草稿',
  review: '评审中',
  ready: '待发布',
  released: '已发布',
  frozen: '已冻结',
};

export const SECTION_LABELS: Record<EditSection, string> = {
  definition: '契约定义',
  reviews: '逐条结论',
  consumers: '调用方确认',
  exemptions: '兼容层豁免',
};

export function classifyChange(input: {
  kind: ChangeKind;
  before: string;
  after: string;
}): { compatibility: Compatibility; rationale: string } {
  switch (input.kind) {
    case 'field_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除字段会使仍读取该字段的客户端解析失败或业务判断缺失。',
      };
    case 'error_code_removed':
      return {
        compatibility: 'breaking',
        rationale: '删除错误码会破坏调用方基于错误码建立的分支与重试策略。',
      };
    case 'field_added':
      if (/required/i.test(input.after) || /必填/.test(input.after)) {
        return {
          compatibility: 'breaking',
          rationale: '新增必填字段要求现有调用方立即修改请求。',
        };
      }
      return {
        compatibility: 'compatible',
        rationale: '新增可选字段不会改变现有请求和响应结构。',
      };
    case 'optionality_changed':
      if (/可选.*必填|optional.*required/i.test(`${input.before} ${input.after}`)) {
        return {
          compatibility: 'breaking',
          rationale: '字段从可选变为必填，现有调用方可能不再满足请求约束。',
        };
      }
      return {
        compatibility: 'warning',
        rationale: '字段从必填变为可选会改变调用方对响应完整性的假设。',
      };
    case 'enum_expanded':
      return {
        compatibility: 'warning',
        rationale: '新增枚举值可能使未实现默认分支的客户端出现解析或展示异常。',
      };
    case 'error_code_added':
      return {
        compatibility: 'warning',
        rationale: '调用方应明确新错误码的展示和重试策略。',
      };
  }
}

/** 结论是否因定义变更而失效，需要重新确认。 */
export function isChangeStale(change: ContractChange, definitionVersion: number): boolean {
  return (
    change.invalidatedByDefinition === true ||
    (change.definitionVersion ?? 1) < definitionVersion
  );
}

/** 调用方是否尚未在当前定义版本上完成确认。 */
export function isConsumerUnconfirmed(
  consumer: ApiConsumer,
  definitionVersion: number,
): boolean {
  const confirmation = consumer.confirmation;
  return (
    !confirmation ||
    confirmation.state !== 'confirmed' ||
    (confirmation.definitionVersion ?? 0) < definitionVersion
  );
}

/** 豁免是否对当前定义版本仍然有效。 */
export function isExemptionActive(exemption: Exemption, definitionVersion: number): boolean {
  return (
    exemption.active !== false &&
    (exemption.definitionVersion ?? 1) >= definitionVersion
  );
}

export function activeExemptions(contract: ApiContract): Exemption[] {
  return contract.exemptions.filter((item) =>
    isExemptionActive(item, contract.definitionVersion),
  );
}

export function validChanges(contract: ApiContract): ContractChange[] {
  return contract.changes.filter(
    (change) =>
      change.reviewState !== 'pending' &&
      !isChangeStale(change, contract.definitionVersion),
  );
}

/**
 * 把旧版本（或种子数据）补齐并发控制所需字段。读取时统一归一化，
 * 保证模型里 revision / definitionVersion 始终可用。
 */
export function normalizeContract(input: Partial<ApiContract> & { id: string }): ApiContract {
  const definitionVersion = input.definitionVersion ?? 1;
  const normalized: ApiContract = {
    id: input.id,
    name: input.name ?? input.id,
    version: input.version ?? '0.0.0',
    domain: input.domain ?? '未分类',
    owner: input.owner ?? '未指派',
    protocol: input.protocol ?? 'REST',
    status: input.status ?? 'draft',
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    openapi: input.openapi ?? '',
    changes: [],
    consumers: [],
    exemptions: [],
    versions: [],
    revision: input.revision ?? 1,
    definitionVersion,
    definitionUpdatedAt: input.definitionUpdatedAt,
    lastEditedBy: input.lastEditedBy,
  };
  Object.assign(normalized, input, { revision: normalized.revision, definitionVersion });
  normalized.changes = (input.changes ?? []).map((change) => ({
    ...change,
    definitionVersion: change.definitionVersion ?? definitionVersion,
    invalidatedByDefinition: change.invalidatedByDefinition ?? false,
  }));
  normalized.consumers = (input.consumers ?? []).map((consumer) => ({ ...consumer }));
  normalized.exemptions = (input.exemptions ?? []).map((item) => ({
    ...item,
    active: item.active ?? true,
    definitionVersion: item.definitionVersion ?? definitionVersion,
  }));
  normalized.versions = (input.versions ?? []).map((version) => ({ ...version }));
  return normalized;
}

export { validateForRelease } from './review';
