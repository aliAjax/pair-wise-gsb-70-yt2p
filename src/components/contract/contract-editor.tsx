import Editor from '@monaco-editor/react';
import { RotateCcw, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import type { ApiContract } from '../../models/contract';
import { useDraftStore } from '../../store/draft-store';

interface ContractEditorProps {
  contract: ApiContract;
  onSave: (value: string) => void;
  onDiscard?: () => void;
  saving: boolean;
}

export function ContractEditor({ contract, onSave, onDiscard, saving }: ContractEditorProps) {
  const draft = useDraftStore((state) => state.definitions[contract.id]);
  const saveDraft = useDraftStore((state) => state.saveDefinitionDraft);
  const clearDraft = useDraftStore((state) => state.clearDefinitionDraft);
  // 初始内容：有未提交草稿就恢复草稿（冲突后草稿依然在），否则用最新定义。
  const [value, setValue] = useState(draft ?? contract.openapi);
  const editing = useRef(false);

  // 对方在另一标签页保存后，只要本地没有未提交编辑，就跟随最新定义。
  useEffect(() => {
    if (!editing.current && draft === undefined) {
      setValue(contract.openapi);
    }
  }, [contract.openapi, draft]);

  const dirty = value !== contract.openapi;

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <span className="text-xs font-medium text-slate-700">OpenAPI 源定义</span>
          <span className="ml-2 rounded-sm bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200">
            定义 v{contract.definitionVersion} · 修订 {contract.revision}
          </span>
          {contract.lastEditedBy && (
            <span className="ml-2 text-[11px] text-slate-500">
              最近保存：{contract.lastEditedBy}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setValue(contract.openapi);
                clearDraft(contract.id);
                onDiscard?.();
                editing.current = false;
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              还原
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={saving || !dirty}
            onClick={() => onSave(value)}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? '保存中' : '保存定义'}
          </Button>
        </div>
      </div>
      {dirty && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          有未保存的本地草稿。若与对方修改冲突，系统会保留这份草稿并请你确认合并方式。
        </div>
      )}
      <Editor
        height="430px"
        language="plaintext"
        theme="vs"
        value={value}
        onChange={(nextValue) => {
          editing.current = true;
          const next = nextValue ?? '';
          setValue(next);
          saveDraft(contract.id, next);
        }}
        options={{
          minimap: { enabled: false },
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
        }}
      />
    </div>
  );
}
