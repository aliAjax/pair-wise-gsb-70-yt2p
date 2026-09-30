import { CheckCircle2, GitMerge, X } from 'lucide-react';
import { useEffect } from 'react';
import { useNoticeStore } from '../../store/notice-store';

/** 全局轻提示：自动合并、发布成功等非阻断反馈。 */
export function NoticeToast() {
  const notice = useNoticeStore((state) => state.notice);
  const dismiss = useNoticeStore((state) => state.dismiss);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);

  if (!notice) return null;

  const Icon = notice.tone === 'success' ? CheckCircle2 : GitMerge;
  const theme =
    notice.tone === 'success'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
      : 'border-sky-300 bg-sky-50 text-sky-900';

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[min(380px,calc(100vw-32px))]">
      <div className={`flex items-start gap-3 rounded-md border p-3 shadow-lg ${theme}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <strong className="text-sm">{notice.title}</strong>
          {notice.detail && (
            <p className="mt-1 text-xs leading-5 opacity-80">{notice.detail}</p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-0.5 opacity-60 hover:opacity-100"
          aria-label="关闭提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
