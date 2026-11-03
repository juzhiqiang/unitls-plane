'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type {
  AiTryOnReferenceAssetDto,
  AiTryOnReferenceRole,
} from '@/hooks/api/types';

interface GarmentLibraryGridProps {
  role: AiTryOnReferenceRole;
  items: AiTryOnReferenceAssetDto[];
  selectedId: string | null;
  onSelect: (assetId: string | null) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onFallbackToUpload?: () => void;
  disabled?: boolean;
  optional?: boolean;
}

type StyleCategory = 'all' | 'spring' | 'summer' | 'autumn' | 'winter' | 'party';
type GenderFilter = 'all' | 'female' | 'male';

// 画面风格映射
const STYLE_CATEGORIES: Record<StyleCategory, { zh: string; en: string }> = {
  all: { zh: '全部', en: 'All' },
  spring: { zh: '春日穿搭', en: 'Spring' },
  summer: { zh: '夏日穿搭', en: 'Summer' },
  autumn: { zh: '秋日穿搭', en: 'Autumn' },
  winter: { zh: '冬日穿搭', en: 'Winter' },
  party: { zh: '派对礼服', en: 'Party' },
};

function extractStyleFromTitle(title: string): StyleCategory {
  if (title.includes('春')) return 'spring';
  if (title.includes('夏')) return 'summer';
  if (title.includes('秋')) return 'autumn';
  if (title.includes('冬')) return 'winter';
  if (title.includes('派对')) return 'party';
  return 'all';
}

/**
 * 检测性别线索。优先看 tags 中的明确标记 (女式/男式),
 * 其次看描述中的性别词汇。无法确定时默认 female。
 */
function detectGender(item: AiTryOnReferenceAssetDto): GenderFilter {
  // tags 中的明确标记
  const hasMaleTag = item.tags.some(tag => tag.includes('男') || tag.includes('男式'));
  const hasFemaleTag = item.tags.some(tag => tag.includes('女') || tag.includes('女式'));
  
  if (hasMaleTag) return 'male';
  if (hasFemaleTag) return 'female';
  
  // 描述中的线索
  if (item.description) {
    if (item.description.includes('男')) return 'male';
    if (item.description.includes('女')) return 'female';
  }
  
  // 默认为 female (因为多数样本为女性)
  return 'female';
}

export function GarmentLibraryGrid({
  role,
  items,
  selectedId,
  onSelect,
  isLoading = false,
  isError = false,
  onRetry,
  onFallbackToUpload,
  disabled = false,
  optional = false,
}: GarmentLibraryGridProps) {
  const t = useTranslations('ImageTryOn');
  const [activeStyle, setActiveStyle] = useState<StyleCategory>('all');
  const [activeGender, setActiveGender] = useState<GenderFilter>('all');

  // 统计每个分类的数量
  const styleCounts = useMemo(() => {
    const counts: Record<StyleCategory, number> = {
      all: items.length,
      spring: 0,
      summer: 0,
      autumn: 0,
      winter: 0,
      party: 0,
    };
    
    for (const item of items) {
      const style = extractStyleFromTitle(item.title);
      if (style !== 'all') {
        counts[style]++;
      }
    }
    
    return counts;
  }, [items]);

  // 统计性别
  const genderCounts = useMemo(() => {
    const counts: Record<GenderFilter, number> = { all: items.length, female: 0, male: 0 };
    
    for (const item of items) {
      const gender = detectGender(item);
      counts[gender]++;
    }
    
    return counts;
  }, [items]);

  // 按风格和性别筛选
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const itemStyle = extractStyleFromTitle(item.title);
      const itemGender = detectGender(item);
      
      const matchesStyle = activeStyle === 'all' || itemStyle === activeStyle;
      const matchesGender = activeGender === 'all' || itemGender === activeGender;
      
      return matchesStyle && matchesGender;
    });
  }, [items, activeStyle, activeGender]);

  const selectedAsset = items.find(item => item.id === selectedId);

  if (isLoading) {
    return (
      <div
        role=\"status\"
        data-testid={\library-loading-\\}
        className=\"rounded-md border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground\"
      >
        {t('libraryLoading')}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role=\"alert\"
        data-testid={\library-error-\\}
        className=\"space-y-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm\"
      >
        <p className=\"text-foreground\">{t('libraryError')}</p>
        {onFallbackToUpload && (
          <p className=\"text-muted-foreground\">{t('fallbackToUploadHint')}</p>
        )}
        <div className=\"flex flex-wrap gap-2\">
          {onRetry && (
            <button
              type=\"button\"
              disabled={disabled}
              onClick={onRetry}
              className=\"rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground disabled:opacity-50\"
            >
              {t('libraryRetry')}
            </button>
          )}
          {onFallbackToUpload && (
            <button
              type=\"button\"
              disabled={disabled}
              onClick={onFallbackToUpload}
              className=\"rounded-md bg-foreground px-3 py-1.5 text-sm text-background transition-opacity hover:opacity-90 disabled:opacity-50\"
            >
              {t('fallbackToUploadAction')}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        data-testid={\library-empty-\\}
        className=\"space-y-3 rounded-md border border-dashed border-border bg-muted/10 p-6 text-sm\"
      >
        <p className=\"text-muted-foreground\">{t('libraryEmpty')}</p>
        {onFallbackToUpload && (
          <>
            <p className=\"text-muted-foreground\">{t('fallbackToUploadHint')}</p>
            <button
              type=\"button\"
              disabled={disabled}
              onClick={onFallbackToUpload}
              className=\"rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground disabled:opacity-50\"
            >
              {t('fallbackToUploadAction')}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className=\"space-y-4\">
      {/* 风格筛选 */}
      <div className=\"space-y-2\">
        <label className=\"text-xs font-mono text-muted-foreground uppercase tracking-wider\">
          画面风格
        </label>
        <div className=\"flex flex-wrap gap-2\">
          {(Object.entries(STYLE_CATEGORIES) as Array<[StyleCategory, any]>).map(
            ([key, label]) => {
              const count = styleCounts[key];
              const isActive = activeStyle === key;
              return (
                <button
                  key={key}
                  type=\"button\"
                  disabled={disabled || count === 0}
                  onClick={() => setActiveStyle(key)}
                  className={\ounded-md border px-3 py-1.5 text-sm transition-colors \\}
                >
                  {label.zh}
                  <span className=\"ml-1.5 opacity-70\">({count})</span>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* 性别筛选 */}
      <div className=\"space-y-2\">
        <label className=\"text-xs font-mono text-muted-foreground uppercase tracking-wider\">
          人物性别
        </label>
        <div className=\"flex flex-wrap gap-2\">
          {(['all', 'female', 'male'] as const).map(gender => {
            const labels: Record<typeof gender, string> = {
              all: '全部',
              female: '女性',
              male: '男性',
            };
            const count = genderCounts[gender];
            const isActive = activeGender === gender;
            return (
              <button
                key={gender}
                type=\"button\"
                disabled={disabled || count === 0}
                onClick={() => setActiveGender(gender)}
                className={\ounded-md border px-3 py-1.5 text-sm transition-colors \\}
              >
                {labels[gender]}
                <span className=\"ml-1.5 opacity-70\">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 已选择的素材提示 */}
      {selectedAsset && (
        <div className=\"flex items-center justify-between gap-3 rounded-md bg-muted/30 px-4 py-2.5 text-sm\">
          <span className=\"font-medium text-foreground\">
            {t('selectedAsset', { title: selectedAsset.title })}
          </span>
          {optional && (
            <button
              type=\"button\"
              disabled={disabled}
              onClick={() => onSelect(null)}
              className=\"text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50\"
            >
              {t('clearSelection')}
            </button>
          )}
        </div>
      )}

      {/* 筛选结果为空 */}
      {filteredItems.length === 0 && (
        <div className=\"rounded-md border border-dashed border-border bg-muted/10 px-4 py-8 text-center text-sm text-muted-foreground\">
          该筛选条件下暂无服饰
        </div>
      )}

      {/* 图库网格 */}
      {filteredItems.length > 0 && (
        <div className=\"grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4\">
          {filteredItems.map(item => {
            const isSelected = selectedId === item.id;
            return (
              <div
                key={item.id}
                data-testid={\library-card-\-\\}
                className={\group flex flex-col overflow-hidden rounded-lg border transition-all \\}
              >
                <button
                  type=\"button\"
                  aria-pressed={isSelected}
                  data-testid={\library-item-\-\\}
                  disabled={disabled}
                  onClick={() =>
                    onSelect(optional && isSelected ? null : item.id)
                  }
                  className=\"flex flex-col text-left transition-opacity disabled:cursor-not-allowed disabled:opacity-60\"
                >
                  {item.thumbnailUrl ? (
                    <div className=\"relative aspect-[4/3] w-full overflow-hidden bg-muted/20\">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        loading=\"lazy\"
                        className=\"h-full w-full object-cover transition-transform group-hover:scale-105\"
                      />
                    </div>
                  ) : null}

                  <div className=\"flex-1 space-y-2 p-3\">
                    <p className=\"font-medium leading-snug text-foreground\">
                      {item.title}
                    </p>
                    {item.description ? (
                      <p className=\"text-sm leading-relaxed text-muted-foreground line-clamp-2\">
                        {item.description}
                      </p>
                    ) : null}

                    {item.tags.length > 0 && (
                      <div className=\"flex flex-wrap gap-1.5 pt-1\">
                        {item.tags.slice(0, 3).map(tag => (
                          <span
                            key={tag}
                            className=\"rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground\"
                          >
                            {tag}
                          </span>
                        ))}
                        {item.tags.length > 3 && (
                          <span className=\"rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground\">
                            +{item.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                <div className=\"border-t border-border/40 bg-muted/10 px-3 py-2 text-xs text-muted-foreground\">
                  <div className=\"space-y-0.5\">
                    {item.licenseName && (
                      <p>{t('licenseLabel', { license: item.licenseName })}</p>
                    )}
                    {item.attribution && (
                      <p>
                        {t('attributionLabel', { attribution: item.attribution })}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
