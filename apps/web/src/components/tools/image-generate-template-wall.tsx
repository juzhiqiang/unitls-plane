'use client';

import { useTranslations } from 'next-intl';
import type { ImageGeneratePresetDto } from '@/hooks/api/types';
import { PresetCard } from './image-generate-options';

interface ImageGenerateTemplateWallProps {
  presets: ImageGeneratePresetDto[];
  disabled?: boolean;
  onPick: (prompt: string) => void;
}

/**
 * 工作台空态的灵感模板卡片墙(复用 GET /tasks/image-generate/presets)。
 * presets 为空或接口失败时退化为一句引导文案:空弹窗/空墙都比不上明确说「去左边输入」。
 */
export function ImageGenerateTemplateWall({
  presets,
  disabled = false,
  onPick,
}: ImageGenerateTemplateWallProps) {
  const t = useTranslations('ImageGenerate');

  if (presets.length === 0) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t('templateWallEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {t('templateWallTitle')}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {presets.map(preset => (
          <li key={preset.id}>
            <PresetCard preset={preset} onPick={onPick} disabled={disabled} />
          </li>
        ))}
      </ul>
    </div>
  );
}
