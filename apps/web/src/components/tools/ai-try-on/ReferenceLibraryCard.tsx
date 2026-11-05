'use client';

import { useTranslations } from 'next-intl';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';

import { detectAssetGender, isGarmentReferenceRole } from './referenceLibrary';

interface ReferenceLibraryCardProps {
  item: AiTryOnReferenceAssetDto;
  role: AiTryOnReferenceRole;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (assetId: string) => void;
}

export function ReferenceLibraryCard({
  item,
  role,
  selectedId,
  disabled,
  onSelect,
}: ReferenceLibraryCardProps) {
  const t = useTranslations('ImageTryOn');
  const r = useTranslations('ImageTryOn.referenceLibrary');
  const isSelected = selectedId === item.id;
  const itemGender = detectAssetGender(item);
  const isGarmentRole = isGarmentReferenceRole(role);
  const displayTags = item.tags.filter(
    tag => !['female', 'male', '女性', '男性', 'photo', 'anime'].includes(tag)
  );
  return (
    <div
      data-testid={`library-card-${role}-${item.id}`}
      className={`group flex flex-col overflow-hidden rounded-lg border transition-all ${
        isSelected
          ? 'border-foreground bg-muted/50 shadow-sm'
          : 'border-border bg-card hover:border-foreground/60 hover:shadow-sm'
      }`}
    >
      <button
        type="button"
        aria-pressed={isSelected}
        data-testid={`library-item-${role}-${item.id}`}
        disabled={disabled}
        onClick={() => onSelect(item.id)}
        className="flex flex-col text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
      >
        {item.thumbnailUrl ? (
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnailUrl}
              alt={item.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            {isGarmentRole && itemGender !== 'unisex' && (
              <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-xs backdrop-blur-xs">
                {r(`garmentGenders.${itemGender}`)}
              </span>
            )}
            {role === 'person' && itemGender !== 'unisex' && (
              <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-xs backdrop-blur-xs">
                {r(`genders.${itemGender}`)}
              </span>
            )}
          </div>
        ) : null}

        <div className="flex-1 space-y-2 p-3">
          <p className="font-medium leading-snug text-foreground">
            {item.title}
          </p>
          {item.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          ) : null}

          {displayTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {displayTags.slice(0, 4).map(tag => (
                <span
                  key={tag}
                  className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {displayTags.length > 4 && (
                <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  +{displayTags.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </button>

      <div className="border-t border-border/40 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
        <div className="space-y-0.5">
          {item.licenseName && (
            <p>
              {t('licenseLabel', {
                license: item.licenseName,
              })}
            </p>
          )}
          {item.attribution && (
            <p>
              {t('attributionLabel', {
                attribution: item.attribution,
              })}
            </p>
          )}
          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-mono underline-offset-2 transition-colors hover:text-foreground hover:underline"
              onClick={e => e.stopPropagation()}
            >
              {t('sourceLink')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
