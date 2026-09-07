'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, Settings2, X } from 'lucide-react';
import type { ImageGenerateChatDraft } from './types';
import { SettingsPanel } from './settings-panel';
import type { ImageGenerateProviderDto } from '@/hooks/api/types';
import { useObjectUrl } from '@/hooks/use-object-url';

interface PromptComposerProps {
  draft: ImageGenerateChatDraft;
  onDraftChange: (next: ImageGenerateChatDraft) => void;
  /** 已附参考图(File 对象),null = 文生图。附图即图生图,无显式模式开关。 */
  referenceFile: File | null;
  onReferenceChange: (file: File | null) => void;
  onSubmit: () => void;
  busy: boolean;
  disabled?: boolean;
  providers: ImageGenerateProviderDto[];
  /** undefined = 未登录或额度未知,此时不显示额度行、不限数量。 */
  quota?: { limit: number; used: number; remaining: number };
  /** 当前来源是否支持图生图;不支持时禁掉参考图入口而不是隐藏。 */
  editSupported: boolean;
  /** 参考图大小上限(字节);超限文件直接拒收并提示。 */
  maxReferenceSize?: number;
}

/**
 * 底部输入条:附件 + 自动增高 textarea + 参数面板 + 生成按钮。
 *
 * 参考图三路进入:点附件按钮选文件、textarea 粘贴、整个卡片拖放。
 * Enter 提交 / Shift+Enter 换行;中文输入法组词中的回车不上屏(isComposing)。
 */
export function PromptComposer({
  draft,
  onDraftChange,
  referenceFile,
  onReferenceChange,
  onSubmit,
  busy,
  disabled = false,
  providers,
  quota,
  editSupported,
  maxReferenceSize,
}: PromptComposerProps) {
  const t = useTranslations('ImageGenerate');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceUrl = useObjectUrl(referenceFile);

  // 自动增高:每次内容变化后重置高度再按 scrollHeight 撑开,上限 10rem。
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft.prompt]);

  const acceptReference = (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (maxReferenceSize !== undefined && file.size > maxReferenceSize) {
      setReferenceError(t('referenceTooLarge'));
      return;
    }
    setReferenceError(null);
    onReferenceChange(file);
  };

  const quotaExhausted = quota !== undefined && quota.remaining <= 0;
  const canSubmit =
    !disabled && !busy && draft.prompt.trim().length > 0 && !quotaExhausted;

  return (
    <div
      className="relative"
      onDragOver={event => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={event => {
        event.preventDefault();
        setDragOver(false);
        if (!editSupported) return;
        acceptReference(event.dataTransfer.files?.[0]);
      }}
    >
      {settingsOpen && (
        <SettingsPanel
          value={draft}
          onChange={onDraftChange}
          disabled={busy}
          providers={providers}
          quotaRemaining={quota?.remaining}
        />
      )}

      <div
        className={`rounded-xl border bg-card p-2 shadow-sm transition-colors ${
          dragOver ? 'border-foreground' : 'border-border'
        }`}
      >
        {/* 参考图 chip:缩略图 + 移除。 */}
        {referenceFile && (
          <div className="flex items-center gap-2 px-1 pb-2 pt-1">
            {referenceUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={referenceUrl}
                alt={t('sourcePreviewAlt')}
                className="h-10 w-10 rounded-md border border-border object-cover"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {referenceFile.name}
            </span>
            <button
              type="button"
              aria-label={t('removeReference')}
              onClick={() => onReferenceChange(null)}
              className="rounded-sm p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label={t('attachReference')}
            title={editSupported ? t('attachReference') : t('providerNoEditHint')}
            disabled={disabled || busy || !editSupported}
            onClick={() => fileInputRef.current?.click()}
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              acceptReference(event.target.files?.[0]);
              // 同名文件二次选择也要触发 onChange:不清空 value 就不会。
              event.target.value = '';
            }}
          />

          <textarea
            ref={textareaRef}
            id="image-generate-prompt"
            value={draft.prompt}
            rows={1}
            maxLength={5000}
            placeholder={t('promptPlaceholder')}
            disabled={disabled || busy}
            onChange={event =>
              onDraftChange({ ...draft, prompt: event.target.value })
            }
            onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (canSubmit) onSubmit();
              }
            }}
            onPaste={event => {
              if (!editSupported) return;
              acceptReference(event.clipboardData.files?.[0]);
            }}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />

          <button
            type="button"
            aria-label={t('settingsTitle')}
            aria-pressed={settingsOpen}
            disabled={disabled || busy}
            onClick={() => setSettingsOpen(value => !value)}
            className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50 ${
              settingsOpen
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Settings2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmit}
            className="mb-0.5 h-9 shrink-0 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t('generating') : t('submit')}
          </button>
        </div>

        {/* 额度行:登录才显示(匿名会被 requireLogin 拦截,显示 0 没有意义)。 */}
        {quota && (
          <p className="px-2 pb-1 pt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {t('quotaRemaining', {
              remaining: String(quota.remaining),
              limit: String(quota.limit),
            })}
          </p>
        )}

        {referenceError && (
          <p role="alert" className="px-2 pb-1 pt-1 text-[11px] text-destructive">
            {referenceError}
          </p>
        )}
      </div>
    </div>
  );
}
