import { Link } from '@tanstack/react-router';
import {
  Check,
  CornerUpLeft,
  Filter,
  ListChecks,
  RotateCcw,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { CompatibilityBadge, ReviewStateBadge } from '../components/contract/compatibility-badge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Checkbox } from '../components/ui/checkbox';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import {
  CHANGE_KIND_LABELS,
  REVIEW_STATE_LABELS,
  type ReviewState,
} from '../models/contract';
import { useBulkReview, useContracts } from '../services/contract-queries';
import {
  pendingItems,
  type PendingChangeItem,
  type PendingConsumerItem,
  type PendingItem,
} from '../services/review-derivation';
import { useConflictStore } from '../store/conflict-store';
import { useReviewStore } from '../store/review-store';

type QueueFilter = ReviewState | 'all' | 'stale' | 'consumer';

export function ReviewQueuePage() {
  const contracts = useContracts();
  const bulkReview = useBulkReview();
  const setReviewStateFilter = useReviewStore((state) => state.setReviewStateFilter);
  const selection = useReviewStore((state) => state.selection);
  const toggleSelection = useReviewStore((state) => state.toggleSelection);
  const clearSelection = useReviewStore((state) => state.clearSelection);
  const selectMany = useReviewStore((state) => state.selectMany);
  const reportConflict = useConflictStore((state) => state.reportConflict);
  const [query, setQuery] = useState('');
  const [localFilter, setLocalFilter] = useState<QueueFilter>('all');
  const [reviewer, setReviewer] = useState('当前评审人');
  const [comment, setComment] = useState('');

  const queue = useMemo<PendingItem[]>(() => {
    const items = pendingItems(contracts.data ?? []);
    const keyword = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesKeyword =
        !keyword ||
        `${item.contractName} ${item.kind === 'change' ? `${item.change.path} ${item.change.method}` : item.consumerName}`
          .toLowerCase()
          .includes(keyword);
      if (!matchesKeyword) return false;
      if (localFilter === 'all') return true;
      if (localFilter === 'stale') return item.stale;
      if (localFilter === 'consumer') return item.kind === 'consumer';
      if (item.kind !== 'change') return false;
      return item.change.reviewState === localFilter;
    });
  }, [contracts.data, query, localFilter]);

  // 按不兼容程度排序，调用方确认项排在同契约变更之后
  const sortedQueue = useMemo(() => {
    const rank = { breaking: 0, warning: 1, compatible: 2 };
    return [...queue].sort((left, right) => {
      if (left.contractId !== right.contractId) return left.contractId.localeCompare(right.contractId);
      if (left.kind === 'consumer' || right.kind === 'consumer') {
        return left.kind === right.kind ? 0 : left.kind === 'consumer' ? 1 : -1;
      }
      return (
        rank[(left as PendingChangeItem).change.compatibility] -
        rank[(right as PendingChangeItem).change.compatibility]
      );
    });
  }, [queue]);

  const selectedKeys = new Set(
    selection.map((item) => `${item.contractId}:${item.changeId}`),
  );

  const selectableItems = sortedQueue.filter(
    (item): item is PendingChangeItem => item.kind === 'change',
  );

  function selectAllVisible() {
    if (
      selectableItems.length > 0 &&
      selectableItems.every((item) => selectedKeys.has(`${item.contractId}:${item.change.id}`))
    ) {
      selectMany([]);
      return;
    }
    selectMany(
      selectableItems.map((item) => ({
        contractId: item.contractId,
        changeId: item.change.id,
      })),
    );
  }

  async function submitBulk(state: ReviewState) {
    if (!selection.length || !comment.trim()) return;
    const revisionById: Record<string, number> = {};
    (contracts.data ?? []).forEach((contract) => {
      revisionById[contract.id] = contract.revision;
    });
    try {
      await bulkReview.mutateAsync({
        selections: selection,
        state,
        reviewer: reviewer.trim() || '当前评审人',
        comment: comment.trim(),
        expectedRevisions: revisionById,
      });
      clearSelection();
      setComment('');
    } catch (error) {
      reportConflict(error, `批量${state === 'accepted' ? '接受' : '退回'} ${selection.length} 项结论`);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Review Queue</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          待确认队列（变更结论 + 调用方确认）
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          与发布页、变更报告同源：只列出当前定义下需要首次确认或重新确认的项。
          定义变更冲掉的旧结论会置顶并要求重新评审；批量保存带修订号，撞上新提交不会覆盖对方。
        </p>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle>评审队列</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {sortedQueue.length} 个待确认项（含 {sortedQueue.filter((item) => item.kind === 'consumer').length} 方调用方）
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="契约、路径、方法或调用方"
              />
              <Select
                value={localFilter}
                onValueChange={(value) => {
                  setLocalFilter(value as QueueFilter);
                  if (
                    ['pending', 'accepted', 'returned', 'exemption', 'all'].includes(value)
                  ) {
                    setReviewStateFilter(value as ReviewState | 'all');
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部待确认项</SelectItem>
                  <SelectItem value="stale">仅被定义冲掉需重新确认</SelectItem>
                  <SelectItem value="consumer">仅调用方确认</SelectItem>
                  <SelectItem value="pending">待评审变更</SelectItem>
                  <SelectItem value="returned">已退回变更</SelectItem>
                  {Object.entries(REVIEW_STATE_LABELS)
                    .filter(([value]) => !['pending', 'returned'].includes(value))
                    .map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <Checkbox
                checked={
                  !!selectableItems.length &&
                  selectableItems.every((item) =>
                    selectedKeys.has(`${item.contractId}:${item.change.id}`),
                  )
                }
                onCheckedChange={selectAllVisible}
                aria-label="选择当前全部变更"
              />
              <span className="text-xs font-medium text-slate-600">
                选择当前列表中的变更（调用方确认请到详情页操作）
              </span>
              <span className="ml-auto text-xs text-slate-500">已选 {selection.length} 项</span>
            </div>

            {contracts.isLoading ? (
              <QueueState text="正在加载评审队列..." />
            ) : (
              sortedQueue.map((item) =>
                item.kind === 'change' ? (
                  <ChangeQueueRow
                    key={item.key}
                    item={item}
                    checked={selectedKeys.has(`${item.contractId}:${item.change.id}`)}
                    onToggle={() =>
                      toggleSelection({
                        contractId: item.contractId,
                        changeId: item.change.id,
                      })
                    }
                  />
                ) : (
                  <ConsumerQueueRow key={item.key} item={item} />
                ),
              )
            )}
            {!contracts.isLoading && !sortedQueue.length && (
              <QueueState text="当前定义下没有待确认项，可以去发布。" />
            )}
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-24">
          <CardHeader>
            <CardTitle>批量结论</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              批量操作只写入勾选的变更结论；所有相关契约的修订号都会被校验
            </p>
          </CardHeader>
          <CardContent>
            <label className="text-xs font-medium text-slate-700">评审人</label>
            <Input
              className="mt-1.5"
              value={reviewer}
              onChange={(event) => setReviewer(event.target.value)}
            />
            <label className="mt-4 block text-xs font-medium text-slate-700">统一意见</label>
            <Textarea
              className="mt-1.5"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="例如：影响说明与迁移窗口确认，接受本批兼容性警告。"
            />
            <div className="mt-4 space-y-2">
              <Button
                className="w-full"
                disabled={!selection.length || !comment.trim() || bulkReview.isPending}
                onClick={() => void submitBulk('accepted')}
              >
                <Check className="h-4 w-4" />
                批量接受
              </Button>
              <Button
                className="w-full"
                variant="secondary"
                disabled={!selection.length || !comment.trim() || bulkReview.isPending}
                onClick={() => void submitBulk('returned')}
              >
                <CornerUpLeft className="h-4 w-4" />
                批量退回
              </Button>
              <Button
                className="w-full"
                variant="ghost"
                disabled={!selection.length}
                onClick={clearSelection}
              >
                <RotateCcw className="h-4 w-4" />
                清空选择
              </Button>
            </div>
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5" />
                当前筛选对应 {sortedQueue.length} 项
              </div>
              <div className="flex items-center gap-2">
                <ListChecks className="h-3.5 w-3.5" />
                已选择 {selection.length} 项
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChangeQueueRow({
  item,
  checked,
  onToggle,
}: {
  item: PendingChangeItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { change } = item;
  return (
    <article className="grid gap-3 border-b border-slate-100 px-4 py-4 last:border-0 lg:grid-cols-[24px_1fr_auto]">
      <Checkbox
        className="mt-1"
        checked={checked}
        onCheckedChange={onToggle}
        aria-label={`选择 ${item.contractName} ${change.path}`}
      />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/contracts/$contractId"
            params={{ contractId: item.contractId }}
            className="text-sm font-semibold text-sky-900 hover:underline"
          >
            {item.contractName}
          </Link>
          <CompatibilityBadge value={change.compatibility} />
          <ReviewStateBadge value={change.reviewState} />
          {item.stale && <Badge tone="amber">旧结论失效 · 需重新确认</Badge>}
        </div>
        <div className="mt-2 font-mono text-xs text-slate-600">
          {change.method} {change.path}
        </div>
        <div className="mt-2 text-sm font-medium text-slate-900">
          {CHANGE_KIND_LABELS[change.kind]}
        </div>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">{change.rationale}</p>
        {item.stale && change.history[0] && (
          <p className="mt-1 text-[11px] text-amber-700">
            旧结论：{change.history[0].reviewState} · {change.history[0].reviewer} ·{' '}
            {change.history[0].reviewComment}
          </p>
        )}
      </div>
      <div className="text-left text-[11px] text-slate-500 lg:text-right">
        <div>
          结论基于第 {change.definitionRevision} 版 / 当前第 {item.definitionRevision} 版
        </div>
        <div className="mt-1">{change.reviewer || '未评审'}</div>
      </div>
    </article>
  );
}

function ConsumerQueueRow({ item }: { item: PendingConsumerItem }) {
  return (
    <article className="grid gap-3 border-b border-blue-50 bg-blue-50/30 px-4 py-4 last:border-0 lg:grid-cols-[24px_1fr_auto]">
      <div className="mt-1 flex h-4 w-4 items-center justify-center text-blue-700">
        <Users className="h-4 w-4" />
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/contracts/$contractId"
            params={{ contractId: item.contractId }}
            className="text-sm font-semibold text-sky-900 hover:underline"
          >
            {item.contractName}
          </Link>
          <Badge tone="blue">调用方确认</Badge>
          {item.stale ? (
            <Badge tone="amber">旧确认失效 · 需重新确认</Badge>
          ) : (
            <Badge tone="amber">待首次确认</Badge>
          )}
        </div>
        <div className="mt-2 text-sm font-medium text-slate-900">
          {item.consumerName} · {item.environment} · v{item.clientVersion}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {item.stale && item.confirmation
            ? `此前由 ${item.confirmation.confirmer} 确认了第 ${item.confirmation.definitionRevision} 版定义，当前已到第 ${item.definitionRevision} 版。`
            : `尚未对第 ${item.definitionRevision} 版定义给出确认。`}
        </p>
      </div>
      <div className="text-left text-[11px] text-slate-500 lg:text-right">
        <Link
          to="/contracts/$contractId"
          params={{ contractId: item.contractId }}
          className="font-medium text-sky-800 hover:underline"
        >
          去确认
        </Link>
      </div>
    </article>
  );
}

function QueueState({ text }: { text: string }) {
  return <p className="px-4 py-16 text-center text-sm text-slate-500">{text}</p>;
}
