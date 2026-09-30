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
  RefreshCcw,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ChangeReviewItem } from '../components/contract/change-review-item';
import { CompatibilityBadge } from '../components/contract/compatibility-badge';
import { ConsumerConfirmationPanel } from '../components/contract/consumer-confirmation-panel';
import { ContractEditor } from '../components/contract/contract-editor';
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
  REVIEW_STATE_LABELS,
  isConclusionCurrent,
  type ApiContract,
  type ContractChange,
  type ReviewState,
  validateForRelease,
} from '../models/contract';
import {
  buildChangeReport,
  diffVersionSummary,
  generateExampleRequest,
} from '../services/contract-service';
import {
  useAddExemption,
  useConfirmConsumer,
  useContract,
  useFreezeVersion,
  useReviewChange,
  useSaveChanges,
  useSaveDefinition,
} from '../services/contract-queries';
import {
  latestVersion,
  pendingConsumers,
  releaseGate,
} from '../services/review-derivation';
import { useConflictStore } from '../store/conflict-store';
import { useReviewStore } from '../store/review-store';

export function ContractDetailPage() {
  const { contractId } = useParams({ from: '/contracts/$contractId' });
  const contractQuery = useContract(contractId);
  const activeTab = useReviewStore((state) => state.activeTab);
  const setActiveTab = useReviewStore((state) => state.setActiveTab);
  const reviewChange = useReviewChange();
  const addExemption = useAddExemption();
  const confirmConsumerMutation = useConfirmConsumer();
  const saveDefinition = useSaveDefinition();
  const saveChanges = useSaveChanges();
  const freezeVersion = useFreezeVersion();
  const reportConflict = useConflictStore((state) => state.reportConflict);
  const [releaseVersion, setReleaseVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [reviewFilter, setReviewFilter] = useState<ReviewState | 'all'>('all');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  /** 发布幂等键：同一次发布流程内固定，重试不会产生第二个版本 */
  const [releaseKey, setReleaseKey] = useState(() => cryptoRandomKey());

  const contract = contractQuery.data;
  const gate = useMemo(
    () => (contract ? releaseGate(contract) : null),
    [contract],
  );
  const issues = useMemo(
    () => (contract ? validateForRelease(contract) : []),
    [contract],
  );
  const blockers = gate?.blockers.length ?? 0;
  const warnings = gate?.warnings.length ?? 0;
  const currentChangeCount = contract
    ? contract.changes.filter((change) => isConclusionCurrent(change, contract)).length
    : 0;
  const acceptedCount = contract
    ? contract.changes.filter(
        (change) =>
          isConclusionCurrent(change, contract) && change.reviewState !== 'pending',
      ).length
    : 0;
  const confirmedCount = contract
    ? contract.consumers.filter((consumer) => {
        const confirmation = contract.confirmations.find(
          (item) => item.consumerId === consumer.id,
        );
        return (
          confirmation?.state === 'confirmed' &&
          confirmation.definitionRevision >= contract.definitionRevision
        );
      }).length
    : 0;
  const reviewProgress = currentChangeCount
    ? Math.round((acceptedCount / currentChangeCount) * 100)
    : 100;
  const staleCount = contract
    ? contract.changes.filter((change) => !isConclusionCurrent(change, contract))
        .length + pendingConsumers(contract).length
    : 0;
  const finalVersion = contract ? latestVersion(contract) : undefined;
  const selectedVersion =
    contract?.versions.find((version) => version.id === selectedVersionId) ?? finalVersion;

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
  const revision = contract.revision;

  async function withConflict<T>(action: () => Promise<T>, summary?: string): Promise<T> {
    try {
      return await action();
    } catch (error) {
      reportConflict(error, summary);
      throw error;
    }
  }

  async function updateChange(changeId: string, patch: Partial<ContractChange>) {
    await withConflict(
      () =>
        saveChanges.mutateAsync({
          contractId,
          expectedRevision: revision,
          changes: currentContract.changes.map((change) =>
            change.id === changeId ? { ...change, ...patch } : change,
          ),
        }),
      `正在保存 ${changeId} 的影响说明/迁移方案`,
    );
  }

  async function handleReview(changeId: string, state: ReviewState, comment: string) {
    await withConflict(
      () =>
        reviewChange.mutateAsync({
          contractId,
          changeId,
          state,
          reviewer: '当前评审人',
          comment,
          expectedRevision: revision,
        }),
      `正在提交 ${changeId} 的评审结论：${state}`,
    );
  }

  async function handleExemption(input: {
    changeId: string;
    scope: string;
    reason: string;
    expiresAt: string;
  }) {
    await withConflict(
      () =>
        addExemption.mutateAsync({
          contractId,
          changeId: input.changeId,
          scope: input.scope,
          reason: input.reason,
          approvedBy: '当前评审人',
          expiresAt: input.expiresAt,
          expectedRevision: revision,
        }),
      `正在为 ${input.changeId} 登记豁免：${input.scope}`,
    );
  }

  async function saveOpenApi(value: string) {
    await withConflict(
      () =>
        saveDefinition.mutateAsync({
          contractId,
          expectedRevision: revision,
          openapi: value,
        }),
      value.slice(0, 400),
    );
  }

  async function handleConsumerConfirm(input: {
    consumerId: string;
    confirmed: boolean;
    confirmer: string;
    comment: string;
  }) {
    await withConflict(
      () =>
        confirmConsumerMutation.mutateAsync({
          contractId,
          consumerId: input.consumerId,
          confirmed: input.confirmed,
          confirmer: input.confirmer,
          comment: input.comment,
          expectedRevision: revision,
        }),
      `正在保存调用方 ${input.consumerId} 的确认`,
    );
  }

  async function freeze() {
    if (!releaseVersion.trim()) return;
    try {
      await freezeVersion.mutateAsync({
        contractId,
        expectedRevision: revision,
        version: releaseVersion.trim(),
        notes: releaseNotes.trim() || '本版契约变更评审完成。',
        idempotencyKey: releaseKey,
      });
      setReleaseVersion('');
      setReleaseNotes('');
      setReleaseKey(cryptoRandomKey());
    } catch (error) {
      // 发布冲突/门禁失败同样提示；幂等键保留，用户可直接重试
      reportConflict(error, `发布 v${releaseVersion.trim()}`);
    }
  }

  function exportReport() {
    downloadText(
      `${currentContract.id}-${currentContract.version}-change-report.md`,
      buildChangeReport(currentContract),
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

  const filteredChanges = contract.changes.filter(
    (change) => reviewFilter === 'all' || change.reviewState === reviewFilter ||
      (reviewFilter === 'pending' && !isConclusionCurrent(change, contract)),
  );
  const anyMutationPending =
    saveDefinition.isPending ||
    saveChanges.isPending ||
    reviewChange.isPending ||
    addExemption.isPending ||
    confirmConsumerMutation.isPending;

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
              {staleCount > 0 && <Badge tone="amber">{staleCount} 项待重新确认</Badge>}
              {finalVersion && <Badge tone="green">最终版本 v{finalVersion.version}</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">
              {contract.name}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {contract.domain} · 负责人 {contract.owner} · 定义第 {contract.definitionRevision}{' '}
              版 · 保存修订 r{contract.revision} · 更新 {formatDateTime(contract.updatedAt)}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            <HeaderMetric label="待确认项" value={String(staleCount)} danger={!!staleCount} />
            <HeaderMetric
              label="调用方确认"
              value={`${confirmedCount}/${contract.consumers.length}`}
              danger={confirmedCount < contract.consumers.length}
            />
            <HeaderMetric label="发布门禁" value={blockers ? `${blockers} 阻断` : '通过'} danger={!!blockers} />
          </div>
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
          <TabsTrigger value="consumers">调用方</TabsTrigger>
          <TabsTrigger value="release">发布门禁</TabsTrigger>
          <TabsTrigger value="history">版本历史</TabsTrigger>
          <TabsTrigger value="report">变更报告</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <ContractEditor
              contract={contract}
              onSave={(value) => saveOpenApi(value)}
              saving={saveDefinition.isPending}
              draftKey={contract.id}
            />
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>评审进度（当前定义）</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end justify-between">
                    <div>
                      <span className="text-3xl font-semibold">{reviewProgress}%</span>
                      <p className="mt-1 text-xs text-slate-500">
                        {acceptedCount} / {currentChangeCount} 条结论有效
                      </p>
                    </div>
                    {!blockers && <CheckCircle2 className="h-6 w-6 text-emerald-600" />}
                  </div>
                  <Progress className="mt-4" value={reviewProgress} />
                  {staleCount > 0 && (
                    <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-5 text-amber-800">
                      {contract.changes.filter((change) => !isConclusionCurrent(change, contract)).length}{' '}
                      条旧结论与 {pendingConsumers(contract).length} 方调用方确认已被定义更新冲掉，需重新确认。
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>调用方确认</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">已确认当前定义</span>
                    <strong>
                      {confirmedCount} / {contract.consumers.length}
                    </strong>
                  </div>
                  {finalVersion && (
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-slate-600">最终版本</span>
                      <strong>v{finalVersion.version}</strong>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1 w-full"
                    onClick={() => setActiveTab('consumers')}
                  >
                    <Users className="h-3.5 w-3.5" />
                    去确认调用方
                  </Button>
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
                  每种变化必须逐条接受、退回或申请兼容层；定义一变，旧结论自动失效需重新确认
                </p>
              </div>
              <Select
                value={reviewFilter}
                onValueChange={(value) => setReviewFilter(value as ReviewState | 'all')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部评审状态</SelectItem>
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
                  key={change.id}
                  contractId={contract.id}
                  change={change}
                  currentDefinitionRevision={contract.definitionRevision}
                  serverRevision={contract.revision}
                  saving={anyMutationPending}
                  onReview={(changeId, state, comment) =>
                    handleReview(changeId, state, comment).catch(() => undefined)
                  }
                  onUpdate={(changeId, patch) => updateChange(changeId, patch)}
                  onExemption={(input) => handleExemption(input).catch(() => undefined)}
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
            <CardHeader>
              <CardTitle>调用方确认</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                每个调用方必须针对当前定义修订给出确认；定义更新后旧确认自动失效，需要重新确认
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <ConsumerConfirmationPanel
                contractId={contract.id}
                consumers={contract.consumers}
                confirmations={contract.confirmations}
                currentDefinitionRevision={contract.definitionRevision}
                serverRevision={contract.revision}
                saving={confirmConsumerMutation.isPending}
                onConfirm={handleConsumerConfirm}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="release">
          <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
            <Card>
              <CardHeader>
                <CardTitle>发布前门禁</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  {blockers} 个阻断项，{warnings} 个警告。与评审队列、变更报告展示同一批待确认项
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
                    所有变更评审、调用方确认和迁移约束均已满足，可以冻结正式版本。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>冻结正式版本</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  定义、有效结论、调用方确认和豁免一次性生成不可改快照；保存失败可用同一发布重试，不会留下半个版本
                </p>
              </CardHeader>
              <CardContent>
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
                  <div>快照绑定：定义第 {contract.definitionRevision} 版 · 修订 r{revision}</div>
                  <div>
                    有效结论 {acceptedCount} 条 · 调用方确认 {confirmedCount}/
                    {contract.consumers.length} · 豁免 {contract.exemptions.length} 条
                  </div>
                </div>
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
                  disabled={!!blockers || !releaseVersion.trim() || freezeVersion.isPending}
                  onClick={() => void freeze()}
                >
                  <LockKeyhole className="h-4 w-4" />
                  {freezeVersion.isPending ? '冻结中（可安全重试）' : '确认发布并冻结'}
                </Button>
                {freezeVersion.isError && (
                  <p className="mt-2 flex items-start gap-1 text-[11px] leading-5 text-red-700">
                    <RefreshCcw className="mt-0.5 h-3 w-3 shrink-0" />
                    本次发布未完成，版本没有落盘。再次点击会用同一发布请求重试，不会产生重复版本。
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history">
          {selectedVersion ? (
            <div className="grid gap-4 xl:grid-cols-[300px_360px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>正式版本（不可变快照）</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {contract.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      className={
                        selectedVersion?.id === version.id
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
                      <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-slate-500">
                        <Badge tone="neutral">定义第 {version.definitionRevision} 版</Badge>
                        <Badge tone="neutral">结论 {version.changes.length}</Badge>
                        <Badge tone="neutral">确认 {version.confirmations.length}</Badge>
                        <Badge tone="neutral">豁免 {version.exemptions.length}</Badge>
                      </div>
                    </button>
                  ))}
                  {!contract.versions.length && (
                    <p className="py-8 text-center text-sm text-slate-500">尚无正式版本。</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>随版冻结内容</CardTitle>
                  <p className="mt-1 whitespace-pre-line text-xs text-slate-500">
                    {selectedVersion ? diffVersionSummary(contract) : ''}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedVersion && (
                    <>
                      <SnapshotList
                        title="有效结论"
                        empty="本版无随版结论"
                        items={selectedVersion.changes.map((item) => ({
                          id: item.changeId,
                          primary: item.changeId,
                          secondary: `${item.reviewState} · ${item.reviewer || '未署名'} · 定义第 ${item.definitionRevision} 版`,
                        }))}
                      />
                      <SnapshotList
                        title="调用方确认"
                        empty="本版无调用方确认"
                        items={selectedVersion.confirmations.map((item) => ({
                          id: item.consumerId,
                          primary: item.consumerId,
                          secondary: `${item.confirmer} · 定义第 ${item.definitionRevision} 版`,
                        }))}
                      />
                      <SnapshotList
                        title="豁免"
                        empty="本版无豁免"
                        items={selectedVersion.exemptions.map((item) => ({
                          id: `${item.changeId}-${item.scope}`,
                          primary: item.scope,
                          secondary: `${item.reason} · 至 ${item.expiresAt} · ${item.approvedBy}`,
                        }))}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>与当前工作副本比较</CardTitle>
                  <p className="mt-1 whitespace-pre-line text-xs text-slate-500">
                    {diffVersionSummary(contract)}
                  </p>
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
                  <p className="mt-1 text-xs text-slate-500">Markdown 格式，可直接进入评审材料</p>
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
                    label="变更明细"
                    value={`${contract.changes.length} 项`}
                  />
                  <ReportFact
                    icon={Clock3}
                    label="待确认项"
                    value={`${staleCount} 项`}
                  />
                  <ReportFact
                    icon={Users}
                    label="调用方影响"
                    value={`${confirmedCount}/${contract.consumers.length} 已确认`}
                  />
                  <ReportFact
                    icon={Layers3}
                    label="兼容层豁免"
                    value={`${contract.exemptions.length} 条`}
                  />
                  <ReportFact
                    icon={LockKeyhole}
                    label="最终版本"
                    value={finalVersion ? `v${finalVersion.version}` : '尚未发布'}
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

function cryptoRandomKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function SnapshotList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; primary: string; secondary: string }>;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-slate-700">
        {title}（{items.length}）
      </div>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5"
            >
              <div className="font-mono text-[11px] font-semibold text-slate-800">
                {item.primary}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-500">{item.secondary}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-slate-400">{empty}</p>
      )}
    </div>
  );
}
