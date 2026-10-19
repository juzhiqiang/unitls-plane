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

interface PresetPickerDialogProps {
  presets: ImageGeneratePresetDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onPick: (prompt: string) => void;
  /**
   * 可选触发器。空态「更多模板」用 asChild 包一个文本按钮;
   * 设置面板的模板入口行自带按钮,不传 trigger、由外部控制 open。
   */
  trigger?: React.ReactNode;
}

/**
 * 模板选择弹窗(共享组件)。
 *
 * 从 empty-state.tsx 抽出:空态快选与设置面板的「提示词模板」入口打开的是同一个
 * 弹窗,选中即填入输入框并关闭,模板列表只有一份实现。
 * 调用方负责 presets 为空时不渲染入口(空弹窗比没有入口更让人困惑)。
 */
export function PresetPickerDialog({
  presets,
  open,
  onOpenChange,
  disabled = false,
  onPick,
  trigger,
}: PresetPickerDialogProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
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
                disabled={disabled}
                onPick={prompt => {
                  onPick(prompt);
                  onOpenChange(false);
                }}
              />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
