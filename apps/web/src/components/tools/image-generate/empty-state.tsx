'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImageGeneratePresetDto } from '@/hooks/api/types';
import { PresetCard } from './preset-card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface EmptyStateProps {
  presets: ImageGeneratePresetDto[];
  disabled?: boolean;
  onPick: (prompt: string) => void;
}

/**
 * 空画布态:居中引导 + 模板快选(前 6 张)+ 「更多模板」弹窗。
 *
 * presets 为空或接口失败时退化为纯引导文案 —— 空弹窗比没有入口更让人困惑。
 * 弹窗逻辑从旧 PromptField 迁来,空态与输入条的模板入口共用。
 */
export function EmptyState({ presets, disabled = false, onPick }: EmptyStateProps) {
  const t = useTranslations('ImageGenerate');
  const [presetOpen, setPresetOpen] = useState(false);

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 py-10 text-center">
      <div className="space-y-2">
        <h2 className="text-lg font-medium tracking-tight">{t('emptyTitle')}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">{t('emptyHint')}</p>
      </div>

      {presets.length > 0 ? (
        <div className="w-full max-w-2xl space-y-3">
          <ul className="grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">
            {presets.slice(0, 6).map(preset => (
              <li key={preset.id}>
                <PresetCard
                  preset={preset}
                  onPick={onPick}
                  disabled={disabled}
                />
              </li>
            ))}
          </ul>
          {presets.length > 6 && (
            <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
              <DialogTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('presetTrigger')}
                </button>
              </DialogTrigger>
              <DialogContent closeLabel={t('presetClose')}>
                <DialogTitle className="text-sm font-medium">
                  {t('presetTitle')}
                </DialogTitle>
                <DialogDescription>{t('presetDescription')}</DialogDescription>
                <ul className="grid gap-2 overflow-y-auto sm:grid-cols-2">
                  {presets.map(preset => (
                    <li key={preset.id}>
                      <PresetCard
                        preset={preset}
                        onPick={prompt => {
                          onPick(prompt);
                          setPresetOpen(false);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </DialogContent>
            </Dialog>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('emptyHint')}</p>
      )}
    </div>
  );
}
