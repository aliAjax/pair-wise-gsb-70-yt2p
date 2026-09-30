import { CheckCircle2, CircleAlert, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { formatNumber } from '../../lib/utils';
import type { ApiConsumer, ConsumerConfirmation } from '../../models/contract';
import { useDraftStore } from '../../store/draft-store';

interface ConsumerConfirmationPanelProps {
  contractId: string;
  consumers: ApiConsumer[];
  confirmations: ConsumerConfirmation[];
  currentDefinitionRevision: number;
  serverRevision: number;
  saving: boolean;
  onConfirm: (input: {
    consumerId: string;
    confirmed: boolean;
    confirmer: string;
    comment: string;
  }) => Promise<void>;
}

export function ConsumerConfirmationPanel({
  contractId,
  consumers,
  confirmations,
  currentDefinitionRevision,
  serverRevision,
  saving,
  onConfirm,
}: ConsumerConfirmationPanelProps) {
  const saveConfirmationDraft = useDraftStore(
    (state) => state.saveConfirmationDraft,
  );
  const takeConfirmationDraft = useDraftStore(
    (state) => state.takeConfirmationDraft,
  );

  return (
    <div className="divide-y divide-slate-100">
      {consumers.map((consumer) => (
        <ConsumerRow
          key={consumer.id}
          contractId={contractId}
          consumer={consumer}
          confirmation={confirmations.find(
            (item) => item.consumerId === consumer.id,
          )}
          currentDefinitionRevision={currentDefinitionRevision}
          serverRevision={serverRevision}
          saving={saving}
          onConfirm={onConfirm}
          saveDraft={saveConfirmationDraft}
          takeDraft={takeConfirmationDraft}
        />
      ))}
      {!consumers.length && (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          尚未登记调用方，发布前需要补充依赖清单。
        </p>
      )}
    </div>
  );
}

function ConsumerRow({
  contractId,
  consumer,
  confirmation,
  currentDefinitionRevision,
  serverRevision,
  saving,
  onConfirm,
  saveDraft,
  takeDraft,
}: {
  contractId: string;
  consumer: ApiConsumer;
  confirmation?: ConsumerConfirmation;
  currentDefinitionRevision: number;
  serverRevision: number;
  saving: boolean;
  onConfirm: ConsumerConfirmationPanelProps['onConfirm'];
  saveDraft: ReturnType<typeof useDraftStore.getState>['saveConfirmationDraft'];
  takeDraft: ReturnType<typeof useDraftStore.getState>['takeConfirmationDraft'];
}) {
  const current =
    confirmation?.state === 'confirmed' &&
    confirmation.definitionRevision >= currentDefinitionRevision;
  const [confirmer, setConfirmer] = useState(
    confirmation?.state === 'confirmed' ? confirmation.confirmer : '',
  );
  const [comment, setComment] = useState(
    confirmation?.state === 'confirmed' ? confirmation.comment : '',
  );
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const draft = takeDraft(contractId, consumer.id);
    if (draft) {
      setConfirmer(draft.confirmer);
      setComment(draft.comment);
      setRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRevision]);

  async function submit(confirmed: boolean) {
    try {
      await onConfirm({
        consumerId: consumer.id,
        confirmed,
        confirmer: confirmer.trim() || consumer.owner,
        comment: comment.trim(),
      });
      setRestored(false);
    } catch {
      saveDraft(contractId, consumer.id, {
        confirmer,
        comment,
      });
    }
  }

  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm font-semibold text-slate-900">
            {consumer.name}
          </strong>
          <Badge tone={consumer.environment === '生产' ? 'blue' : 'neutral'}>
            {consumer.environment}
          </Badge>
          {current ? (
            <Badge tone="green">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              已确认第 {confirmation?.definitionRevision} 版定义
            </Badge>
          ) : (
            <Badge tone="amber">
              <CircleAlert className="mr-1 h-3 w-3" />
              待确认第 {currentDefinitionRevision} 版定义
            </Badge>
          )}
        </div>
        <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
          <span>团队：{consumer.owner}</span>
          <span>版本：{consumer.clientVersion}</span>
          <span>日均调用：{formatNumber(consumer.requestsPerDay)}</span>
          <span>联系人：{consumer.contact}</span>
        </div>
        {confirmation?.state === 'confirmed' && !current && (
          <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
            此前确认针对第 {confirmation.definitionRevision} 版定义（
            {confirmation.confirmer}），定义已更新，需要重新确认。
          </p>
        )}
        {restored && (
          <p className="mt-2 text-[11px] text-amber-700">
            已恢复你上次保存失败时的确认草稿。
          </p>
        )}
      </div>
      <div className="space-y-2">
        <input
          className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-400"
          value={confirmer}
          onChange={(event) => setConfirmer(event.target.value)}
          placeholder="确认人（团队 / 姓名）"
        />
        <Textarea
          className="min-h-16 text-xs"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="确认已兼容当前定义，或说明尚未确认的原因"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={saving || !comment.trim()}
            onClick={() => void submit(true)}
          >
            <Save className="h-3.5 w-3.5" />
            {current ? '更新确认' : '确认当前定义'}
          </Button>
          {current && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => void submit(false)}
            >
              撤回
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
