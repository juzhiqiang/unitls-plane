'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import type {
  ImageGenerateModelDto,
  ImageGeneratePresetDto,
} from '@/hooks/api/types';
import type { ImageGenerateChatDraft } from './types';
import {
  sizeToRatioLabel,
  resolveDraftSize,
  resolveCustomRatio,
} from './types';
import { PresetPickerDialog } from './preset-picker-dialog';
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
  models: ImageGenerateModelDto[];
  /** 当前剩余额度,数量上限取 min(10, remaining);拿不到时按 10。 */
  quotaRemaining?: number;
  /** 提示词模板;为空时不渲染面板里的模板入口(与空态退化逻辑一致)。 */
  presets?: ImageGeneratePresetDto[];
  /** 选中模板:填入提示词输入框(不关闭设置面板)。 */
  onPickPreset?: (prompt: string) => void;
}

/** chips 单选项,样式沿用旧 RadioRow 的胶囊模式(sr-only radio + has-checked 边框)。 */
function ChipRow<T extends string | number>({
  legend,
  options,
  selected,
  disabled,
  onSelect,
  extra,
}: {
  legend: string;
  options: Array<{ value: T; label: string }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void;
  /** 行末附加的 chip(如画面比例的「自定义」),与普通选项共用同一套胶囊样式。 */
  extra?: React.ReactNode;
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
        {extra}
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
  models,
  quotaRemaining,
  presets = [],
  onPickPreset,
}: SettingsPanelProps) {
  const t = useTranslations('ImageGenerate');
  // 自定义比例:输入文本与报错都是面板本地状态,只有「应用」成功才动草稿。
  // 面板关掉重开时清空,但草稿里的 size 仍是上次应用的值(自定义状态由 size 串本身表达)。
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customError, setCustomError] = useState(false);
  /** 最近一次成功应用的尺寸:输入区下方的「实际提交」预览用它,而不是草稿值(后者可能是档位串)。 */
  const [customAppliedSize, setCustomAppliedSize] = useState<string | null>(
    null
  );
  const [presetOpen, setPresetOpen] = useState(false);
  /** 模型名后的能力后缀:支持图生图(含融合) / 仅文生图。 */
  const capabilityText = (
    capabilities: Array<'generate' | 'edit' | 'inpaint'>
  ) =>
    capabilities.includes('edit') ? t('modelCapEdit') : t('modelCapTextOnly');

  // 画面比例档位由当前模型的 sizes 派生(自动 + 每个 WxH 约分后的比例标签);
  // 选中值始终存原始 size 串,提交时不需要二次换算。
  const selectedModel =
    models.find(item => item.model === value.model) ?? models[0];
  const sizeOptions = (selectedModel?.sizes ?? ['auto']).map(size => ({
    value: size,
    label: size === 'auto' ? t('ratioAuto') : sizeToRatioLabel(size),
  }));
  const resolvedSize = resolveDraftSize(value.size, selectedModel?.sizes);
  // 自定义选中 = 草稿尺寸不在档位列表里(合成值或用户直传的 WxH)。
  // 模型支持自定义尺寸时这种值会原样提交,不支持时由 resolveDraftSize 兜底映射回档位。
  const customActive = !sizeOptions.some(option => option.value === value.size);
  const customSupported = selectedModel?.customSizes === true;
  const countMax = Math.max(1, Math.min(10, quotaRemaining ?? 10));
  const count = Math.min(value.count, countMax);

  const applyCustomRatio = () => {
    const size = resolveCustomRatio(customText, selectedModel?.sizes);
    if (!size) {
      setCustomError(true);
      return;
    }
    setCustomError(false);
    // 应用成功不收起输入区:用户可以对照「实际提交」继续微调。
    setCustomOpen(true);
    setCustomAppliedSize(size);
    onChange({ ...value, size });
  };

  const clearCustomRatio = () => {
    setCustomOpen(false);
    setCustomText('');
    setCustomError(false);
    setCustomAppliedSize(null);
    onChange({ ...value, size: 'auto' });
  };

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 space-y-4 rounded-lg border border-border bg-card p-4 shadow-lg">
      {/* 单模型部署不渲染这一行(选一项的单选是噪音)。
          名称后缀标注能力:支持图生图 / 仅文生图,选型时不用猜。 */}
      {models.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t('modelLabel')}</p>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              className="flex h-8 w-full items-center justify-between rounded-md border border-border px-3 text-sm data-[state=open]:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="truncate">
                {selectedModel?.model ?? value.model}
                <span className="ml-1 text-xs text-muted-foreground">
                  {capabilityText(selectedModel?.capabilities ?? [])}
                </span>
              </span>
              <span aria-hidden className="text-muted-foreground">
                ▾
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {models.map(model => (
                <DropdownMenuItem
                  key={model.model}
                  onClick={() => onChange({ ...value, model: model.model })}
                >
                  <span className="truncate">{model.model}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">
                    {capabilityText(model.capabilities)}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-[11px] text-muted-foreground">{t('modelHint')}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <ChipRow
          legend={t('ratioLabel')}
          options={sizeOptions}
          // 草稿里的尺寸(默认 auto)不在当前模型支持列表时,选中态回落到第一档;
          // 但模型声明了 customSizes 时,自定义值要原样提交,选中态停在该值上。
          selected={customSupported && customActive ? value.size : resolvedSize}
          disabled={disabled}
          onSelect={size => {
            setCustomOpen(false);
            setCustomError(false);
            setCustomAppliedSize(null);
            onChange({ ...value, size });
          }}
          extra={
            <button
              type="button"
              aria-pressed={customActive}
              disabled={disabled || !customSupported}
              title={
                customSupported
                  ? t('ratioCustomTitle')
                  : t('ratioCustomUnsupported')
              }
              onClick={() => {
                // chip 只负责展开/收起输入区;清除自定义值走输入区的 ✕,
                // 免得「已经用着自定义值」时点 chip 变成误清空。
                setCustomOpen(open => !open);
                setCustomError(false);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                customActive
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-dashed border-border text-foreground enabled:hover:border-foreground'
              }`}
            >
              {t('ratioCustom')}
            </button>
          }
        />

        {/* 自定义输入区:点「自定义」后常驻在比例行下方,应用成功也不自动收起 ——
            用户可以对照「实际提交」继续微调。 */}
        {(customOpen || (customActive && customSupported)) && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={customText}
                inputMode="text"
                placeholder={t('ratioCustomPlaceholder')}
                aria-label={t('ratioCustomTitle')}
                aria-invalid={customError}
                disabled={disabled}
                onChange={event => {
                  setCustomText(event.target.value);
                  setCustomError(false);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    applyCustomRatio();
                  }
                }}
                className={`h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
                  customError ? 'border-destructive' : 'border-border'
                }`}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={applyCustomRatio}
                className="h-8 shrink-0 rounded-md border border-border px-3 text-xs hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('ratioCustomApply')}
              </button>
              <button
                type="button"
                aria-label={t('ratioCustomClear')}
                disabled={disabled}
                onClick={clearCustomRatio}
                className="h-8 shrink-0 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                ✕
              </button>
            </div>
            {customError ? (
              <p role="alert" className="text-[11px] text-destructive">
                {t('ratioCustomInvalid')}
              </p>
            ) : customAppliedSize ? (
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {t('ratioCustomApplied', {
                  size: customSupported
                    ? customAppliedSize
                    : resolveDraftSize(customAppliedSize, selectedModel?.sizes),
                })}
                {customSupported ? null : ` · ${t('ratioCustomUnsupported')}`}
              </p>
            ) : null}
          </div>
        )}
      </div>

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
            onClick={() =>
              onChange({ ...value, count: Math.max(1, count - 1) })
            }
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

      {/* 模板入口:presets 为空(未配置/接口失败)时整行不渲染 —— 空弹窗比没有入口
          更让人困惑,与空态的退化逻辑一致。选中后只填输入框,设置面板不关:
          用户可能还要接着调比例/质量。 */}
      {presets.length > 0 && onPickPreset ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {t('settingsPresetsLabel')}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPresetOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-border px-3 text-xs hover:border-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            {t('settingsPresetsTrigger')}
          </button>
          <PresetPickerDialog
            presets={presets}
            open={presetOpen}
            onOpenChange={setPresetOpen}
            disabled={disabled}
            onPick={onPickPreset}
          />
        </div>
      ) : null}
    </div>
  );
}
