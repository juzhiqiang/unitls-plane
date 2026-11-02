'use client';

import { useState, useMemo } from 'use';
import { useTranslations } from 'next-intl';
import type { AiTryOnReferenceAssetDto } from '@/hooks/api/types';

interface PoseLibraryWithFiltersProps {
  items: AiTryOnReferenceAssetDto[];
  selectedId: string | null;
  onSelect: (assetId: string | null) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  disabled?: boolean;
}

const VIEW_LABELS: Record<string, string> = {
  all: '全部视角',
  front: '正面',
  side: '侧面',
  back: '背面',
  high: '高角度',
  low: '低角度',
  diag: '斜侧',
};

export function PoseLibraryWithFilters({
  items,
  selectedId,
  onSelect,
  isLoading = false,
  isError = false,
  onRetry,
  disabled = false,
}: PoseLibraryWithFiltersProps) {
  const t = useTranslations('ImageTryOn');
  const [selectedView, setSelectedView] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // 提取可用的视角
  const availableViews = useMemo(() => {
    const views = new Set<string>();
    items.forEach(item => {
      const viewMatch = item.tags.find(tag => 
        ['front', 'side', 'back', 'high', 'low', 'diag'].includes(tag)
      );
      if (viewMatch) views.add(viewMatch);
    });
    return Array.from(views).sort();
  }, [items]);
  
  // 筛选姿势
  const filteredItems = useMemo(() => {
    let filtered = items;
    
    // 视角筛选
    if (selectedView !== 'all') {
      filtered = filtered.filter(item => 
        item.tags.includes(selectedView)
      );
    }
    
    // 搜索筛选
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(item =>
        item.title.toLowerCase().includes(query) ||
        item.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [items, selectedView, searchQuery]);
  
  if (isLoading) {
    return (
      <div className="rounded-md border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        加载姿势图库中...
      </div>
    );
  }
  
  if (isError) {
    return (
      <div className="space-y-3 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm">
        <p className="text-foreground">姿势图库加载失败</p>
        {onRetry && (
          <button
            type="button"
            disabled={disabled}
            onClick={onRetry}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:border-foreground disabled:opacity-50"
          >
            重试
          </button>
        )}
      </div>
    );
  }
  
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-sm text-muted-foreground">
        暂无可用姿势
      </div>
    );
  }
  
  const selectedAsset = items.find(item => item.id === selectedId);
  
  return (
    <div className="space-y-4">
      {/* 已选姿势提示 */}
      {selectedAsset && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-4 py-2.5 text-sm">
          <span className="font-medium text-foreground">
            已选择: {selectedAsset.title}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(null)}
            className="text-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
          >
            清除选择
          </button>
        </div>
      )}
      
      {/* 筛选器 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* 视角选择器 */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setSelectedView('all')}
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              selectedView === 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            全部 ({items.length})
          </button>
          {availableViews.map(view => {
            const count = items.filter(item => item.tags.includes(view)).length;
            return (
              <button
                key={view}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedView(view)}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  selectedView === view
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {VIEW_LABELS[view] || view} ({count})
              </button>
            );
          })}
        </div>
        
        {/* 搜索框 */}
        <input
          type="text"
          placeholder="搜索姿势..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50 sm:w-64"
        />
      </div>
      
      {/* 姿势网格 */}
      {filteredItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-center text-sm text-muted-foreground">
          未找到匹配的姿势
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {filteredItems.map(item => {
            const isSelected = selectedId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(isSelected ? null : item.id)}
                className={`group relative aspect-[3/4] overflow-hidden rounded-lg border transition-all ${
                  isSelected
                    ? 'border-foreground shadow-lg ring-2 ring-foreground/20'
                    : 'border-border hover:border-foreground/60 hover:shadow-md'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                    {item.title}
                  </div>
                )}
                {isSelected && (
                  <div className="absolute inset-0 bg-foreground/10 ring-2 ring-inset ring-foreground" />
                )}
              </button>
            );
          })}
        </div>
      )}
      
      {/* 结果统计 */}
      <div className="text-center text-xs text-muted-foreground">
        显示 {filteredItems.length} / {items.length} 个姿势
      </div>
    </div>
  );
}
