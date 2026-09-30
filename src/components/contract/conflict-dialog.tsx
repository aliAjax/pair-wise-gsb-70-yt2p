import { GitPullRequestArrow, RotateCcw } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatDateTime } from '../../lib/utils';
import { isConclusionCurrent } from '../../models/contract';
import { useConflictStore } from '../../store/conflict-store';

const SECTION_LABELS = {
  definition: '接口定义',
  changes: '逐条结论',
  confirmations: '调用方确认',
  exemptions: '豁免登记',
} as const;

/**
 * 后提交的人先看到对方改了什么：
 * - 刷新为对方版本（放弃本次覆盖）
 * - 保留我的草稿（草稿已在冲突发生时自动留存，可在最新版本上继续合并）
 */
export function ConflictDialog() {
  const conflict = useConflictStore((state) => state.conflict);
  const dismiss = useConflictStore((state) => state.dismiss);

  if (!conflict) return null;
  const { server } = conflict;
  const staleChanges = server.changes.filter(
    (change) => !isConclusionCurrent(change, server),
  );
  const unconfirmed = server.consumers.filter((consumer) => {
    const confirmation = server.confirmations.find(
      (item) => item.consumerId === consumer.id,
    );
    return (
      !confirmation ||
      confirmation.state !== 'confirmed' ||
      confirmation.definitionRevision < server.definitionRevision
    );
  });

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="w-[min(860px,calc(100vw-32px))]">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="amber">保存冲突</Badge>
            <Badge tone="neutral">{SECTION_LABELS[conflict.section]}</Badge>
          </div>
          <DialogTitle className="mt-2">
            {conflict.contractName} 已被另一位评审人更新
          </DialogTitle>
          <DialogDescription>
            你打开页面时是第 {conflict.expectedRevision} 版，对方已保存到第{' '}
            {conflict.actualRevision} 版（定义第 {server.definitionRevision} 版，
            更新于 {formatDateTime(server.updatedAt)}）。系统没有覆盖对方的内容，
            你的草稿也已保留。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <section className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              对方这次改动
            </h4>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
              <li>
                契约修订号 {conflict.expectedRevision} → {conflict.actualRevision}
                {conflict.section === 'definition' && '，并产生了新的接口定义版本'}
              </li>
              <li>
                因定义更新而失效、需重新确认的结论：
                <strong className="text-amber-700"> {staleChanges.length} </strong> 条
              </li>
              <li>
                需要重新确认当前定义的调用方：
                <strong className="text-amber-700"> {unconfirmed.length} </strong> 方
                {unconfirmed.length > 0 && (
                  <span className="text-slate-500">
                    {' '}
                    （{unconfirmed.map((consumer) => consumer.name).join('、')}）
                  </span>
                )}
              </li>
            </ul>
          </section>

          {conflict.draftSummary && (
            <section className="rounded-md border border-sky-200 bg-sky-50 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                我未提交的草稿（已自动保留）
              </h4>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[11px] leading-5 text-slate-700">
                {conflict.draftSummary}
              </pre>
            </section>
          )}

          <p className="text-xs leading-5 text-slate-500">
            选择「采用对方版本」会用最新数据刷新当前页面，你的输入已留存在草稿中，可在对方版本上重新粘贴；
            选择「保留我的草稿」关闭弹窗，页面同样是最新数据，草稿可在对应输入区继续合并后再保存。
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={dismiss}>
            <GitPullRequestArrow className="h-4 w-4" />
            保留我的草稿，在最新版上合并
          </Button>
          <Button onClick={dismiss}>
            <RotateCcw className="h-4 w-4" />
            采用对方版本
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
