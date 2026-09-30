import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { formatDateTime, formatNumber } from '../../lib/utils';
import {
  isConsumerUnconfirmed,
  type ApiConsumer,
} from '../../models/contract';
import { useDraftStore } from '../../store/draft-store';

interface ConsumerTableProps {
  consumers: ApiConsumer[];
  definitionVersion: number;
  savingId?: string;
  onConfirm: (consumerId: string, comment: string) => void;
}

export function ConsumerTable({
  consumers,
  definitionVersion,
  savingId,
  onConfirm,
}: ConsumerTableProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">调用方</th>
            <th className="px-4 py-3 font-medium">团队</th>
            <th className="px-4 py-3 font-medium">环境</th>
            <th className="px-4 py-3 font-medium">客户端版本</th>
            <th className="px-4 py-3 font-medium">日均调用</th>
            <th className="px-4 py-3 font-medium">影响确认</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {consumers.map((consumer) => (
            <ConsumerRow
              key={consumer.id}
              consumer={consumer}
              definitionVersion={definitionVersion}
              saving={savingId === consumer.id}
              open={openId === consumer.id}
              onToggleOpen={() =>
                setOpenId((current) => (current === consumer.id ? null : consumer.id))
              }
              onConfirm={(comment) => {
                onConfirm(consumer.id, comment);
                setOpenId(null);
              }}
            />
          ))}
        </tbody>
      </table>
      {!consumers.length && (
        <p className="px-4 py-10 text-center text-sm text-slate-500">
          尚未登记调用方，发布前需要补充依赖清单。
        </p>
      )}
    </div>
  );
}

function ConsumerRow({
  consumer,
  definitionVersion,
  saving,
  open,
  onToggleOpen,
  onConfirm,
}: {
  consumer: ApiConsumer;
  definitionVersion: number;
  saving: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onConfirm: (comment: string) => void;
}) {
  const draft = useDraftStore((state) => state.consumerComments[consumer.id]);
  const saveDraft = useDraftStore((state) => state.saveConsumerDraft);
  const clearDraft = useDraftStore((state) => state.clearConsumerDraft);
  const [comment, setComment] = useState(draft ?? consumer.confirmation?.comment ?? '');
  const unconfirmed = isConsumerUnconfirmed(consumer, definitionVersion);
  const confirmation = consumer.confirmation;

  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-4 py-3">
          <div className="font-medium text-slate-900">{consumer.name}</div>
          <div className="mt-1 text-xs text-sky-800">{consumer.contact}</div>
        </td>
        <td className="px-4 py-3 text-slate-700">{consumer.owner}</td>
        <td className="px-4 py-3">
          <Badge tone={consumer.environment === '生产' ? 'blue' : 'neutral'}>
            {consumer.environment}
          </Badge>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-slate-700">
          {consumer.clientVersion}
        </td>
        <td className="px-4 py-3 text-slate-700">{formatNumber(consumer.requestsPerDay)}</td>
        <td className="px-4 py-3">
          {unconfirmed ? (
            <div className="flex items-center gap-1.5 text-xs text-amber-800">
              <RotateCcw className="h-3.5 w-3.5" />
              {confirmation
                ? `旧确认基于第 ${confirmation.definitionVersion} 版，需重新确认`
                : '尚未确认'}
            </div>
          ) : (
            <div className="text-xs text-emerald-800">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {confirmation?.confirmedBy} 已确认
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                基于第 {confirmation?.definitionVersion} 版 ·{' '}
                {confirmation ? formatDateTime(confirmation.confirmedAt) : ''}
              </div>
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <Button size="sm" variant={unconfirmed ? 'default' : 'secondary'} onClick={onToggleOpen}>
            {unconfirmed ? '确认影响' : '再次确认'}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={7} className="px-4 py-3">
            <label className="mb-1.5 block text-xs font-medium text-slate-700">
              调用方确认意见（确认内容会记录在第 {definitionVersion} 版定义上）
            </label>
            <div className="flex gap-2">
              <Textarea
                className="min-h-16 flex-1"
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                  saveDraft(consumer.id, event.target.value);
                }}
                placeholder="例如：已完成影响评估，4.6.2 客户端兼容新字段，无需兼容层。"
              />
              <div className="flex shrink-0 flex-col gap-2">
                <Button
                  size="sm"
                  disabled={!comment.trim() || saving}
                  onClick={() => {
                    onConfirm(comment.trim());
                    clearDraft(consumer.id);
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {saving ? '提交中' : '提交确认'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onToggleOpen();
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
