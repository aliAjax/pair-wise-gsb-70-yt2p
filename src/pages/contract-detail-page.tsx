import { DiffEditor } from '@monaco-editor/react';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  FileWarning,
  GitCompare,
  Layers3,
  LockKeyhole,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ChangeReviewItem } from '../components/contract/change-review-item';
import { CompatibilityBadge } from '../components/contract/compatibility-badge';
import { ConsumerTable } from '../components/contract/consumer-table';
import { ContractEditor } from '../components/contract/contract-editor';
import { PendingSummary, StaleBadge } from '../components/contract/pending-summary';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Progress } from '../components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Textarea } from '../components/ui/textarea';
import { formatDateTime } from '../lib/utils';
import {
  activeExemptions,
  isChangeStale,
  isConsumerUnconfirmed,
  isExemptionActive,
  REVIEW_STATE_LABELS,
  validChanges,
  type ApiContract,
  type ContractChange,
  type ReviewState,
} from '../models/contract';
import { pendingSummary, validateForRelease } from '../models/review';
import {
  buildChangeReport,
  buildVersionReport,
  diffVersionSummary,
  generateExampleRequest,
} from '../services/contract-service';
import {
  useConfirmConsumer,
  useContract,
  usePublishVersion,
  useRegisterExemption,
  useSaveChangeTexts,
  useSaveDefinition,
  useSubmitReview,
} from '../services/contract-queries';
import { useIdentityStore } from '../store/identity-store';
import { useDraftStore } from '../store/draft-store';
import { useReviewStore } from '../store/review-store';

export function ContractDetailPage() {
  const { contractId } = useParams({ from: '/contracts/$contractId' });
  const contractQuery = useContract(contractId);
  const activeTab = useReviewStore((state) => state.activeTab);
  const setActiveTab = useReviewStore((state) => state.setActiveTab);
  const editor = useIdentityStore((state) => state.editor);
  const submitReview = useSubmitReview();
  const registerExemption = useRegisterExemption();
  const saveDefinition = useSaveDefinition();
  const saveChangeTexts = useSaveChangeTexts();
  const confirmConsumer = useConfirmConsumer();
  const publishVersion = usePublishVersion();
  const clearDefinitionDraft = useDraftStore((state) => state.clearDefinitionDraft);
  const [releaseVersion, setReleaseVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewState | 'all' | 'stale'>('all');
  const [selectedVersionId, setSelectedVersionId] = useState('');

  const contract = contractQuery.data;
  const issues = useMemo(
    () => (contract ? validateForRelease(contract) : []),
    [contract],
  );
  const blockers = issues.filter((issue) => issue.severity === 'blocker').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const summary = contract ? pendingSummary(contract) : null;
  const confirmedCount = contract
    ? contract.changes.filter(
        (change) =>
          change.reviewState !== 'pending' &&
          !isChangeStale(change, contract.definitionVersion),
      ).length
    : 0;
  const reviewProgress = contract?.changes.length
    ? Math.round((confirmedCount / contract.changes.length) * 100)
    : 100;
  const selectedVersion =
    contract?.versions.find((version) => version.id === selectedVersionId) ??
    contract?.versions[0];

  if (contractQuery.isLoading) {
    return <PageState text="正在加载契约详情..." />;
  }
  if (contractQuery.isError || !contract) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-10 text-center">
        <h1 className="text-xl font-semibold">契约不存在</h1>
        <p className="mt-2 text-sm text-slate-500">记录可能已被删除，或链接无效。</p>
        <Link to="/" className="mt-5 inline-flex text-sm font-medium text-sky-800">
          返回契约工作台
        </Link>
      </div>
    );
  }
  const currentContract = contract;

  async function handleSaveTexts(
    changeId: string,
    patch: Pick<ContractChange, 'impactStatement' | 'migrationPlan'>,
  ) {
    await saveChangeTexts.mutateAsync({
      contractId,
      baseRevision: currentContract.revision,
      editor,
      changeId,
      impactStatement: patch.impactStatement,
      migrationPlan: patch.migrationPlan,
    });
  }

  async function handleReview(changeId: string, state: ReviewState, comment: string) {
    await submitReview.mutateAsync({
      contractId,
      baseRevision: currentContract.revision,
      changeId,
      state,
      reviewer: editor,
      comment,
    });
  }

  async function handleExemption(changeId: string, reason: string) {
    await registerExemption.mutateAsync({
      contractId,
      baseRevision: currentContract.revision,
      changeId,
      reason,
      editor,
    });
  }

  async function handleSaveDefinition(value: string) {
    await saveDefinition.mutateAsync({
      contractId,
      baseRevision: currentContract.revision,
      editor,
      openapi: value,
    });
    // 仅在确实保存成功（未抛冲突）后清理本地草稿
    clearDefinitionDraft(contractId);
  }

  async function handleConfirmConsumer(consumerId: string, comment: string) {
    await confirmConsumer.mutateAsync({
      contractId,
      baseRevision: currentContract.revision,
      consumerId,
      reviewer: editor,
      comment,
    });
  }

  async function publish() {
    if (!releaseVersion.trim()) return;
    await publishVersion.mutateAsync({
      contractId,
      baseRevision: currentContract.revision,
      version: releaseVersion.trim(),
      notes: releaseNotes.trim() || '本版契约变更评审完成。',
      editor,
      idempotencyKey: `publish-${contractId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    });
    setReleaseVersion('');
    setReleaseNotes('');
  }

  function exportReport() {
    downloadText(
      `${currentContract.id}-${currentContract.version}-change-report.md`,
      buildChangeReport(currentContract),
      'text/markdown;charset=utf-8',
    );
  }

  function exportVersionReport() {
    if (!selectedVersion) return;
    downloadText(
      `${currentContract.id}-${selectedVersion.version}-release.md`,
      buildVersionReport(currentContract, selectedVersion),
      'text/markdown;charset=utf-8',
    );
  }

  function exportJson() {
    downloadText(
      `${currentContract.id}-${currentContract.version}.json`,
      JSON.stringify(currentContract, null, 2),
      'application/json;charset=utf-8',
    );
  }

  const filteredChanges = contract.changes.filter((change) => {
    if (reviewFilter === 'all') return true;
    if (reviewFilter === 'stale') {
      return isChangeStale(change, contract.definitionVersion);
    }
    return change.reviewState === reviewFilter;
  });
  const validExemptions = activeExemptions(contract);
  const voidedExemptions = contract.exemptions.filter(
    (item) => !isExemptionActive(item, contract.definitionVersion),
  );

  return (
    <div>
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-800 hover:text-sky-950"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回契约清单
      </Link>

      <section className="mt-3 border-b border-slate-200 pb-5">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-sky-800">{contract.protocol}</span>
              <Badge tone="slate">v{contract.version}</Badge>
              <StatusPill status={contract.status} />
              {summary && summary.total > 0 && <StaleBadge />}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">
              {contract.name}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {contract.domain} · 负责人 {contract.owner} · 定义第 {contract.definitionVersion}{' '}
              版 · 修订 {contract.revision} · 更新 {formatDateTime(contract.updatedAt)}
            </p>
            {contract.lastEditedBy && (
              <p className="mt-1 text-xs text-slate-400">
                最近一次保存：{contract.lastEditedBy}
                {contract.definitionUpdatedAt
                  ? `（定义更新于 ${formatDateTime(contract.definitionUpdatedAt)}）`
                  : ''}
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            <HeaderMetric
              label="有效结论"
              value={`${confirmedCount}/${contract.changes.length}`}
            />
            <HeaderMetric
              label="待确认"
              value={String(summary?.total ?? 0)}
              danger={(summary?.total ?? 0) > 0}
            />
            <HeaderMetric
              label="发布门禁"
              value={blockers ? `${blockers} 阻断` : '通过'}
              danger={!!blockers}
            />
          </div>
        </div>
        <div className="mt-3">
          <PendingSummary contract={contract} />
        </div>
      </section>

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="overview">概览与契约</TabsTrigger>
          <TabsTrigger value="changes">差异评审</TabsTrigger>
          <TabsTrigger value="consumers">调用方确认</TabsTrigger>
          <TabsTrigger value="release">发布门禁</TabsTrigger>
          <TabsTrigger value="history">版本历史</TabsTrigger>
          <TabsTrigger value="report">变更报告</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <ContractEditor
              contract={contract}
              onSave={(value) => void handleSaveDefinition(value)}
              onDiscard={() => clearDefinitionDraft(contractId)}
              saving={saveDefinition.isPending}
            />
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>重新确认进度</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-3xl font-semibold">{reviewProgress}%</span>
                      <p className="mt-1 text-xs text-slate-500">
                        {confirmedCount} / {contract.changes.length} 项结论对第{' '}
                        {contract.definitionVersion} 版定义有效
                      </p>
                    </div>
                    {!blockers && <CheckCircle2 className="h-6 w-6 text-emerald-600" />}
                  </div>
                  <Progress className="mt-4" value={reviewProgress} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>兼容性摘要</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(['compatible', 'warning', 'breaking'] as const).map((level) => {
                    const count = contract.changes.filter(
                      (change) => change.compatibility === level,
                    ).length;
                    return (
                      <div key={level} className="flex items-center justify-between">
                        <CompatibilityBadge value={level} />
                        <strong className="text-sm">{count} 项</strong>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>示例请求</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">根据当前定义自动生成</p>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
                    {generateExampleRequest(contract)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="changes">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>字段与错误码差异</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  定义变更后旧结论会自动失效，必须在当前定义上重新接受、退回或申请豁免
                </p>
              </div>
              <Select
                value={reviewFilter}
                onValueChange={(value) =>
                  setReviewFilter(value as ReviewState | 'all' | 'stale')
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部评审状态</SelectItem>
                  <SelectItem value="stale">定义已变更待重新确认</SelectItem>
                  {Object.entries(REVIEW_STATE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              {filteredChanges.map((change) => (
                <ChangeReviewItem
                  key={`${change.id}-${change.reviewState}-${change.definitionVersion}-${change.invalidatedByDefinition}`}
                  change={change}
                  definitionVersion={contract.definitionVersion}
                  saving={
                    submitReview.isPending ||
                    registerExemption.isPending ||
                    saveChangeTexts.isPending
                  }
                  onReview={(changeId, state, comment) =>
                    void handleReview(changeId, state, comment)
                  }
                  onSaveTexts={(changeId, patch) => void handleSaveTexts(changeId, patch)}
                  onExemption={(changeId, reason) => void handleExemption(changeId, reason)}
                />
              ))}
              {!filteredChanges.length && (
                <p className="p-10 text-center text-sm text-slate-500">没有符合条件的变更项。</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="consumers">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>依赖调用方确认</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  每个调用方都要在当前定义版本上确认影响；定义一变，旧确认立即失效
                </p>
              </div>
              <Badge tone={summary?.consumers ? 'red' : 'green'}>
                {summary?.consumers
                  ? `${summary.consumers} 个调用方待确认`
                  : '全部调用方已确认'}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <ConsumerTable
                consumers={contract.consumers}
                definitionVersion={contract.definitionVersion}
                savingId={confirmConsumer.variables?.consumerId}
                onConfirm={(consumerId, comment) =>
                  void handleConfirmConsumer(consumerId, comment)
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="release">
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>发布前门禁</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    与评审队列、变更报告使用同一份待确认数据：{blockers} 个阻断项，{warnings}{' '}
                    个警告
                  </p>
                </CardHeader>
                <CardContent>
                  {issues.map((issue) => (
                    <div
                      key={issue.id}
                      className={
                        issue.severity === 'blocker'
                          ? 'border-b border-red-100 bg-red-50 px-3 py-3 first:rounded-t-md'
                          : 'border-b border-amber-100 bg-amber-50 px-3 py-3'
                      }
                    >
                      <div className="flex items-center gap-2">
                        {issue.severity === 'blocker' ? (
                          <FileWarning className="h-4 w-4 text-red-700" />
                        ) : (
                          <Clock3 className="h-4 w-4 text-amber-700" />
                        )}
                        <strong className="text-sm">{issue.title}</strong>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{issue.detail}</p>
                    </div>
                  ))}
                  {!issues.length && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      所有变更评审、调用方确认和迁移约束均已满足，可以发布不可修改的正式版本。
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>随版固化内容预览</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    发布瞬间整体冻结：定义、{validChanges(contract).length} 条有效结论、
                    {validExemptions.length} 条有效豁免与 {contract.consumers.length} 个调用方确认
                  </p>
                </CardHeader>
                <CardContent className="grid gap-3 text-xs sm:grid-cols-3">
                  <SnapshotBucket
                    icon={GitCompare}
                    title="有效结论"
                    items={validChanges(contract).map(
                      (change) => `${change.method} ${change.path} · ${change.reviewState}`,
                    )}
                  />
                  <SnapshotBucket
                    icon={Layers3}
                    title="有效豁免"
                    items={validExemptions.map((item) => `${item.scope} · 至 ${item.expiresAt}`)}
                  />
                  <SnapshotBucket
                    icon={Users}
                    title="调用方确认"
                    items={contract.consumers.map((consumer) =>
                      isConsumerUnconfirmed(consumer, contract.definitionVersion)
                        ? `${consumer.name} · 未确认`
                        : `${consumer.name} · 已确认`,
                    )}
                    danger={(id) => id.endsWith('未确认')}
                  />
                </CardContent>
              </Card>

              {voidedExemptions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>已失效豁免（不进入本次发布）</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {voidedExemptions.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500"
                      >
                        {item.scope}：{item.voidReason ?? '定义变更后失效'}（原批准人{' '}
                        {item.approvedBy}）
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>发布不可变版本</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  定义、有效结论和豁免在同一次事务里冻结，保存失败重试不会留下半个版本
                </p>
              </CardHeader>
              <CardContent>
                <label className="text-xs font-medium text-slate-700">版本号</label>
                <Input
                  className="mt-1.5"
                  value={releaseVersion}
                  onChange={(event) => setReleaseVersion(event.target.value)}
                  placeholder="例如 2.9.0"
                />
                <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
                <Textarea
                  className="mt-1.5"
                  value={releaseNotes}
                  onChange={(event) => setReleaseNotes(event.target.value)}
                  placeholder="说明本版接口变化、兼容层和调用方升级状态"
                />
                <Button
                  className="mt-4 w-full"
                  disabled={
                    !!blockers || !releaseVersion.trim() || publishVersion.isPending
                  }
                  onClick={() => void publish()}
                >
                  <LockKeyhole className="h-4 w-4" />
                  {publishVersion.isPending ? '发布中' : '确认发布并冻结'}
                </Button>
                {publishVersion.error && (
                  <p className="mt-2 text-xs leading-5 text-red-700">
                    {publishVersion.error instanceof Error
                      ? publishVersion.error.message
                      : '发布失败，请重试'}
                  </p>
                )}
                <div className="mt-4 flex items-start gap-2 rounded-md bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  重试使用同一幂等键：版本已创建就直接复用，绝不会生成第二条记录。
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          {selectedVersion ? (
            <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>正式版本</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      className={
                        selectedVersion.id === version.id
                          ? 'w-full rounded-md border border-sky-300 bg-sky-50 p-3 text-left'
                          : 'w-full rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50'
                      }
                      onClick={() => setSelectedVersionId(version.id)}
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-sm">v{version.version}</strong>
                        <span className="font-mono text-[10px] text-slate-500">
                          {version.checksum}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{version.notes}</p>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {version.immutable ? '不可变快照' : '历史记录'} ·{' '}
                        {formatDateTime(version.releasedAt)}
                      </div>
                    </button>
                  ))}
                  {!contract.versions.length && (
                    <p className="py-8 text-center text-sm text-slate-500">尚无正式版本。</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div>
                    <CardTitle>与当前工作副本比较</CardTitle>
                    <p className="mt-1 whitespace-pre-line text-xs text-slate-500">
                      {diffVersionSummary(contract, selectedVersion)}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={exportVersionReport}>
                    <Download className="h-3.5 w-3.5" />
                    归档报告
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-md border border-slate-200">
                    <DiffEditor
                      height="520px"
                      language="plaintext"
                      original={selectedVersion.openapi}
                      modified={contract.openapi}
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        renderSideBySide: true,
                        fontSize: 12,
                        automaticLayout: true,
                      }}
                    />
                  </div>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">
                    {selectedVersion.immutable
                      ? buildVersionReport(contract, selectedVersion)
                      : '该历史版本由旧版本数据迁移而来，仅保存定义快照。'}
                  </pre>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-14 text-center text-sm text-slate-500">
                暂无版本可比较。
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="report">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>变更报告预览</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    与评审队列、发布页同源，包含失效结论与待确认调用方
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={exportReport}>
                  <Download className="h-3.5 w-3.5" />
                  导出报告
                </Button>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[650px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                  {buildChangeReport(contract)}
                </pre>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>报告要素</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <ReportFact
                    icon={GitCompare}
                    label="有效逐条结论"
                    value={`${confirmedCount} / ${contract.changes.length} 项`}
                  />
                  <ReportFact
                    icon={Users}
                    label="调用方确认"
                    value={`${contract.consumers.length - (summary?.consumers ?? 0)} / ${contract.consumers.length}`}
                  />
                  <ReportFact
                    icon={Layers3}
                    label="有效兼容层豁免"
                    value={`${validExemptions.length} 条`}
                  />
                </CardContent>
              </Card>
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={exportJson}>
                  导出 JSON
                </Button>
                <Button variant="outline" className="flex-1" onClick={exportReport}>
                  导出 Markdown
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SnapshotBucket({
  icon: Icon,
  title,
  items,
  danger,
}: {
  icon: typeof GitCompare;
  title: string;
  items: string[];
  danger?: (item: string) => boolean;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <Icon className="h-3.5 w-3.5 text-sky-800" />
        {title}
      </div>
      <ul className="mt-2 space-y-1">
        {items.length ? (
          items.map((item) => (
            <li
              key={item}
              className={
                danger?.(item)
                  ? 'rounded-sm bg-red-50 px-1.5 py-1 text-[11px] text-red-800'
                  : 'rounded-sm bg-slate-50 px-1.5 py-1 text-[11px] text-slate-600'
              }
            >
              {item}
            </li>
          ))
        ) : (
          <li className="text-[11px] text-slate-400">无</li>
        )}
      </ul>
    </div>
  );
}

function HeaderMetric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="min-w-24 bg-white px-4 py-3">
      <span className="text-[11px] text-slate-500">{label}</span>
      <strong className={danger ? 'mt-1 block text-red-700' : 'mt-1 block text-slate-900'}>
        {value}
      </strong>
    </div>
  );
}

function StatusPill({ status }: { status: ApiContract['status'] }) {
  const label = {
    draft: '草稿',
    review: '评审中',
    ready: '待发布',
    released: '已发布',
    frozen: '已冻结',
  }[status];
  const tone = {
    draft: 'neutral',
    review: 'amber',
    ready: 'blue',
    released: 'green',
    frozen: 'slate',
  }[status] as 'neutral' | 'amber' | 'blue' | 'green' | 'slate';
  return <Badge tone={tone}>{label}</Badge>;
}

function ReportFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GitCompare;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
      <span className="flex items-center gap-2 text-slate-600">
        <Icon className="h-4 w-4 text-sky-800" />
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function PageState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-16 text-center text-sm text-slate-500">
      {text}
    </div>
  );
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
