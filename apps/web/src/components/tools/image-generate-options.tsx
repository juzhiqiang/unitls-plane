'use client';

import { useTranslations } from 'next-intl';
import type { ImageGenerateProviderDto } from '@/hooks/api/types';
import {
  IMAGE_GENERATE_PROMPT_MAX_LENGTH,
  type ImageGenerateMode,
  type ImageGenerateQuality,
  type ImageGenerateSize,
  type ImageGenerateStyle,
} from '@utils-plane/validators';

export interface ImageGenerateDraft {
  mode: ImageGenerateMode;
  prompt: string;
  size: ImageGenerateSize;
  quality: ImageGenerateQuality;
  style?: ImageGenerateStyle;
  count: number;
  /** 省略时由服务端用配置里的第一个来源;单来源部署下前端不展示这个选项。 */
  providerId?: string;
}

/** inpaint 还没实现,不在页面上暴露。 */
const MODES: Array<
  Extract<ImageGenerateMode, 'text_to_image' | 'image_to_image'>
> = ['text_to_image', 'image_to_image'];
const SIZES: ImageGenerateSize[] = ['1024x1024', '1024x1536', '1536x1024'];
const QUALITIES: ImageGenerateQuality[] = ['standard', 'high'];
const STYLES: ImageGenerateStyle[] = [
  'photographic',
  'illustration',
  'anime',
  'three_d',
  'watercolor',
  'line_art',
];
const COUNTS = [1, 2, 4];

const PROMPT_COUNTER_ID = 'image-generate-prompt-counter';

// IMAGE_GENERATE_PROMPT_MAX_LENGTH 由 @utils-plane/validators 导出,这里直接复用,
// 避免跨包重复魔数。

/**
 * 三个字段组件而不是一个大表单:参考图上传区必须插在「模式」与「提示词」之间
 * (步骤条第一步是上传,把上传框排在全部参数之后与它自相矛盾)。
 * 拆成三块让页面自己决定顺序,比给一个大组件塞 slot props 更直白。
 */
interface ImageGenerateFieldProps {
  value: ImageGenerateDraft;
  onChange: (next: ImageGenerateDraft) => void;
  disabled?: boolean;
}

interface RadioRowProps<T extends string | number> {
  name: string;
  legend: string;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void;
}

function RadioRow<T extends string | number>({
  name,
  legend,
  options,
  selected,
  disabled,
  onSelect,
}: RadioRowProps<T>) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(option => (
          <label
            key={String(option.value)}
            className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-[:checked]:border-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              value={String(option.value)}
              checked={selected === option.value}
              disabled={disabled || option.disabled}
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
 * 模式选择。editSupported=false 时禁掉图生图而不是隐藏它:选项消失会让用户以为
 * 这个工具不支持图生图,禁用加一行说明才能指向「换个来源」。
 */
export function ImageGenerateModeField({
  value,
  onChange,
  disabled = false,
  editSupported = true,
}: ImageGenerateFieldProps & { editSupported?: boolean }) {
  const t = useTranslations('ImageGenerate');

  return (
    <div className="space-y-2">
      <RadioRow
        name="image-generate-mode"
        legend={t('modeLabel')}
        selected={value.mode}
        disabled={disabled}
        options={MODES.map(mode => ({
          value: mode,
          label: t(`modes.${mode}`),
          disabled: mode === 'image_to_image' && !editSupported,
        }))}
        onSelect={mode => onChange({ ...value, mode })}
      />
      {!editSupported && (
        <p className="text-xs text-muted-foreground">
          {t('providerNoEditHint')}
        </p>
      )}
    </div>
  );
}

/**
 * 来源选择。只有一个来源时整块不渲染:单选一项的单选组是纯噪音。
 */
export function ImageGenerateProviderField({
  value,
  onChange,
  disabled = false,
  providers,
}: ImageGenerateFieldProps & { providers: ImageGenerateProviderDto[] }) {
  const t = useTranslations('ImageGenerate');
  const [first] = providers;
  if (!first || providers.length < 2) return null;

  const selected = value.providerId ?? first.id;

  return (
    <div className="space-y-2">
      <RadioRow
        name="image-generate-provider"
        legend={t('providerLabel')}
        selected={selected}
        disabled={disabled}
        options={providers.map(provider => ({
          value: provider.id,
          label: provider.label,
        }))}
        onSelect={providerId => {
          const next = providers.find(item => item.id === providerId);
          // 换到不支持图生图的来源时把模式退回文生图,否则会带着必失败的组合提交。
          const keepsMode =
            value.mode !== 'image_to_image' ||
            (next?.capabilities.includes('edit') ?? true);
          onChange({
            ...value,
            providerId,
            mode: keepsMode ? value.mode : 'text_to_image',
          });
        }}
      />
      <p className="text-xs text-muted-foreground">{t('providerHint')}</p>
    </div>
  );
}

export function ImageGeneratePromptField({
  value,
  onChange,
  disabled = false,
}: ImageGenerateFieldProps) {
  const t = useTranslations('ImageGenerate');

  return (
    <div className="space-y-2">
      {/* label 必须是 block:textarea 默认 inline-block,限宽后两者会挤在同一个
          line box 里按基线对齐,标签会跑到输入框底部。 */}
      <label
        htmlFor="image-generate-prompt"
        className="block text-sm font-medium"
      >
        {t('promptLabel')}
      </label>
      {/* 限宽到 max-w-2xl:整宽时长提示词会变成一行 100+ 字,读写都难受。 */}
      <textarea
        id="image-generate-prompt"
        aria-describedby={PROMPT_COUNTER_ID}
        className="min-h-40 w-full max-w-2xl rounded-md border bg-background p-3 text-sm leading-relaxed disabled:cursor-not-allowed disabled:opacity-60"
        maxLength={IMAGE_GENERATE_PROMPT_MAX_LENGTH}
        placeholder={t('promptPlaceholder')}
        value={value.prompt}
        disabled={disabled}
        onChange={event => onChange({ ...value, prompt: event.target.value })}
      />
      {/* 实时计数而不是静态上限:maxLength 到顶是静默截断,没有计数用户不知道被截了。
          传字符串而不是数字:数字参数会被 Intl.NumberFormat 加千位分隔符。 */}
      <p
        id={PROMPT_COUNTER_ID}
        className="max-w-2xl text-right font-mono text-xs tabular-nums text-muted-foreground"
      >
        {t('promptCounter', {
          count: String(value.prompt.length),
          max: String(IMAGE_GENERATE_PROMPT_MAX_LENGTH),
        })}
      </p>
    </div>
  );
}

export function ImageGenerateParamsFields({
  value,
  onChange,
  disabled = false,
}: ImageGenerateFieldProps) {
  const t = useTranslations('ImageGenerate');

  return (
    // 用原生 details 而不是自己管开合状态:默认展开,尺寸和数量会影响真实计费,
    // 不该藏起来,但它们也不该和唯一必填的提示词抢视觉权重。
    <details open className="rounded-md border border-border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {t('paramsSummary')}
      </summary>
      <div className="mt-4 space-y-5">
        <RadioRow
          name="image-generate-size"
          legend={t('sizeLabel')}
          selected={value.size}
          disabled={disabled}
          options={SIZES.map(size => ({
            value: size,
            label: t(`sizes.${size}`),
          }))}
          onSelect={size => onChange({ ...value, size })}
        />

        <RadioRow
          name="image-generate-quality"
          legend={t('qualityLabel')}
          selected={value.quality}
          disabled={disabled}
          options={QUALITIES.map(quality => ({
            value: quality,
            label: t(`qualities.${quality}`),
          }))}
          onSelect={quality => onChange({ ...value, quality })}
        />

        <RadioRow
          name="image-generate-style"
          legend={t('styleLabel')}
          selected={value.style ?? 'none'}
          disabled={disabled}
          options={[
            { value: 'none' as const, label: t('styles.none') },
            ...STYLES.map(style => ({
              value: style,
              label: t(`styles.${style}`),
            })),
          ]}
          onSelect={style =>
            onChange({
              ...value,
              style:
                style === 'none' ? undefined : (style as ImageGenerateStyle),
            })
          }
        />

        <RadioRow
          name="image-generate-count"
          legend={t('countLabel')}
          selected={value.count}
          disabled={disabled}
          options={COUNTS.map(count => ({
            value: count,
            label: String(count),
          }))}
          onSelect={count => onChange({ ...value, count })}
        />
      </div>
    </details>
  );
}
