'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type ToolStage = 'upload' | 'configure' | 'processing' | 'result';

interface ToolStepRailProps {
  current: ToolStage;
  /**
   * 要展示的步骤集,默认四步。
   *
   * 不是每个工具都有「上传」:文生图从零生成,给它挂一个永远不会发生的上传步骤,
   * 只会让步骤条在第一格显示已完成的假状态。
   */
  stages?: readonly ToolStage[];
  className?: string;
}

const DEFAULT_STAGES: readonly ToolStage[] = [
  'upload',
  'configure',
  'processing',
  'result',
];

/** Tailwind 需要静态类名,不能拼 `md:grid-cols-${n}`。 */
const COLUMN_CLASS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};

export function ToolStepRail({
  current,
  stages = DEFAULT_STAGES,
  className,
}: ToolStepRailProps) {
  const t = useTranslations('ToolShell.steps');
  const currentIndex = stages.indexOf(current);

  return (
    <ol
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border ${
        COLUMN_CLASS[stages.length] ?? 'md:grid-cols-4'
      } ${className ?? ''}`}
    >
      {stages.map((stage, index) => {
        const done = index < currentIndex;
        const active = stage === current;

        return (
          <li key={stage} className="bg-card px-3 py-3">
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider ${
                active ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center border text-[9px] ${
                  active || done ? 'border-accent text-accent' : 'border-border'
                }`}
              >
                {done ? (
                  <Check className="h-3 w-3" strokeWidth={1.5} />
                ) : (
                  index + 1
                )}
              </span>
              {t(stage)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
