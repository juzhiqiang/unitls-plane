'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImageGeneratePresetDto } from '@/hooks/api/types';
import { presetImageUrl } from '@/lib/s3-assets';

/**
 * 单个灵感模板卡片。示例图独立成组件是为了让 onError 的 failed state 落在卡片内:
 * 一张图挂了只影响这张卡,不会连带别的模板退化成纯文本。
 * 空态快选与模板弹窗共用,调用方自己决定列表结构(<li> 包裹)。
 * (从旧工作台版 image-generate-options.tsx 原样迁出,样式不动。)
 */
export function PresetCard({
  preset,
  onPick,
  disabled = false,
}: {
  preset: ImageGeneratePresetDto;
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('ImageGenerate');
  const [failed, setFailed] = useState(false);
  const url = presetImageUrl(preset.imageStorageKey);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(preset.prompt)}
      className="flex w-full flex-col gap-1 rounded-md border border-border p-3 text-left transition-colors hover:border-foreground hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
    >
      {url && !failed ? (
        // 示例图让用户一眼看到这套模板的成品长什么样;图存 MinIO presets 匿名只读桶,
        // 拉不到就退化成纯文本卡片而不是留个碎图占位。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={t('presetExampleAlt', { title: preset.title })}
          loading="lazy"
          onError={() => setFailed(true)}
          className="aspect-[4/3] w-full rounded-sm border border-border object-cover"
        />
      ) : null}
      <span className="text-sm font-medium">{preset.title}</span>
      <span className="line-clamp-3 text-xs text-muted-foreground">
        {preset.prompt}
      </span>
    </button>
  );
}
