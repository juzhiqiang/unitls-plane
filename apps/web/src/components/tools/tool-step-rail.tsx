'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type ToolStage = 'upload' | 'configure' | 'processing' | 'result';

interface ToolStepRailProps {
  current: ToolStage;
  className?: string;
}

const stages: ToolStage[] = ['upload', 'configure', 'processing', 'result'];

export function ToolStepRail({ current, className }: ToolStepRailProps) {
  const t = useTranslations('ToolShell.steps');
  const currentIndex = stages.indexOf(current);

  return (
    <ol
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-4 ${className ?? ''}`}
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
                {done ? <Check className="h-3 w-3" strokeWidth={1.5} /> : index + 1}
              </span>
              {t(stage)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
