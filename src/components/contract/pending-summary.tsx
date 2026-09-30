import { AlertTriangle, Clock3, RotateCcw, Users } from 'lucide-react';
import { Badge } from '../ui/badge';
import {
  isChangeStale,
  type ApiContract,
} from '../../models/contract';
import { pendingSummary } from '../../models/review';

/** 定义变更后旧结论失效的标记。 */
export function StaleBadge({ className }: { className?: string }) {
  return (
    <Badge tone="amber" className={className}>
      <RotateCcw className="mr-1 h-3 w-3" />
      定义已变更 · 待重新确认
    </Badge>
  );
}

export function ChangeStateBadge({
  change,
  definitionVersion,
}: {
  change: ApiContract['changes'][number];
  definitionVersion: number;
}) {
  if (isChangeStale(change, definitionVersion)) {
    return <StaleBadge />;
  }
  return null;
}

/**
 * 评审队列、发布页、报告共用的待确认摘要，
 * 数据全部来自 models/review 的同一份 getPendingItems。
 */
export function PendingSummary({ contract }: { contract: ApiContract }) {
  const summary = pendingSummary(contract);
  const done = summary.total === 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={done ? 'green' : 'amber'}>
        {done ? '待确认项已清空' : `${summary.total} 项待确认`}
      </Badge>
      {(summary.staleChanges > 0 || summary.pendingChanges > 0) && (
        <Badge tone="neutral" className="gap-1">
          {summary.staleChanges > 0 ? (
            <>
              <AlertTriangle className="h-3 w-3" />
              {summary.staleChanges} 项结论失效
            </>
          ) : null}
          {summary.staleChanges > 0 && summary.pendingChanges > 0 ? '，' : null}
          {summary.pendingChanges > 0 ? (
            <>
              <Clock3 className="ml-1 h-3 w-3" />
              {summary.pendingChanges} 项待评审
            </>
          ) : null}
        </Badge>
      )}
      <Badge tone={summary.consumers ? 'red' : 'green'} className="gap-1">
        <Users className="h-3 w-3" />
        {summary.consumers ? `${summary.consumers} 个调用方待确认` : '调用方已确认'}
      </Badge>
    </div>
  );
}
