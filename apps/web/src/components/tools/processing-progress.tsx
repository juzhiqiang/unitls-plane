'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type ProcessingStage =
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'generating';

export interface ProcessingProgressProps {
  progress: number;
  label?: string;
  stage?: ProcessingStage;
  className?: string;
}

export function ProcessingProgress({
  progress,
  label,
  stage,
  className,
}: ProcessingProgressProps) {
  const t = useTranslations('ToolsShared');
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const stageLabel = stage ? t(`stages.${stage}`) : undefined;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-muted-foreground uppercase tracking-wider">
          {label ?? stageLabel ?? t('processing')}
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
