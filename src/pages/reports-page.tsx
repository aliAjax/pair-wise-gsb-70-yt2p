import { Download, FileJson, FileText, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { formatDateTime } from '../lib/utils';
import { buildChangeReport } from '../services/contract-service';
import { useContracts } from '../services/contract-queries';
import {
  latestVersion,
  pendingCounts,
} from '../services/review-derivation';
import { useReviewStore } from '../store/review-store';

export function ReportsPage() {
  const contracts = useContracts();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const contract =
    (contracts.data ?? []).find((item) => item.id === selectedContractId) ??
    contracts.data?.[0];

  const report = useMemo(() => (contract ? buildChangeReport(contract) : ''), [contract]);
  const pending = contract ? pendingCounts(contract) : null;
  const finalVersion = contract ? latestVersion(contract) : undefined;

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Change Report</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
            契约变更报告
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            汇总接口差异、兼容性结论、调用方影响、迁移方案和兼容层豁免，供发布评审归档。
          </p>
        </div>
        {contract && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                downloadText(
                  `${contract.id}-${contract.version}.json`,
                  JSON.stringify(contract, null, 2),
                  'application/json;charset=utf-8',
                )
              }
            >
              <FileJson className="h-4 w-4" />
              导出 JSON
            </Button>
            <Button
              onClick={() =>
                downloadText(
                  `${contract.id}-${contract.version}-change-report.md`,
                  report,
                  'text/markdown;charset=utf-8',
                )
              }
            >
              <Download className="h-4 w-4" />
              导出报告
            </Button>
          </div>
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <span className="text-sm font-medium text-slate-700">选择契约</span>
          <Select
            value={contract?.id ?? ''}
            onValueChange={setSelectedContract}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue placeholder="选择契约" />
            </SelectTrigger>
            <SelectContent>
              {(contracts.data ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} · v{item.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {contract && (
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Badge tone="blue">{contract.domain}</Badge>
              <Badge tone="neutral">定义第 {contract.definitionRevision} 版</Badge>
              <Badge tone={pending && pending.total === 0 ? 'green' : 'amber'}>
                {pending && pending.total === 0
                  ? '待确认项已清零'
                  : `${pending?.total ?? 0} 项待确认（含失效重提）`}
              </Badge>
              <Badge tone={finalVersion ? 'green' : 'neutral'}>
                {finalVersion ? `最终版本 v${finalVersion.version}` : '尚未发布'}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {contract ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>报告预览</CardTitle>
                <p className="mt-1 text-xs text-slate-500">Markdown 归档格式</p>
              </div>
              <FileText className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent>
              <pre className="max-h-[720px] overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100">
                {report}
              </pre>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>豁免记录</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  兼容层范围、原因和到期时间会进入正式报告
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {contract.exemptions.map((exemption) => (
                  <article
                    key={exemption.id}
                    className="rounded-md border border-blue-200 bg-blue-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-blue-950">{exemption.scope}</strong>
                      <Badge tone="blue">至 {exemption.expiresAt}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-blue-900">{exemption.reason}</p>
                    <div className="mt-2 text-[11px] text-blue-800">
                      批准人：{exemption.approvedBy}
                    </div>
                  </article>
                ))}
                {!contract.exemptions.length && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    当前没有兼容层豁免。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>评审签名</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {contract.changes.map((change) => {
                  const current = change.definitionRevision >= contract.definitionRevision;
                  return (
                    <div
                      key={change.id}
                      className={
                        current
                          ? 'flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0'
                          : 'flex items-start justify-between gap-3 rounded border border-amber-200 bg-amber-50 p-2'
                      }
                    >
                      <div>
                        <div className="font-mono text-[11px] text-slate-600">
                          {change.method} {change.path}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {change.reviewer || '尚未评审'} · 第 {change.definitionRevision} 版结论
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge tone={current ? toneOf(change.reviewState) : 'amber'}>
                          {current ? change.reviewState : '已失效需重新确认'}
                        </Badge>
                        {change.reviewedAt && current && (
                          <div className="mt-1 text-[10px] text-slate-400">
                            {formatDateTime(change.reviewedAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {finalVersion && (
              <Card className="border-emerald-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <LockKeyhole className="h-4 w-4 text-emerald-700" />
                    最终版本 v{finalVersion.version}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs text-slate-600">
                  <div>发布于 {formatDateTime(finalVersion.releasedAt)}</div>
                  <div className="font-mono">校验值 {finalVersion.checksum}</div>
                  <div>定义第 {finalVersion.definitionRevision} 版</div>
                  <div>
                    随版结论 {finalVersion.changes.length} 条 · 调用方确认{' '}
                    {finalVersion.confirmations.length} 方 · 豁免{' '}
                    {finalVersion.exemptions.length} 条
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              待确认项、最终版本与评审队列、发布页同源；正式版本冻结后仍可在历史版本页比较工作副本与发布快照。
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-sm text-slate-500">
            暂无可生成报告的契约。
          </CardContent>
        </Card>
      )}
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

function toneOf(
  state: string,
): 'green' | 'red' | 'blue' | 'amber' | 'neutral' {
  if (state === 'accepted') return 'green';
  if (state === 'returned') return 'red';
  if (state === 'exemption') return 'blue';
  return 'amber';
}
