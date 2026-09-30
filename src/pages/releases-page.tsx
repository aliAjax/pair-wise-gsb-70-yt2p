import { Link } from '@tanstack/react-router';
import {
  Archive,
  CheckCircle2,
  LockKeyhole,
  PackageCheck,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { useContracts, useFreezeVersion } from '../services/contract-queries';
import {
  pendingConsumers,
  pendingChanges,
  releaseGate,
} from '../services/review-derivation';
import { useConflictStore } from '../store/conflict-store';
import { useReviewStore } from '../store/review-store';

export function ReleasesPage() {
  const contracts = useContracts();
  const freezeVersion = useFreezeVersion();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const reportConflict = useConflictStore((state) => state.reportConflict);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  /** 同一次发布流程内固定的幂等键，重试沿用 */
  const [releaseKey, setReleaseKey] = useState(() => randomKey());

  const selectedContract = (contracts.data ?? []).find(
    (contract) => contract.id === selectedContractId,
  );
  const gate = selectedContract ? releaseGate(selectedContract) : null;
  const blockers = gate?.blockers.length ?? 0;
  const pendingChangeItems = selectedContract ? pendingChanges(selectedContract) : [];
  const pendingConsumerItems = selectedContract
    ? pendingConsumers(selectedContract)
    : [];

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

  async function freeze() {
    if (!selectedContract || !version.trim() || blockers) return;
    try {
      await freezeVersion.mutateAsync({
        contractId: selectedContract.id,
        expectedRevision: selectedContract.revision,
        version: version.trim(),
        notes: notes.trim() || '契约兼容性评审完成，正式冻结。',
        idempotencyKey: releaseKey,
      });
      setVersion('');
      setNotes('');
      setReleaseKey(randomKey());
    } catch (error) {
      // 冲突或门禁失败：版本未落盘，保留幂等键供重试，不会出现半个版本
      reportConflict(error, `发布 ${selectedContract.name} v${version.trim()}`);
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
          发布一次性冻结定义、有效逐条结论、调用方确认与豁免。失败用同一发布请求重试，
          系统按幂等键去重，绝不留下半个或重复版本。待确认项与评审队列、变更报告同源。
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>正式版本记录（最终版本）</CardTitle>
            <p className="mt-1 text-xs text-slate-500">{versions.length} 个冻结版本</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">契约</th>
                    <th className="px-4 py-3 font-medium">版本</th>
                    <th className="px-4 py-3 font-medium">发布时间</th>
                    <th className="px-4 py-3 font-medium">校验值</th>
                    <th className="px-4 py-3 font-medium">随版内容</th>
                    <th className="px-4 py-3 font-medium">发布说明</th>
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
                        <div className="mt-1 text-[10px] text-slate-400">
                          定义第 {release.definitionRevision} 版
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">
                        {formatDateTime(release.releasedAt)}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">
                        {release.checksum}
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-600">
                        <div>结论 {release.changes.length} 条</div>
                        <div>确认 {release.confirmations.length} 方</div>
                        <div>豁免 {release.exemptions.length} 条</div>
                      </td>
                      <td className="max-w-md px-4 py-4 text-slate-600">{release.notes}</td>
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
                发布门禁实时检查当前定义（修订 r
                {selectedContract?.revision ?? '-'}）
              </p>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedContractId}
                onValueChange={(value) => {
                  setSelectedContract(value);
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
                      {contract.name} · v{contract.version} · r{contract.revision}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedContract && gate && (
                <div className="mt-4">
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
                          ? '先处理下列与评审队列同源的待确认项。'
                          : '可以冻结正式版本，定义、有效结论、确认与豁免将一起进入不可变快照。'}
                      </p>
                    </div>
                  </div>

                  {(pendingChangeItems.length > 0 || pendingConsumerItems.length > 0) && (
                    <div className="mt-3 max-h-52 space-y-1.5 overflow-auto rounded-md border border-amber-200 bg-amber-50 p-2">
                      {pendingChangeItems.map((item) => (
                        <div key={item.key} className="text-[11px] leading-5 text-amber-900">
                          {item.stale ? '[重新评审] ' : '[待评审] '}
                          {item.change.method} {item.change.path}
                          <span className="text-amber-600">
                            {' '}
                            （第 {item.change.definitionRevision} 版结论 / 当前第{' '}
                            {item.definitionRevision} 版）
                          </span>
                        </div>
                      ))}
                      {pendingConsumerItems.map((item) => (
                        <div key={item.key} className="flex items-center gap-1 text-[11px] leading-5 text-amber-900">
                          <Users className="h-3 w-3 shrink-0" />
                          {item.stale ? '[重新确认] ' : '[待确认] '}
                          {item.consumerName}（{item.clientVersion}）
                        </div>
                      ))}
                    </div>
                  )}

                  {gate.warnings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {gate.warnings.map((issue) => (
                        <p key={issue.id} className="text-[11px] leading-5 text-amber-700">
                          警告：{issue.title}
                        </p>
                      ))}
                    </div>
                  )}

                  <label className="mt-4 block text-xs font-medium text-slate-700">新版本号</label>
                  <Input
                    className="mt-1.5"
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="2.9.0"
                  />
                  <label className="mt-4 block text-xs font-medium text-slate-700">发布说明</label>
                  <Textarea
                    className="mt-1.5"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="版本变化、兼容层和调用方升级状态"
                  />
                  <Button
                    className="mt-4 w-full"
                    disabled={!!blockers || !version.trim() || freezeVersion.isPending}
                    onClick={() => void freeze()}
                  >
                    <LockKeyhole className="h-4 w-4" />
                    {freezeVersion.isPending ? '冻结中（可安全重试）' : '冻结正式版本'}
                  </Button>
                  <p className="mt-2 text-[10px] leading-4 text-slate-400">
                    幂等键 {releaseKey.slice(0, 13)}…：本次发布期间固定，重试不会产生重复版本。
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>冻结策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <Policy icon={Archive} text="版本快照包含完整定义、有效结论、调用方确认与豁免。" />
              <Policy icon={PackageCheck} text="新版本发布不会覆盖旧版记录，结论继续修订也不影响已发布版本。" />
              <Policy icon={LockKeyhole} text="定义与结论按修订号绑定，失效结论不允许进入发布快照。" />
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

function randomKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
