'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface ProcessingProgressProps {
  progress: number; // 0-100
  label?: string;
  className?: string;
}

export function ProcessingProgress({
  progress,
  label,
  className,
}: ProcessingProgressProps) {
  const t = useTranslations('ToolsShared');
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground uppercase tracking-wider">
          {label ?? t('processing')}
        </span>
        <span className="text-foreground tabular-nums">{pct}%</span>
      </div>
      <div className="h-0.5 w-full bg-border overflow-hidden">
        <div
          className="h-full bg-accent transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
