'use client';

import { useTranslations } from 'next-intl';
import type { ImageGenerateProviderDto } from '@/hooks/api/types';
import type { ImageGenerateChatDraft } from './types';
import { sizeToRatioLabel, resolveDraftSize } from './types';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

interface SettingsPanelProps {
  value: ImageGenerateChatDraft;
  onChange: (next: ImageGenerateChatDraft) => void;
  disabled?: boolean;
  providers: ImageGenerateProviderDto[];
  /** 当前剩余额度,数量上限取 min(10, remaining);拿不到时按 10。 */
  quotaRemaining?: number;
}

/** chips 单选项,样式沿用旧 RadioRow 的胶囊模式(sr-only radio + has-checked 边框)。 */
function ChipRow<T extends string | number>({  legend,
  options,
  selected,
  disabled,
  onSelect,
}: {
  legend: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(option => (
          <label
            key={String(option.value)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
              selected === option.value
                ? 'border-foreground bg-foreground text-background'
                : 'border-border text-foreground hover:border-foreground'
            }`}
          >
            <input
              type="radio"
              className="sr-only"
              checked={selected === option.value}
              disabled={disabled}
              onChange={() => onSelect(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * 输入条上方的参数面板(自建浮层,仓库没有 popover 原语)。
 *
 * 行序对齐设计稿 4a9731b8:模型 → 画面比例 → 质量 → 背景 → 生成数量。
 * 设计稿里的「分辨率」行明确不做:它的「自动」语义已由 画面比例=自动(size:"auto")覆盖。
 * 风格(style)行也从 UI 下线(schema 保留,旧任务 retry 兼容)。
 */
export function SettingsPanel({
  value,
  onChange,
  disabled = false,
  providers,
  quotaRemaining,
}: SettingsPanelProps) {
  const t = useTranslations('ImageGenerate');
  /** 模型名后的能力后缀:支持图生图(含融合) / 仅文生图。 */
  const capabilityText = (capabilities: Array<'generate' | 'edit' | 'inpaint'>) =>
    capabilities.includes('edit')
      ? t('providerCapEdit')
      : t('providerCapTextOnly');

  // 画面比例档位由当前来源的 sizes 派生(自动 + 每个 WxH 约分后的比例标签);
  // 选中值始终存原始 size 串,提交时不需要二次换算。
  const selectedProvider =
    providers.find(item => item.id === value.providerId) ?? providers[0];
  const sizeOptions = (selectedProvider?.sizes ?? ['auto']).map(size => ({
    value: size,
    label: size === 'auto' ? t('ratioAuto') : sizeToRatioLabel(size),
  }));
  const countMax = Math.max(1, Math.min(10, quotaRemaining ?? 10));
  const count = Math.min(value.count, countMax);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 space-y-4 rounded-lg border border-border bg-card p-4 shadow-lg">
      {/* 模型 = 来源。单来源部署不渲染这一行(选一项的单选是噪音)。
          名称后缀标注能力:支持图生图 / 仅文生图,选型时不用猜。 */}
      {providers.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('modelLabel')}</p>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              className="flex h-8 w-full items-center justify-between rounded-md border border-border px-3 text-sm data-[state=open]:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="truncate">
                {selectedProvider?.label ?? value.providerId}
                <span className="ml-1 text-xs text-muted-foreground">
                  {capabilityText(selectedProvider?.capabilities ?? [])}
                </span>
              </span>
              <span aria-hidden className="text-muted-foreground">▾</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {providers.map(provider => (
                <DropdownMenuItem
                  key={provider.id}
                  onClick={() => onChange({ ...value, providerId: provider.id })}
                >
                  <span className="truncate">{provider.label}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">
                    {capabilityText(provider.capabilities)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-[11px] text-muted-foreground">{t('providerHint')}</p>
        </div>
      )}

      <ChipRow
        legend={t('ratioLabel')}
        options={sizeOptions}
        // 草稿里的尺寸(默认 auto)不在当前来源支持列表时,选中态回落到第一档。
        selected={resolveDraftSize(value.size, selectedProvider?.sizes)}
        disabled={disabled}
        onSelect={size => onChange({ ...value, size })}
      />

      <ChipRow
        legend={t('qualityLabel')}
        options={[
          { value: 'auto' as const, label: t('qualities.auto') },
          { value: 'standard' as const, label: t('qualities.standard') },
          { value: 'high' as const, label: t('qualities.high') },
        ]}
        selected={value.quality}
        disabled={disabled}
        onSelect={quality => onChange({ ...value, quality })}
      />

      <ChipRow
        legend={t('backgroundLabel')}
        options={[
          { value: 'default' as const, label: t('backgroundDefault') },
          { value: 'transparent' as const, label: t('backgroundTransparent') },
        ]}
        selected={value.background ?? 'default'}
        disabled={disabled}
        onSelect={background =>
          onChange({
            ...value,
            background:
              background === 'transparent' ? 'transparent' : undefined,
          })
        }
      />

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{t('countLabel')}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t('countDecrement')}
            disabled={disabled || count <= 1}
            onClick={() => onChange({ ...value, count: Math.max(1, count - 1) })}
            className="h-7 w-7 rounded-md border border-border text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            −
          </button>
          <span className="w-8 text-center font-mono text-sm tabular-nums">
            {count}
          </span>
          <button
            type="button"
            aria-label={t('countIncrement')}
            disabled={disabled || count >= countMax}
            onClick={() => onChange({ ...value, count: count + 1 })}
            className="h-7 w-7 rounded-md border border-border text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
