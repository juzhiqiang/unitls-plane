'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

interface PresetDefinition {
  id: string;
  titleKey: string;
  descZh: string;
  descEn: string;
  personGender: 'female' | 'male';
  promptZh: string;
  promptEn: string;
}

const PRESET_CONFIGS: PresetDefinition[] = [
  {
    id: 'french-chic',
    titleKey: 'preset1Title',
    descZh: '法式女模 + 经典风衣 + 3/4 优雅站姿',
    descEn: 'French model + classic trench + 3/4 pose',
    personGender: 'female',
    promptZh: '极简纯白影棚，柔和摄影棚漫射光，高端电商画册质感',
    promptEn:
      'Minimalist white studio, soft diffused studio light, high-end e-commerce lookbook',
  },
  {
    id: 'business-suit',
    titleKey: 'preset2Title',
    descZh: '商务男模 + 绅士西装 + 正面自信站姿',
    descEn: 'Business male model + suit + confident front pose',
    personGender: 'male',
    promptZh: '现代建筑自然光，浅灰纯净背景，质感高级商务风',
    promptEn:
      'Modern architectural natural light, neutral grey background, sleek business style',
  },
  {
    id: 'summer-resort',
    titleKey: 'preset3Title',
    descZh: '清爽女模 + 度假风服饰 + 轻松随性姿势',
    descEn: 'Summer female model + resort outfit + relaxed stance',
    personGender: 'female',
    promptZh: '阳光明媚海滨度假风，柔和侧光，清新通透自然氛围',
    promptEn:
      'Bright coastal resort vibe, warm side light, fresh and airy atmosphere',
  },
];

interface TryOnPresetsBarProps {
  personLibrary: AiTryOnReferenceAssetDto[];
  garmentLibrary: AiTryOnReferenceAssetDto[];
  poseLibrary: AiTryOnReferenceAssetDto[];
  disabled?: boolean;
  onApplyPreset: (preset: {
    personAssetId: string;
    garmentAssetId: string;
    poseAssetId: string;
    promptAddition: string;
  }) => void;
}

export function TryOnPresetsBar({
  personLibrary,
  garmentLibrary,
  poseLibrary,
  disabled = false,
  onApplyPreset,
}: TryOnPresetsBarProps) {
  const t = useTranslations('ImageTryOn');
  const locale = useLocale();
  const isZh = locale.startsWith('zh');

  if (
    personLibrary.length === 0 ||
    garmentLibrary.length === 0 ||
    poseLibrary.length === 0
  ) {
    return null;
  }

  const handleSelectPreset = (config: PresetDefinition) => {
    // 寻找匹配性别的模特
    const matchedPerson =
      personLibrary.find(item => {
        const text = [item.title, item.description ?? '', ...item.tags]
          .join(' ')
          .toLowerCase();
        return config.personGender === 'male'
          ? item.tags.includes('male') ||
              text.includes('male') ||
              text.includes('男性')
          : item.tags.includes('female') ||
              text.includes('female') ||
              text.includes('女性');
      }) ?? personLibrary[0]!;

    // 挑选服饰
    const garmentIndex =
      config.id === 'french-chic'
        ? 0
        : config.id === 'business-suit'
          ? Math.min(1, garmentLibrary.length - 1)
          : Math.min(2, garmentLibrary.length - 1);
    const matchedGarment = garmentLibrary[garmentIndex] ?? garmentLibrary[0]!;

    // 挑选姿势
    const poseIndex =
      config.id === 'french-chic'
        ? 0
        : config.id === 'business-suit'
          ? Math.min(1, poseLibrary.length - 1)
          : Math.min(2, poseLibrary.length - 1);
    const matchedPose = poseLibrary[poseIndex] ?? poseLibrary[0]!;

    onApplyPreset({
      personAssetId: matchedPerson.id,
      garmentAssetId: matchedGarment.id,
      poseAssetId: matchedPose.id,
      promptAddition: isZh ? config.promptZh : config.promptEn,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-muted/20 px-3.5 py-2.5 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span>{t('presetsLabel')}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESET_CONFIGS.map(preset => {
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => handleSelectPreset(preset)}
              title={isZh ? preset.descZh : preset.descEn}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 font-mono text-[11px] text-foreground transition-all hover:border-foreground hover:bg-muted/40 hover:shadow-2xs disabled:opacity-50"
            >
              <span className="font-medium">{t(preset.titleKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
