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
import {
  CompatibilityBadge,
  ReviewStateBadge,
} from '../components/contract/compatibility-badge';
import { StaleBadge } from '../components/contract/pending-summary';
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
import { formatDateTime } from '../lib/utils';
import {
  CHANGE_KIND_LABELS,
  isChangeStale,
  REVIEW_STATE_LABELS,
  type ApiContract,
  type ContractChange,
  type ReviewState,
} from '../models/contract';
import { getAllPendingItems, type PendingItem } from '../models/review';
import { useBulkReview, useContracts } from '../services/contract-queries';
import { useIdentityStore } from '../store/identity-store';
import { useReviewStore } from '../store/review-store';

interface QueueEntry {
  contract: ApiContract;
  change: ContractChange;
  stale: boolean;
}

type QueueFilter = ReviewState | 'all' | 'stale' | 'consumer';

export function ReviewQueuePage() {
  const contracts = useContracts();
  const bulkReview = useBulkReview();
  const editor = useIdentityStore((state) => state.editor);
  const reviewStateFilter = useReviewStore((state) => state.reviewStateFilter);
  const setReviewStateFilter = useReviewStore((state) => state.setReviewStateFilter);
  const selection = useReviewStore((state) => state.selection);
  const toggleSelection = useReviewStore((state) => state.toggleSelection);
  const clearSelection = useReviewStore((state) => state.clearSelection);
  const selectMany = useReviewStore((state) => state.selectMany);
  const [query, setQuery] = useState('');
  const [comment, setComment] = useState('');
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(
    reviewStateFilter === 'all' ? 'all' : reviewStateFilter,
  );

  const data = useMemo(() => contracts.data ?? [], [contracts.data]);

  // 评审队列、发布页和变更报告共用同一份待确认项。
  const pendingItems = useMemo(() => getAllPendingItems(data), [data]);

  const queue = useMemo<QueueEntry[]>(
    () =>
      data
        .flatMap((contract) =>
          contract.changes.map((change) => ({
            contract,
            change,
            stale: isChangeStale(change, contract.definitionVersion),
          })),
        )
        .filter((entry) => {
          const keyword = query.trim().toLowerCase();
          const matchesKeyword =
            !keyword ||
            `${entry.contract.name} ${entry.change.path} ${entry.change.method}`
              .toLowerCase()
              .includes(keyword);
          if (!matchesKeyword) return false;
          if (queueFilter === 'all') return true;
          if (queueFilter === 'stale') return entry.stale;
          if (queueFilter === 'consumer') return false;
          return entry.change.reviewState === queueFilter;
        })
        .sort((left, right) => {
          if (left.stale !== right.stale) return left.stale ? -1 : 1;
          const rank = { breaking: 0, warning: 1, compatible: 2 };
          return rank[left.change.compatibility] - rank[right.change.compatibility];
        }),
    [data, query, queueFilter],
  );

  const consumerPending = pendingItems.filter((item) => item.kind === 'consumer_confirmation');

  const selectedKeys = new Set(
    selection.map((item) => `${item.contractId}:${item.changeId}`),
  );

  function selectAllVisible() {
    if (queue.every((entry) =>
      selectedKeys.has(`${entry.contract.id}:${entry.change.id}`),
    )) {
      selectMany([]);
      return;
    }
    selectMany(
      queue.map((entry) => ({
        contractId: entry.contract.id,
        changeId: entry.change.id,
      })),
    );
  }

  async function submitBulk(state: ReviewState) {
    if (!selection.length || !comment.trim()) return;
    const revisionById = new Map(data.map((contract) => [contract.id, contract.revision]));
    await bulkReview.mutateAsync({
      selections: selection.map((item) => ({
        ...item,
        baseRevision: revisionById.get(item.contractId) ?? 1,
      })),
      state,
      reviewer: editor,
      comment: comment.trim(),
    });
    clearSelection();
    setComment('');
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Review Queue</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          批量变更评审
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          与发布页、变更报告同源展示待确认项。定义变更后失效结论排在最前，必须重新确认；
          与他人并发保存时不会静默覆盖，冲突会先展示对方改动。
        </p>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle>评审队列</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {pendingItems.length} 项统一待确认（失效结论 + 待评审 + 调用方确认）
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="契约、路径或方法"
              />
              <Select
                value={queueFilter}
                onValueChange={(value) => {
                  setQueueFilter(value as QueueFilter);
                  setReviewStateFilter(
                    value === 'stale' || value === 'consumer'
                      ? 'all'
                      : (value as ReviewState | 'all'),
                  );
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="stale">定义已变更待重新确认</SelectItem>
                  {Object.entries(REVIEW_STATE_LABELS).map(([value, label]) => (
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
                  !!queue.length &&
                  queue.every((entry) =>
                    selectedKeys.has(`${entry.contract.id}:${entry.change.id}`),
                  )
                }
                onCheckedChange={selectAllVisible}
                aria-label="选择当前全部"
              />
              <span className="text-xs font-medium text-slate-600">选择当前列表</span>
              <span className="ml-auto text-xs text-slate-500">已选 {selection.length} 项</span>
            </div>

            {contracts.isLoading ? (
              <QueueState text="正在加载评审队列..." />
            ) : (
              queue.map((entry) => {
                const key = `${entry.contract.id}:${entry.change.id}`;
                return (
                  <article
                    key={key}
                    className={
                      entry.stale
                        ? 'grid gap-3 border-b border-amber-100 bg-amber-50/40 px-4 py-4 last:border-0 lg:grid-cols-[24px_1fr_auto]'
                        : 'grid gap-3 border-b border-slate-100 px-4 py-4 last:border-0 lg:grid-cols-[24px_1fr_auto]'
                    }
                  >
                    <Checkbox
                      className="mt-1"
                      checked={selectedKeys.has(key)}
                      onCheckedChange={() =>
                        toggleSelection({
                          contractId: entry.contract.id,
                          changeId: entry.change.id,
                        })
                      }
                      aria-label={`选择 ${entry.contract.name} ${entry.change.path}`}
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/contracts/$contractId"
                          params={{ contractId: entry.contract.id }}
                          className="text-sm font-semibold text-sky-900 hover:underline"
                        >
                          {entry.contract.name}
                        </Link>
                        <Badge tone="neutral">v{entry.contract.version}</Badge>
                        <CompatibilityBadge value={entry.change.compatibility} />
                        {entry.stale ? (
                          <StaleBadge />
                        ) : (
                          <ReviewStateBadge value={entry.change.reviewState} />
                        )}
                      </div>
                      <div className="mt-2 font-mono text-xs text-slate-600">
                        {entry.change.method} {entry.change.path}
                      </div>
                      <div className="mt-2 text-sm font-medium text-slate-900">
                        {CHANGE_KIND_LABELS[entry.change.kind]}
                      </div>
                      <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
                        {entry.stale
                          ? `结论基于第 ${entry.change.definitionVersion ?? 1} 版定义，当前为第 ${entry.contract.definitionVersion} 版，需要重新确认。`
                          : entry.change.rationale}
                      </p>
                    </div>
                    <div className="text-left text-[11px] text-slate-500 lg:text-right">
                      <div>{formatDateTime(entry.contract.updatedAt)}</div>
                      <div className="mt-1">{entry.change.reviewer || '未评审'}</div>
                    </div>
                  </article>
                );
              })
            )}
            {!contracts.isLoading && !queue.length && (
              <QueueState text="没有符合条件的变更项。" />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="h-fit lg:sticky lg:top-24">
            <CardHeader>
              <CardTitle>批量结论</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                重新确认会写入当前定义版本；冲突时先展示对方改动，你的意见草稿不会丢
              </p>
            </CardHeader>
            <CardContent>
              <label className="text-xs font-medium text-slate-700">评审人</label>
              <Input className="mt-1.5" value={editor} readOnly />
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
                  当前筛选对应 {queue.length} 项结论
                </div>
                <div className="flex items-center gap-2">
                  <ListChecks className="h-3.5 w-3.5" />
                  已选择 {selection.length} 项
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Users className="h-4 w-4 text-sky-800" />
                调用方待确认
                <Badge tone={consumerPending.length ? 'red' : 'green'}>
                  {consumerPending.length}
                </Badge>
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                与发布门禁同源；定义变更后旧确认失效，需要调用方负责人重新确认
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {consumerPending.map((item) => (
                <PendingConsumerRow key={`${item.contractId}-${item.consumerId}`} item={item} />
              ))}
              {!consumerPending.length && (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  所有调用方都已在当前定义上完成确认。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PendingConsumerRow({ item }: { item: PendingItem }) {
  const setActiveTab = useReviewStore((state) => state.setActiveTab);
  return (
    <Link
      to="/contracts/$contractId"
      params={{ contractId: item.contractId }}
      onClick={() => setActiveTab('consumers')}
      className="block rounded-md border border-slate-200 p-3 transition-colors hover:border-sky-300 hover:bg-sky-50"
    >
      <div className="flex items-center justify-between gap-2">
        <strong className="text-xs text-slate-900">
          {item.contractName} · {item.label}
        </strong>
        <Badge tone="amber">第 {item.definitionVersion} 版待确认</Badge>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-slate-500">{item.detail}</p>
    </Link>
  );
}

function QueueState({ text }: { text: string }) {
  return <p className="px-4 py-16 text-center text-sm text-slate-500">{text}</p>;
}
