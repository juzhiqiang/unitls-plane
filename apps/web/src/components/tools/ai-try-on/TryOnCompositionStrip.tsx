'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useObjectUrl } from '@/hooks/use-object-url';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Layers,
  Sparkles,
  User,
  Shirt,
  Compass,
  Palette,
  X,
} from 'lucide-react';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

interface SlotData {
  role: 'person' | 'garment' | 'pose' | 'style';
  title: string;
  thumbnailUrl?: string;
  sourceType: 'upload' | 'library';
  required: boolean;
  isFilled: boolean;
  sectionId: string;
}

interface TryOnCompositionStripProps {
  // Person
  personFile: File | null;
  personAsset: AiTryOnReferenceAssetDto | null;
  onClearPerson: () => void;
  // Garment
  garmentFile: File | null;
  garmentAsset: AiTryOnReferenceAssetDto | null;
  onClearGarment: () => void;
  // Pose
  poseAsset: AiTryOnReferenceAssetDto | null;
  onClearPose: () => void;
  // Style
  styleAsset: AiTryOnReferenceAssetDto | null;
  onClearStyle: () => void;
  onResetAll?: () => void;
  disabled?: boolean;
}

export function TryOnCompositionStrip({
  personFile,
  personAsset,
  onClearPerson,
  garmentFile,
  garmentAsset,
  onClearGarment,
  poseAsset,
  onClearPose,
  styleAsset,
  onClearStyle,
  onResetAll,
  disabled = false,
}: TryOnCompositionStripProps) {
  const t = useTranslations('ImageTryOn');
  const locale = useLocale();
  const isZh = locale.startsWith('zh');

  const personObjectUrl = useObjectUrl(personFile);
  const garmentObjectUrl = useObjectUrl(garmentFile);

  const personFilled = Boolean(personFile || personAsset);
  const garmentFilled = Boolean(garmentFile || garmentAsset);
  const poseFilled = Boolean(poseAsset);
  const styleFilled = Boolean(styleAsset);

  const coreReady = personFilled && garmentFilled;
  const filledCount =
    Number(personFilled) +
    Number(garmentFilled) +
    Number(poseFilled) +
    Number(styleFilled);

  const slots: SlotData[] = [
    {
      role: 'person',
      title: personFile
        ? personFile.name
        : personAsset
          ? personAsset.title
          : isZh
            ? '模特人像'
            : 'Model Portrait',
      thumbnailUrl: personObjectUrl ?? personAsset?.thumbnailUrl,
      sourceType: personFile ? 'upload' : 'library',
      required: true,
      isFilled: personFilled,
      sectionId: 'try-on-section-person',
    },
    {
      role: 'garment',
      title: garmentFile
        ? garmentFile.name
        : garmentAsset
          ? garmentAsset.title
          : isZh
            ? '目标服装'
            : 'Target Garment',
      thumbnailUrl: garmentObjectUrl ?? garmentAsset?.thumbnailUrl,
      sourceType: garmentFile ? 'upload' : 'library',
      required: true,
      isFilled: garmentFilled,
      sectionId: 'try-on-section-garment',
    },
    {
      role: 'pose',
      title: poseAsset ? poseAsset.title : isZh ? '姿势参考' : 'Pose Reference',
      thumbnailUrl: poseAsset?.thumbnailUrl,
      sourceType: 'library',
      required: false,
      isFilled: poseFilled,
      sectionId: 'try-on-section-pose',
    },
    {
      role: 'style',
      title: styleAsset
        ? styleAsset.title
        : isZh
          ? '辅助风格'
          : 'Style Reference',
      thumbnailUrl: styleAsset?.thumbnailUrl,
      sourceType: 'library',
      required: false,
      isFilled: styleFilled,
      sectionId: 'try-on-section-style',
    },
  ];

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-foreground/40');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-foreground/40');
      }, 1500);
    }
  };

  const getSlotRoleLabel = (role: SlotData['role']) => {
    switch (role) {
      case 'person':
        return t('slotPerson');
      case 'garment':
        return t('slotGarment');
      case 'pose':
        return t('slotPose');
      case 'style':
        return t('slotStyle');
    }
  };

  const getSlotIcon = (role: SlotData['role']) => {
    switch (role) {
      case 'person':
        return <User className="h-4 w-4" />;
      case 'garment':
        return <Shirt className="h-4 w-4" />;
      case 'pose':
        return <Compass className="h-4 w-4" />;
      case 'style':
        return <Palette className="h-4 w-4" />;
    }
  };

  const handleClear = (role: SlotData['role']) => {
    switch (role) {
      case 'person':
        onClearPerson();
        break;
      case 'garment':
        onClearGarment();
        break;
      case 'pose':
        onClearPose();
        break;
      case 'style':
        onClearStyle();
        break;
    }
  };

  return (
    <div
      data-testid="try-on-composition-strip"
      className="space-y-3 rounded-xl border border-border bg-card p-4 transition-all"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {t('compositionBoardTitle')}
              </h3>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] ${
                  coreReady
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium'
                }`}
              >
                {coreReady ? (
                  <>
                    <CheckCircle2 className="h-3 w-3" />
                    {t('compositionCoreReady')}
                  </>
                ) : (
                  <>
                    <HelpCircle className="h-3 w-3" />
                    {t('compositionCoreMissing')}
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('compositionBoardSubtitle')} ({filledCount} / 4)
            </p>
          </div>
        </div>

        {filledCount > 0 && onResetAll && (
          <button
            type="button"
            disabled={disabled}
            onClick={onResetAll}
            className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {isZh ? '清空全部搭配' : 'Clear all'}
          </button>
        )}
      </div>

      {/* 4 插槽工作流横向卡片 */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {slots.map(slot => {
          return (
            <div
              key={slot.role}
              data-testid={`composition-slot-${slot.role}`}
              className={`relative flex items-center gap-3 rounded-lg border p-2.5 transition-all ${
                slot.isFilled
                  ? 'border-border bg-muted/20 shadow-xs'
                  : slot.required
                    ? 'border-dashed border-amber-500/50 bg-amber-500/5 hover:border-amber-500 hover:bg-amber-500/10'
                    : 'border-dashed border-border/80 bg-background/50 hover:border-border hover:bg-muted/10'
              }`}
            >
              {slot.isFilled ? (
                <>
                  {slot.thumbnailUrl ? (
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-border bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={slot.thumbnailUrl}
                        alt={slot.title}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                      {getSlotIcon(slot.role)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground uppercase">
                        {getSlotRoleLabel(slot.role)}
                      </span>
                      {slot.required && (
                        <span className="rounded bg-muted px-1 text-[9px] font-mono text-muted-foreground">
                          {t('slotRequired')}
                        </span>
                      )}
                    </div>
                    <p
                      className="truncate text-xs font-medium text-foreground"
                      title={slot.title}
                    >
                      {slot.title}
                    </p>
                  </div>

                  <button
                    type="button"
                    title={isZh ? '移除此项' : 'Remove'}
                    disabled={disabled}
                    onClick={() => handleClear(slot.role)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => scrollToSection(slot.sectionId)}
                  className="flex w-full items-center justify-between gap-2 text-left disabled:opacity-50"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border ${
                        slot.required
                          ? 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                          : 'border-border text-muted-foreground bg-muted/30'
                      }`}
                    >
                      {getSlotIcon(slot.role)}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground uppercase">
                          {getSlotRoleLabel(slot.role)}
                        </span>
                        <span
                          className={`rounded px-1 text-[9px] font-mono ${
                            slot.required
                              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {slot.required
                            ? t('slotRequired')
                            : t('slotOptional')}
                        </span>
                      </div>
                      <p className="truncate text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                        {slot.role === 'person' && t('emptySlotPerson')}
                        {slot.role === 'garment' && t('emptySlotGarment')}
                        {slot.role === 'pose' && t('emptySlotPose')}
                        {slot.role === 'style' && t('emptySlotStyle')}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
