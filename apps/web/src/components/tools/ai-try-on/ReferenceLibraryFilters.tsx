'use client';

import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import type { AiTryOnReferenceRole } from '@/hooks/api/types';
import {
  isGarmentReferenceRole,
  type GarmentStyleKey,
  type GenderFilterKey,
} from './referenceLibrary';

interface ReferenceLibraryFiltersProps {
  role: AiTryOnReferenceRole;
  itemCount: number;
  disabled: boolean;
  genderFilter: GenderFilterKey;
  styleFilter: GarmentStyleKey;
  searchQuery: string;
  genderCounts: Record<GenderFilterKey, number>;
  garmentStyleCounts: Record<GarmentStyleKey, number>;
  onGenderChange: (gender: GenderFilterKey) => void;
  onStyleChange: (style: GarmentStyleKey) => void;
  onSearchChange: (query: string) => void;
}

export function ReferenceLibraryFilters({
  role,
  itemCount,
  disabled,
  genderFilter,
  styleFilter,
  searchQuery,
  genderCounts,
  garmentStyleCounts,
  onGenderChange,
  onStyleChange,
  onSearchChange,
}: ReferenceLibraryFiltersProps) {
  const r = useTranslations('ImageTryOn.referenceLibrary');
  const isGarmentRole = isGarmentReferenceRole(role);
  return (
    <div className="space-y-2.5 border-b border-border bg-muted/15 px-5 py-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* 性别筛选（姿势 / 服装 / 人像通用） */}
        <div
          role="group"
          aria-label={r('filterGender')}
          className="flex flex-wrap items-center gap-1.5"
        >
          {(['all', 'female', 'male'] as const).map(genderKey => {
            const count = genderCounts[genderKey];
            if (
              role !== 'pose' &&
              !isGarmentRole &&
              genderKey !== 'all' &&
              count === 0
            ) {
              return null;
            }
            const isActive = genderFilter === genderKey;
            return (
              <button
                key={genderKey}
                type="button"
                data-testid={
                  role === 'pose'
                    ? `pose-gender-filter-${genderKey}`
                    : `gender-filter-${genderKey}`
                }
                aria-pressed={isActive}
                disabled={disabled}
                onClick={() => {
                  onGenderChange(genderKey);
                }}
                className={`rounded-full px-3 py-1 font-mono text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-background text-muted-foreground hover:border-foreground/60 hover:text-foreground'
                } disabled:opacity-50`}
              >
                {r(`genders.${genderKey}`)} ({count})
              </button>
            );
          })}
        </div>

        {/* 搜索框 */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            disabled={disabled}
            onChange={event => {
              onSearchChange(event.target.value);
            }}
            placeholder={r('searchPlaceholder')}
            className="h-8 w-full rounded-md border border-border bg-background pr-2.5 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
        </div>
      </div>

      {/* 服装风格筛选（仅服装 / 辅助风格展示） */}
      {isGarmentRole && itemCount > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            ['all', 'spring', 'summer', 'autumn', 'winter', 'party'] as const
          ).map(styleKey => {
            const count = garmentStyleCounts[styleKey];
            if (styleKey !== 'all' && count === 0) return null;
            const isActive = styleFilter === styleKey;
            return (
              <button
                key={styleKey}
                type="button"
                data-testid={`style-filter-${styleKey}`}
                aria-pressed={isActive}
                disabled={disabled}
                onClick={() => {
                  onStyleChange(styleKey);
                }}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-background text-muted-foreground hover:border-foreground/60 hover:text-foreground'
                } disabled:opacity-50`}
              >
                {r(`garmentStyles.${styleKey}`)} ({count})
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
