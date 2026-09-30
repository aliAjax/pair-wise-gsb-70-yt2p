import { DiffEditor } from '@monaco-editor/react';
import {
  AlertTriangle,
  Check,
  History,
  Merge,
  PencilLine,
  X,
} from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  SECTION_LABELS,
  type ApiContract,
  type ContractChange,
  type EditSection,
} from '../../models/contract';
import { describeSectionChange } from '../../models/review';
import { bulkReviewChanges, RevisionConflictError } from '../../services/contract-service';
import { useConflictStore } from '../../store/conflict-store';
import { useQueryClient } from '@tanstack/react-query';
import { contractKeys } from '../../services/contract-queries';
import { useNoticeStore } from '../../store/notice-store';

function SectionBadges({ sections }: { sections: EditSection[] }) {
  if (!sections.length) {
    return <span className="text-xs text-slate-400">无可检测区段</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {sections.map((section) => (
        <Badge key={section} tone="blue">
          {SECTION_LABELS[section]}
        </Badge>
      ))}
    </div>
  );
}

function ReviewDelta({
  base,
  target,
  tone,
}: {
  base: ApiContract;
  target: ApiContract;
  tone: 'slate' | 'sky';
}) {
  const baseById = new Map(base.changes.map((change) => [change.id, change]));
  const deltas: Array<{ change: ContractChange; text: string }> = [];
  target.changes.forEach((change) => {
    const previous = baseById.get(change.id);
    if (!previous) return;
    if (
      previous.reviewState !== change.reviewState ||
      previous.reviewComment !== change.reviewComment ||
      previous.impactStatement !== change.impactStatement ||
      previous.migrationPlan !== change.migrationPlan
    ) {
      deltas.push({
        change,
        text:
          previous.reviewState !== change.reviewState
            ? `${previous.reviewState} → ${change.reviewState}`
            : change.reviewComment || '影响/迁移说明更新',
      });
    }
  });
  const box =
    tone === 'sky'
      ? 'border-sky-200 bg-sky-50'
      : 'border-slate-200 bg-slate-50';
  return (
    <div className={`rounded-md border p-3 ${box}`}>
      {deltas.length ? (
        <ul className="space-y-2 text-xs leading-5">
          {deltas.slice(0, 6).map(({ change, text }) => (
            <li key={change.id}>
              <div className="font-mono text-[11px] text-slate-700">
                {change.method} {change.path}
              </div>
              <div className="text-slate-600">{text}</div>
            </li>
          ))}
          {deltas.length > 6 && <li className="text-slate-500">…共 {deltas.length} 项</li>}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">无逐条结论改动</p>
      )}
    </div>
  );
}

export function ConflictDialog() {
  const queryClient = useQueryClient();
  const single = useConflictStore((state) => state.single);
  const bulk = useConflictStore((state) => state.bulk);
  const resolving = useConflictStore((state) => state.resolving);
  const setResolving = useConflictStore((state) => state.setResolving);
  const close = useConflictStore((state) => state.close);
  const notify = useNoticeStore((state) => state.notify);

  if (!single && !bulk) return null;

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: contractKeys.all });
  }

  async function forceSingle() {
    if (!single) return;
    setResolving(true);
    try {
      await single.forceRetry();
      await invalidate();
      notify('success', '已保留你的草稿并保存', '冲突区段使用了你的版本，对方的其他改动仍保留。');
      close();
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        useConflictStore.getState().showSingle(error.context);
      }
      setResolving(false);
      notify('info', '重试失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function forceBulk() {
    if (!bulk) return;
    setResolving(true);
    try {
      // 冲突重试时契约修订号已变化，baseRevision 不再可靠：
      // force 模式下服务端按最新版本重做，这里仅用于满足入参结构。
      const revisionById = new Map(
        bulk.conflicts.map((conflict) => [conflict.contractId, conflict.currentRevision]),
      );
      await bulkReviewChanges({
        selections: bulk.selections.map((item) => ({
          ...item,
          baseRevision: revisionById.get(item.contractId) ?? 0,
        })),
        state: bulk.state,
        reviewer: bulk.reviewer,
        comment: bulk.comment,
        force: true,
      });
      await invalidate();
      notify('success', '批量结论已在最新版本上保存', undefined);
      close();
    } catch (error) {
      setResolving(false);
      notify('info', '重试失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !resolving && close()}>
      <DialogContent className="w-[min(900px,calc(100vw-32px))]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <DialogTitle>保存冲突：契约已被另一位评审人更新</DialogTitle>
          </div>
          <DialogDescription>
            系统没有覆盖任何内容。请先查看对方改动，再决定放弃本地修改，或保留草稿重试。
          </DialogDescription>
        </DialogHeader>

        {single && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <PencilLine className="h-4 w-4" />
              <span>
                你（{single.editor}）正在执行「{single.actionLabel}」，基于修订 {single.baseRevision}
                ；契约当前已到修订 {single.currentRevision}。
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <History className="h-3.5 w-3.5" />
                  对方已经保存的改动
                </div>
                <div className="space-y-2">
                  <SectionBadges sections={single.theirSections} />
                  {single.theirSections.map((section) => (
                    <div
                      key={section}
                      className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600"
                    >
                      <strong className="text-slate-800">{SECTION_LABELS[section]}</strong>
                      <p className="mt-1">
                        {describeSectionChange(single.base, single.theirs, section)}
                      </p>
                    </div>
                  ))}
                  <ReviewDelta base={single.base} target={single.theirs} tone="slate" />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-sky-800">
                  <Merge className="h-3.5 w-3.5" />
                  {single.actionLabel.includes('发布')
                    ? '你的发布请求'
                    : '你的草稿（已保留，未丢失）'}
                </div>
                <div className="space-y-2">
                  {single.mySections.length ? (
                    <>
                      <SectionBadges sections={single.mySections} />
                      {single.mySections.map((section) => (
                        <div
                          key={section}
                          className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900"
                        >
                          <strong>{SECTION_LABELS[section]}</strong>
                          <p className="mt-1">
                            {describeSectionChange(single.base, single.mine, section)}
                          </p>
                        </div>
                      ))}
                      <ReviewDelta base={single.base} target={single.mine} tone="sky" />
                    </>
                  ) : (
                    <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
                      {single.actionLabel.includes('发布')
                        ? '发布前对方又保存了内容。「用我的版本重试」会在最新内容上重新跑发布门禁：若门禁仍通过才会冻结；否则请先处理新出现的待确认项。'
                        : '未检测到本地区段改动。'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {single.mySections.includes('definition') &&
              single.theirSections.includes('definition') && (
                <div className="overflow-hidden rounded-md border border-slate-200">
                  <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600">
                    定义差异：左为对方版本，右为你的草稿
                  </div>
                  <DiffEditor
                    height="260px"
                    language="plaintext"
                    original={single.theirs.openapi}
                    modified={single.mine.openapi}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      automaticLayout: true,
                    }}
                  />
                </div>
              )}

            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={resolving} onClick={close}>
                <X className="h-4 w-4" />
                放弃我的修改，采用对方版本
              </Button>
              <Button disabled={resolving} onClick={() => void forceSingle()}>
                <Check className="h-4 w-4" />
                {resolving ? '正在保存…' : '保留草稿，用我的版本重试'}
              </Button>
            </div>
            <p className="text-[11px] leading-5 text-slate-400">
              选择「用我的版本重试」时，只会覆盖双方都修改的冲突区段；对方在其他区段的改动会被保留。
            </p>
          </div>
        )}

        {bulk && (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
              批量结论涉及 {bulk.selections.length} 个变更项，其中 {bulk.conflicts.length}{' '}
              个契约在此期间被其他评审人更新。系统未写入任何结论。
            </div>
            <div className="space-y-2">
              {bulk.conflicts.map((conflict) => (
                <div
                  key={conflict.contractId}
                  className="rounded-md border border-slate-200 p-3 text-xs"
                >
                  <strong className="text-sm">{conflict.contractName}</strong>
                  <p className="mt-1 text-slate-500">
                    修订 {conflict.baseRevision} → {conflict.currentRevision}，对方改动：
                  </p>
                  <div className="mt-2">
                    <SectionBadges sections={conflict.theirSections} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <Button variant="secondary" disabled={resolving} onClick={close}>
                <X className="h-4 w-4" />
                取消，我先去看对方改动
              </Button>
              <Button disabled={resolving} onClick={() => void forceBulk()}>
                <Check className="h-4 w-4" />
                {resolving ? '正在保存…' : '在最新版本上重做批量结论'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
