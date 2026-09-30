import { Link } from '@tanstack/react-router';
import {
  Archive,
  CheckCircle2,
  LockKeyhole,
  PackageCheck,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PendingSummary } from '../components/contract/pending-summary';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
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
import { validateForRelease } from '../models/review';
import {
  useContracts,
  usePublishVersion,
} from '../services/contract-queries';
import {
  ReleaseGateError,
  RevisionConflictError,
} from '../services/contract-service';
import { useIdentityStore } from '../store/identity-store';
import { useReviewStore } from '../store/review-store';

export function ReleasesPage() {
  const contracts = useContracts();
  const publishVersion = usePublishVersion();
  const editor = useIdentityStore((state) => state.editor);
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const selectedContract = (contracts.data ?? []).find(
    (contract) => contract.id === selectedContractId,
  );
  const selectedIssues = selectedContract ? validateForRelease(selectedContract) : [];
  const blockers = selectedIssues.filter((issue) => issue.severity === 'blocker').length;

  const versions = useMemo(
    () =>
      (contracts.data ?? [])
        .flatMap((contract) =>
          contract.versions.map((release) => ({ contract, release })),
        )
        .sort(
          (left, right) =>
            new Date(right.release.releasedAt).getTime() -
            new Date(left.release.releasedAt).getTime(),
        ),
    [contracts.data],
  );

  async function publish() {
    if (!selectedContract || !version.trim() || blockers) return;
    setFormError('');
    try {
      await publishVersion.mutateAsync({
        contractId: selectedContract.id,
        baseRevision: selectedContract.revision,
        version: version.trim(),
        notes: notes.trim() || '契约兼容性评审完成，正式冻结。',
        editor,
        idempotencyKey: `publish-${selectedContract.id}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      });
      setVersion('');
      setNotes('');
    } catch (error) {
      if (
        error instanceof ReleaseGateError ||
        error instanceof RevisionConflictError
      ) {
        setFormError(error.message);
      }
    }
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Release Center</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
          契约版本发布
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          发布门禁与评审队列、变更报告使用同一份待确认项。发布事务一次性冻结定义、有效结论、
          调用方确认与豁免；保存失败可安全重试，不会留下半个版本。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>正式版本记录</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{versions.length} 个冻结版本</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">契约</th>
                    <th className="px-4 py-3 font-medium">版本</th>
                    <th className="px-4 py-3 font-medium">发布时间</th>
                    <th className="px-4 py-3 font-medium">随版内容</th>
                    <th className="px-4 py-3 font-medium">校验值</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {versions.map(({ contract, release }) => (
                    <tr key={release.id} className="border-t border-slate-100">
                      <td className="px-4 py-4">
                        <div className="font-medium">{contract.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{contract.domain}</div>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone="slate">v{release.version}</Badge>
                        {release.immutable && (
                          <div className="mt-1 text-[10px] text-slate-400">不可变快照</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDateTime(release.releasedAt)}
                        {release.publishedBy && (
                          <div className="mt-1 text-[11px] text-slate-400">
                            {release.publishedBy}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        {release.immutable ? (
                          <div className="space-y-0.5">
                            <div>定义第 {release.definitionVersion} 版</div>
                            <div>{(release.validChangeIds ?? []).length} 条有效结论</div>
                            <div>{(release.exemptions ?? []).length} 条有效豁免</div>
                            <div>{(release.consumers ?? []).length} 个调用方确认</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">仅定义快照</span>
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">
                        {release.checksum}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <Link
                          to="/contracts/$contractId"
                          params={{ contractId: contract.id }}
                          className="text-xs font-medium text-sky-800 hover:underline"
                        >
                          查看版本
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!versions.length && (
                <p className="px-4 py-16 text-center text-sm text-slate-500">
                  尚无冻结的正式版本。
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>选择发布候选</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                发布门禁实时检查当前工作副本，与其他页面同源
              </p>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedContractId}
                onValueChange={(value) => {
                  setSelectedContract(value);
                  setFormError('');
                  const contract = (contracts.data ?? []).find((item) => item.id === value);
                  if (contract) setVersion(suggestVersion(contract.version));
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择一个契约" />
                </SelectTrigger>
                <SelectContent>
                  {(contracts.data ?? []).map((contract) => (
                    <SelectItem key={contract.id} value={contract.id}>
                      {contract.name} · v{contract.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedContract && (
                <div className="mt-4 space-y-3">
                  <PendingSummary contract={selectedContract} />
                  <div
                    className={
                      blockers
                        ? 'flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3'
                        : 'flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3'
                    }
                  >
                    {blockers ? (
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    )}
                    <div>
                      <strong className="text-sm">
                        {blockers ? `${blockers} 个阻断项` : '发布门禁通过'}
                      </strong>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        {blockers
                          ? '阻断项与评审队列、详情页显示的待确认项完全一致。'
                          : '可以冻结正式版本；定义、有效结论、确认与豁免将一次性固化。'}
                      </p>
                    </div>
                  </div>

                  <label className="mt-4 block text-xs font-medium text-slate-700">新版本号</label>
                  <Input
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="2.9.0"
                  />
                  <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="版本变化、兼容层和调用方升级状态"
                  />
                  <Button
                    className="mt-2 w-full"
                    disabled={
                      !!blockers || !version.trim() || publishVersion.isPending
                    }
                    onClick={() => void publish()}
                  >
                    <LockKeyhole className="h-4 w-4" />
                    {publishVersion.isPending ? '发布中' : '发布不可变版本'}
                  </Button>
                  {formError && (
                    <p className="rounded-md bg-red-50 p-2 text-xs leading-5 text-red-700">
                      {formError}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>发布与冻结策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <Policy icon={Archive} text="版本快照包含完整 OpenAPI、有效结论、豁免和调用方确认。" />
              <Policy icon={PackageCheck} text="新版本与幂等键、修订历史在同一事务落盘，失败整体回滚。" />
              <Policy icon={LockKeyhole} text="冻结记录不可修改，只通过差异编辑器与当前工作副本比较。" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function suggestVersion(current: string): string {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return current;
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function Policy({
  icon: Icon,
  text,
}: {
  icon: typeof Archive;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-sky-800" />
      <span>{text}</span>
    </div>
  );
}
