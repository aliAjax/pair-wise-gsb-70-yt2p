import { Check, CornerUpLeft, Layers3, RotateCcw, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  CHANGE_KIND_LABELS,
  type ContractChange,
  type ReviewState,
} from '../../models/contract';
import { useDraftStore, type ChangeDraft } from '../../store/draft-store';
import { CompatibilityBadge, ReviewStateBadge } from './compatibility-badge';
import { StaleBadge } from './pending-summary';

interface ChangeReviewItemProps {
  change: ContractChange;
  definitionVersion: number;
  saving: boolean;
  onReview: (changeId: string, state: ReviewState, comment: string) => void;
  onSaveTexts: (
    changeId: string,
    patch: Pick<ContractChange, 'impactStatement' | 'migrationPlan'>,
  ) => void;
  onExemption: (changeId: string, reason: string) => void;
}

export function ChangeReviewItem({
  change,
  definitionVersion,
  saving,
  onReview,
  onSaveTexts,
  onExemption,
}: ChangeReviewItemProps) {
  const stale =
    change.invalidatedByDefinition === true ||
    (change.definitionVersion ?? 1) < definitionVersion;
  const draftKey = `${change.id}`;
  const draft = useDraftStore((state) =>
    Object.prototype.hasOwnProperty.call(state.changes, draftKey)
      ? state.changes[draftKey]
      : undefined,
  );
  const saveDraft = useDraftStore((state) => state.saveChangeDraft);
  const clearDraft = useDraftStore((state) => state.clearChangeDraft);

  const [comment, setComment] = useState(draft?.comment ?? change.reviewComment);
  const [impact, setImpact] = useState(draft?.impactStatement ?? change.impactStatement);
  const [migration, setMigration] = useState(draft?.migrationPlan ?? change.migrationPlan);
  const [exemptionReason, setExemptionReason] = useState(draft?.exemptionReason ?? '');
  const [showExemption, setShowExemption] = useState(false);
  const touched = useRef(false);

  // 对方保存了新数据：本地没动过就跟随，本地有草稿则保留。
  useEffect(() => {
    if (!touched.current && !draft) {
      setComment(change.reviewComment);
      setImpact(change.impactStatement);
      setMigration(change.migrationPlan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change.id, change.reviewComment, change.impactStatement, change.migrationPlan]);

  const patchDraft = (patch: Partial<ChangeDraft>) => {
    touched.current = true;
    saveDraft(change.id, patch);
  };

  return (
    <article className="border-b border-slate-200 px-4 py-4 last:border-0">
      {stale && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            契约定义已更新到第 {definitionVersion} 版，该条结论基于第{' '}
            {change.definitionVersion ?? 1} 版定义，旧结论已失效。请查看最新差异后重新接受、退回或登记豁免；
            下方影响说明与迁移方案草稿会保留。
          </div>
        </div>
      )}

      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-sky-900">
              {change.method} {change.path}
            </span>
            <CompatibilityBadge value={change.compatibility} />
            {stale ? <StaleBadge /> : <ReviewStateBadge value={change.reviewState} />}
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

      {change.compatibility !== 'compatible' && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              调用方影响说明
            </label>
            <Textarea
              value={impact}
              onChange={(event) => {
                setImpact(event.target.value);
                patchDraft({ impactStatement: event.target.value });
              }}
              placeholder="受影响调用方、版本、流量和业务影响"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">迁移方案</label>
            <Textarea
              value={migration}
              onChange={(event) => {
                setMigration(event.target.value);
                patchDraft({ migrationPlan: event.target.value });
              }}
              placeholder="升级顺序、兼容层范围、回滚和截止时间"
            />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            {stale ? '重新确认的评审意见' : '评审意见'}
          </label>
          <Textarea
            className="min-h-16"
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
              patchDraft({ comment: event.target.value });
            }}
            placeholder="说明接受、退回或豁免的依据"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => {
              onSaveTexts(change.id, {
                impactStatement: impact,
                migrationPlan: migration,
              });
              clearDraft(change.id);
            }}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中' : '保存说明草稿'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() =>
              onReview(change.id, 'returned', comment || '需要补充影响说明')
            }
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
            {stale ? '重新退回' : '退回'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowExemption((value) => !value)}
          >
            <Layers3 className="h-3.5 w-3.5" />
            申请兼容层
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={() => onReview(change.id, 'accepted', comment || '影响和迁移方案已确认')}
          >
            <Check className="h-4 w-4" />
            {stale ? '重新确认接受' : '接受'}
          </Button>
        </div>
      </div>

      {showExemption && (
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">兼容层豁免</Badge>
            <span className="text-xs text-blue-900">
              豁免登记在第 {definitionVersion} 版定义上，期限 30 天；定义再变会自动作废。
            </span>
          </div>
          <Textarea
            className="mt-3 bg-white"
            value={exemptionReason}
            onChange={(event) => {
              setExemptionReason(event.target.value);
              patchDraft({ exemptionReason: event.target.value });
            }}
            placeholder="说明为什么不能立即移除不兼容变化"
          />
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              disabled={!exemptionReason.trim() || saving}
              onClick={() => {
                onExemption(change.id, exemptionReason);
                setExemptionReason('');
                setShowExemption(false);
                clearDraft(change.id);
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
