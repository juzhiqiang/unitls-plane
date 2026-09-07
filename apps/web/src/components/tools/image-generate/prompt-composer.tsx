'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, Settings2, X } from 'lucide-react';
import { IMAGE_GENERATE_MAX_REFERENCE_IMAGES } from '@utils-plane/validators';
import type { ImageGenerateChatDraft } from './types';
import { SettingsPanel } from './settings-panel';
import { ImageLightbox } from './image-lightbox';
import type { ImageGenerateProviderDto } from '@/hooks/api/types';
import { useObjectUrls } from '@/hooks/use-object-urls';

interface PromptComposerProps {
  draft: ImageGenerateChatDraft;
  onDraftChange: (next: ImageGenerateChatDraft) => void;
  /** 已附参考图;0 张 = 文生图,1 张 = 图生图,多张 = 图片融合。 */
  referenceFiles: File[];
  onReferenceChange: (files: File[]) => void;
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
 * 参考图三路进入(点附件按钮选文件、textarea 粘贴、整个卡片拖放),可多选,
 * 多张即图片融合(上限 IMAGE_GENERATE_MAX_REFERENCE_IMAGES)。
 * Enter 提交 / Shift+Enter 换行;中文输入法组词中的回车不上屏(isComposing)。
 */
export function PromptComposer({
  draft,
  onDraftChange,
  referenceFiles,
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const referenceUrls = useObjectUrls(referenceFiles);

  // 自动增高:每次内容变化后重置高度再按 scrollHeight 撑开,上限 10rem。
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft.prompt]);

  const acceptReferences = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming || !editSupported) return;

    const accepted: File[] = [];
    let tooLarge = false;
    let overLimit = false;
    for (const file of Array.from(incoming)) {
      if (!file.type.startsWith('image/')) continue;
      if (maxReferenceSize !== undefined && file.size > maxReferenceSize) {
        tooLarge = true;
        continue;
      }
      if (
        referenceFiles.length + accepted.length >=
        IMAGE_GENERATE_MAX_REFERENCE_IMAGES
      ) {
        overLimit = true;
        break;
      }
      accepted.push(file);
    }

    setReferenceError(
      tooLarge
        ? t('referenceTooLarge')
        : overLimit
          ? t('referenceLimitExceeded', {
              max: String(IMAGE_GENERATE_MAX_REFERENCE_IMAGES),
            })
          : null
    );
    if (accepted.length > 0) {
      onReferenceChange([...referenceFiles, ...accepted]);
    }
  };

  const removeReference = (index: number) => {
    onReferenceChange(referenceFiles.filter((_, i) => i !== index));
    setReferenceError(null);
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
        acceptReferences(event.dataTransfer.files);
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
        {/* 参考图 chips:缩略图(可放大)+ 移除;多张即融合。 */}
        {referenceFiles.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-1 pb-2 pt-1">
            {referenceFiles.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="relative inline-block"
              >
                <button
                  type="button"
                  aria-label={t('enlargeReference')}
                  onClick={() =>
                    setLightboxUrl(referenceUrls[index] ?? null)
                  }
                  className="block overflow-hidden rounded-md border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {referenceUrls[index] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={referenceUrls[index]}
                      alt={file.name}
                      className="h-10 w-10 object-cover"
                    />
                  ) : (
                    <span className="block h-10 w-10 bg-muted" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t('removeReference')}
                  onClick={() => removeReference(index)}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
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
            multiple
            className="hidden"
            onChange={event => {
              acceptReferences(event.target.files);
              // 同一组文件二次选择也要触发 onChange:不清空 value 就不会。
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
              acceptReferences(event.clipboardData.files);
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

      <ImageLightbox
        url={lightboxUrl}
        alt={t('sourcePreviewAlt')}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}
