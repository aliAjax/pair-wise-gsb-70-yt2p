import Editor from '@monaco-editor/react';
import { AlertTriangle, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import type { ApiContract } from '../../models/contract';
import { useDraftStore } from '../../store/draft-store';

interface ContractEditorProps {
  contract: ApiContract;
  onSave: (value: string) => void | Promise<void>;
  saving: boolean;
  /** 保存冲突后需要恢复的本地草稿（由页面在 query 刷新后传入） */
  draftKey: string;
}

export function ContractEditor({ contract, onSave, saving, draftKey }: ContractEditorProps) {
  const [value, setValue] = useState(contract.openapi);
  const [restored, setRestored] = useState(false);
  const saveDefinitionDraft = useDraftStore((state) => state.saveDefinitionDraft);
  const takeDefinitionDraft = useDraftStore((state) => state.takeDefinitionDraft);
  const lastServerOpenApi = useRef(contract.openapi);

  // 服务端定义变化（对方保存成功）后：保留用户正在编辑的草稿，不直接覆盖输入框
  useEffect(() => {
    if (lastServerOpenApi.current === contract.openapi) return;
    const draft = takeDefinitionDraft(draftKey);
    if (draft !== undefined && draft !== contract.openapi) {
      setValue(draft);
      setRestored(true);
    } else {
      setValue(contract.openapi);
      setRestored(false);
    }
    lastServerOpenApi.current = contract.openapi;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.openapi, draftKey]);

  const dirty = value !== contract.openapi;

  async function handleSave() {
    try {
      await onSave(value);
      setRestored(false);
    } catch (error) {
      // 冲突时把草稿持久化，由全局弹窗引导合并；非冲突错误继续向上抛
      saveDefinitionDraft(draftKey, value);
      throw error;
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <span className="text-xs font-medium text-slate-700">OpenAPI 源定义</span>
          <span className="ml-2 text-[11px] text-slate-500">
            第 {contract.definitionRevision} 版 · 保存冲突不会覆盖对方内容
          </span>
        </div>
        <Button size="sm" variant="secondary" disabled={saving || !dirty} onClick={() => void handleSave()}>
          <Save className="h-3.5 w-3.5" />
          {saving ? '保存中' : '保存定义'}
        </Button>
      </div>
      {restored && dirty && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5" />
          对方已保存新定义，下方是你未提交的草稿，核对差异后再保存会触发冲突提示。
        </div>
      )}
      <Editor
        height="430px"
        language="plaintext"
        theme="vs"
        value={value}
        onChange={(nextValue) => setValue(nextValue ?? '')}
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
