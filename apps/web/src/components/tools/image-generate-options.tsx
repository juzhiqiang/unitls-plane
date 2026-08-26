'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImageGenerateProviderDto } from '@/hooks/api/types';
import {
  IMAGE_GENERATE_PROMPT_MAX_LENGTH,
  type ImageGenerateMode,
  type ImageGenerateQuality,
  type ImageGenerateSize,
  type ImageGenerateStyle,
} from '@utils-plane/validators';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

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

/**
 * 预设提示词条目:id 同时作为 messages 里 ImageGenerate.presets.<id>.title / .prompt 的键。
 * 这里只存结构,文案在中英文 messages 里维护,和其它字段保持同一套本地化方式。
 *
 * 模板走「分类」思路:每条都是一个相对完整的创作框架(导览式科普绘本、拟人化 IP 海报、
 * 信息图长图、角色设定三视图、节日主题海报),用户选了之后替换【主题】等占位即可,
 * 而不是一条只有两三句话的简单示例。保留空间方便后续增删分类。
 */
interface ImageGeneratePreset {
  id: string;
  /** 可选示例图:放在 apps/web/public 下,按相对根路径引用。没有示例图的分类留空。 */
  image?: string;
}

const PRESETS: ImageGeneratePreset[] = [
  {
    id: 'sciencePictureBook',
    image: '/presets/science-picture-book.jpg',
  },
  {
    id: 'marketStallProposal',
    image: '/presets/market-stall-proposal.jpg',
  },
  {
    id: 'twitterArticleCover',
    image: '/presets/twitter-article-cover.jpg',
  },
  {
    id: 'xiaohongshuCover',
    image: '/presets/xiaohongshu-cover.jpg',
  },
  {
    id: 'wechatArticleCover',
    image: '/presets/wechat-article-cover.jpg',
  },
  {
    id: 'ecommerceProduct',
    image: '/presets/ecommerce-product.jpg',
  },
  {
    id: 'ecommerceDetailPage',
    image: '/presets/ecommerce-detail-page.jpg',
  },
  { id: 'ipMascot' },
  { id: 'infographic' },
  { id: 'characterSheet' },
  { id: 'festivalPoster' },
];

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
  const [presetOpen, setPresetOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        {/* label 必须是 block:textarea 默认 inline-block,限宽后两者会挤在同一个
            line box 里按基线对齐,标签会跑到输入框底部。 */}
        <label
          htmlFor="image-generate-prompt"
          className="block text-sm font-medium"
        >
          {t('promptLabel')}
        </label>
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
              {PRESETS.map(preset => {
                const text = t(`presets.${preset.id}.prompt`);
                const title = t(`presets.${preset.id}.title`);
                return (
                  <li key={preset.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ ...value, prompt: text });
                        setPresetOpen(false);
                      }}
                      className="flex w-full flex-col gap-1 rounded-md border border-border p-3 text-left transition-colors hover:border-foreground hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {preset.image ? (
                        // 示例图让用户一眼看到这套模板的成品长什么样;只有配了图的分类才渲染,
                        // 其余分类保持纯文本卡片。alt 带上模板标题,无图分类不进 alt 计算。
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preset.image}
                          alt={t('presetExampleAlt', { title })}
                          className="aspect-[4/3] w-full rounded-sm border border-border object-cover"
                        />
                      ) : null}
                      <span className="text-sm font-medium">{title}</span>
                      <span className="line-clamp-3 text-xs text-muted-foreground">
                        {text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </DialogContent>
        </Dialog>
      </div>
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
