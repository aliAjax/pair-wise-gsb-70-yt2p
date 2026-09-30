import { Download, FileJson, FileText, ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
import { PendingSummary } from '../components/contract/pending-summary';
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
import {
  isChangeStale,
  isConsumerUnconfirmed,
} from '../models/contract';
import {
  getAllPendingItems,
  pendingSummary,
} from '../models/review';
import { buildChangeReport } from '../services/contract-service';
import { useContracts } from '../services/contract-queries';
import { useReviewStore } from '../store/review-store';

export function ReportsPage() {
  const contracts = useContracts();
  const selectedContractId = useReviewStore((state) => state.selectedContractId);
  const setSelectedContract = useReviewStore((state) => state.setSelectedContract);
  const contract =
    (contracts.data ?? []).find((item) => item.id === selectedContractId) ??
    contracts.data?.[0];

  const report = useMemo(() => (contract ? buildChangeReport(contract) : ''), [contract]);
  const summary = contract ? pendingSummary(contract) : null;
  const allPending = useMemo(
    () => getAllPendingItems(contracts.data ?? []),
    [contracts.data],
  );

  return (
    <div>
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Change Report</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950 sm:text-3xl">
            契约变更报告
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            待确认项与评审队列、发布门禁同源；报告标注失效结论、调用方确认状态和有效豁免，供发布评审归档。
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
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <Badge tone="blue">定义第 {contract.definitionVersion} 版</Badge>
              <Badge tone={summary && summary.total === 0 ? 'green' : 'amber'}>
                {summary && summary.total === 0
                  ? '待确认项已清空'
                  : `${summary?.total ?? 0} 项待确认`}
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
                <CardTitle>同源待确认项</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  全局共 {allPending.length} 项；当前契约 {summary?.total ?? 0} 项
                </p>
              </CardHeader>
              <CardContent>
                <PendingSummary contract={contract} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>豁免记录</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  仅有效豁免会进入发布快照；定义变更后失效的豁免保留记录但标注作废
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {contract.exemptions.map((exemption) => {
                  const active =
                    exemption.active !== false &&
                    (exemption.definitionVersion ?? 1) >= contract.definitionVersion;
                  return (
                    <article
                      key={exemption.id}
                      className={
                        active
                          ? 'rounded-md border border-blue-200 bg-blue-50 p-3'
                          : 'rounded-md border border-slate-200 bg-slate-50 p-3'
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong
                          className={
                            active ? 'text-sm text-blue-950' : 'text-sm text-slate-500 line-through'
                          }
                        >
                          {exemption.scope}
                        </strong>
                        <Badge tone={active ? 'blue' : 'neutral'}>
                          {active ? `至 ${exemption.expiresAt}` : '已作废'}
                        </Badge>
                      </div>
                      <p
                        className={
                          active
                            ? 'mt-2 text-xs leading-5 text-blue-900'
                            : 'mt-2 text-xs leading-5 text-slate-400'
                        }
                      >
                        {exemption.reason}
                      </p>
                      <div
                        className={
                          active
                            ? 'mt-2 text-[11px] text-blue-800'
                            : 'mt-2 text-[11px] text-slate-400'
                        }
                      >
                        批准人：{exemption.approvedBy} · 第 {exemption.definitionVersion ?? 1}{' '}
                        版定义
                        {!active && exemption.voidReason ? ` · ${exemption.voidReason}` : ''}
                      </div>
                    </article>
                  );
                })}
                {!contract.exemptions.length && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                    当前没有兼容层豁免。
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>评审签名与调用方确认</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {contract.changes.map((change) => (
                  <div
                    key={change.id}
                    className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <div className="font-mono text-[11px] text-slate-600">
                        {change.method} {change.path}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {change.reviewer || '尚未评审'}（第 {change.definitionVersion ?? 1} 版）
                      </div>
                    </div>
                    <div className="text-right">
                      {isChangeStale(change, contract.definitionVersion) ? (
                        <Badge tone="amber">失效待重新确认</Badge>
                      ) : (
                        <Badge
                          tone={
                            change.reviewState === 'accepted'
                              ? 'green'
                              : change.reviewState === 'returned'
                                ? 'red'
                                : change.reviewState === 'exemption'
                                  ? 'blue'
                                  : 'amber'
                          }
                        >
                          {change.reviewState}
                        </Badge>
                      )}
                      {change.reviewedAt && (
                        <div className="mt-1 text-[10px] text-slate-400">
                          {formatDateTime(change.reviewedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-3">
                  {contract.consumers.map((consumer) => {
                    const unconfirmed = isConsumerUnconfirmed(
                      consumer,
                      contract.definitionVersion,
                    );
                    return (
                      <div
                        key={consumer.id}
                        className="flex items-center justify-between gap-2 py-1.5 text-xs"
                      >
                        <span className="text-slate-600">{consumer.name}</span>
                        {unconfirmed ? (
                          <Badge tone="red">待确认</Badge>
                        ) : (
                          <Badge tone="green">
                            已确认 · {consumer.confirmation?.confirmedBy}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              正式版本发布后，归档报告来自不可变快照，与当前工作副本的后续修改互不影响。
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
