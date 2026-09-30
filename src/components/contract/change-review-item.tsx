import { Check, CornerUpLeft, History, Layers3, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import {
  CHANGE_KIND_LABELS,
  type ContractChange,
  type ReviewState,
} from '../../models/contract';
import { CompatibilityBadge, ReviewStateBadge } from './compatibility-badge';
import { useDraftStore } from '../../store/draft-store';

interface ChangeReviewItemProps {
  contractId: string;
  change: ContractChange;
  currentDefinitionRevision: number;
  serverRevision: number;
  saving: boolean;
  onReview: (changeId: string, state: ReviewState, comment: string) => Promise<void>;
  onUpdate: (
    changeId: string,
    patch: Partial<ContractChange>,
  ) => Promise<void> | void;
  onExemption: (input: {
    changeId: string;
    scope: string;
    reason: string;
    expiresAt: string;
  }) => Promise<void>;
}

export function ChangeReviewItem({
  contractId,
  change,
  currentDefinitionRevision,
  serverRevision,
  saving,
  onReview,
  onUpdate,
  onExemption,
}: ChangeReviewItemProps) {
  const saveChangeDraft = useDraftStore((state) => state.saveChangeDraft);
  const takeChangeDraft = useDraftStore((state) => state.takeChangeDraft);

  const [comment, setComment] = useState(change.reviewComment);
  const [impact, setImpact] = useState(change.impactStatement);
  const [migration, setMigration] = useState(change.migrationPlan);
  const [exemptionReason, setExemptionReason] = useState('');
  const [exemptionScope, setExemptionScope] = useState(change.path);
  const [exemptionExpiresAt, setExemptionExpiresAt] = useState(defaultExpiry());
  const [showExemption, setShowExemption] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const stale = change.definitionRevision < currentDefinitionRevision;

  // 服务端数据因对方保存/冲突后刷新而变化时，尝试恢复保留的草稿
  useEffect(() => {
    const draft = takeChangeDraft(contractId, change.id);
    if (draft) {
      if (draft.impactStatement !== undefined) setImpact(draft.impactStatement);
      if (draft.migrationPlan !== undefined) setMigration(draft.migrationPlan);
      if (draft.reviewComment !== undefined) setComment(draft.reviewComment);
      setDraftRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRevision]);

  function persistDraft() {
    saveChangeDraft(contractId, change.id, {
      impactStatement: impact,
      migrationPlan: migration,
      reviewComment: comment,
    });
  }

  return (
    <article
      className={
        stale
          ? 'border-b border-amber-200 bg-amber-50/40 px-4 py-4 last:border-0'
          : 'border-b border-slate-200 px-4 py-4 last:border-0'
      }
    >
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-sky-900">
              {change.method} {change.path}
            </span>
            <CompatibilityBadge value={change.compatibility} />
            <ReviewStateBadge value={stale ? 'pending' : change.reviewState} />
            {stale && <Badge tone="amber">结论已失效 · 需重新确认</Badge>}
            <span className="text-[10px] text-slate-400">
              结论基于第 {change.definitionRevision} 版 / 当前第 {currentDefinitionRevision} 版
            </span>
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">
            {CHANGE_KIND_LABELS[change.kind]}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {change.rationale}
          </p>
        </div>
        <div className="text-left text-xs text-slate-500 lg:text-right">
          <div>评审人：{change.reviewer || '未指定'}</div>
          <div className="mt-1">结论：{change.reviewComment || '尚无意见'}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            变更前
          </span>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-5 text-slate-700">
            {change.before}
          </pre>
        </div>
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">
            变更后
          </span>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs leading-5 text-sky-950">
            {change.after}
          </pre>
        </div>
      </div>

      {stale && change.history.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <History className="h-3.5 w-3.5" />
            旧定义下的历史结论（不再作为发布依据）
          </div>
          <ul className="mt-2 space-y-1 text-[11px] leading-5 text-amber-900">
            {change.history.slice(0, 3).map((item, index) => (
              <li key={index}>
                第 {item.definitionRevision} 版 · {item.reviewState} · {item.reviewer}：
                {item.reviewComment}
              </li>
            ))}
          </ul>
        </div>
      )}

      {change.compatibility !== 'compatible' && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              调用方影响说明
            </label>
            <Textarea
              value={impact}
              onChange={(event) => setImpact(event.target.value)}
              placeholder="受影响调用方、版本、流量和业务影响"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">迁移方案</label>
            <Textarea
              value={migration}
              onChange={(event) => setMigration(event.target.value)}
              placeholder="升级顺序、兼容层范围、回滚和截止时间"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">评审意见</label>
          <Textarea
            className="min-h-16"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={stale ? '定义已更新，请基于当前定义重新给出结论' : '说明接受、退回或豁免的依据'}
          />
          {draftRestored && (
            <p className="mt-1 text-[11px] text-amber-700">
              已恢复你上次保存失败时的草稿，确认内容后重新提交。
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={async () => {
              try {
                await onUpdate(change.id, {
                  impactStatement: impact,
                  migrationPlan: migration,
                });
              } catch {
                persistDraft();
              }
            }}
          >
            <Save className="h-3.5 w-3.5" />
            保存说明
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={async () => {
              try {
                await onReview(
                  change.id,
                  'returned',
                  comment || '需要补充影响说明',
                );
              } catch {
                persistDraft();
              }
            }}
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
            退回
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => setShowExemption((value) => !value)}
          >
            <Layers3 className="h-3.5 w-3.5" />
            申请兼容层
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              try {
                await onReview(
                  change.id,
                  'accepted',
                  comment || '影响和迁移方案已确认',
                );
              } catch {
                persistDraft();
              }
            }}
          >
            <Check className="h-3.5 w-3.5" />
            {stale ? '重新确认接受' : '接受'}
          </Button>
        </div>
      </div>

      {showExemption && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">兼容层豁免</Badge>
            <span className="text-xs text-blue-900">随发布版本快照归档，需填写范围与到期日</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              className="bg-white"
              value={exemptionScope}
              onChange={(event) => setExemptionScope(event.target.value)}
              placeholder="兼容层范围，例如 取消订单 requestId 校验"
            />
            <Input
              className="bg-white"
              type="date"
              value={exemptionExpiresAt}
              onChange={(event) => setExemptionExpiresAt(event.target.value)}
            />
          </div>
          <Textarea
            className="mt-2 bg-white"
            value={exemptionReason}
            onChange={(event) => setExemptionReason(event.target.value)}
            placeholder="说明为什么不能立即移除不兼容变化"
          />
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={!exemptionReason.trim() || !exemptionScope.trim() || !exemptionExpiresAt || saving}
              onClick={async () => {
                try {
                  await onExemption({
                    changeId: change.id,
                    scope: exemptionScope.trim(),
                    reason: exemptionReason.trim(),
                    expiresAt: exemptionExpiresAt,
                  });
                  setExemptionReason('');
                  setShowExemption(false);
                } catch {
                  // 冲突时保留豁免表单内容，等页面刷新到最新版后重试
                }
              }}
            >
              登记豁免
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function defaultExpiry(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
