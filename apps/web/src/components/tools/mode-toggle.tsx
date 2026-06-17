'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type ProcessMode = 'local' | 'server';

export interface ModeToggleProps {
  value: ProcessMode;
  onChange: (mode: ProcessMode) => void;
  recommendation?: ProcessMode;
  disabled?: boolean;
  serverLoginRequired?: boolean;
}

export function ModeToggle({
  value,
  onChange,
  recommendation,
  disabled,
  serverLoginRequired,
}: ModeToggleProps) {
  const t = useTranslations('ToolsShared');
  return (
    <div className="space-y-2">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
        {t('mode.label')}
      </div>
      <div className="inline-flex border border-border rounded-md p-0.5">
        {(['local', 'server'] as const).map((m) => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m)}
            className={cn(
              'px-4 h-8 text-xs font-mono uppercase tracking-wider transition-colors rounded-sm',
              value === m
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {m === 'local' ? t('mode.local') : t('mode.server')}
            {recommendation === m && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {t('mode.recommended')}
              </span>
            )}
          </button>
        ))}
      </div>
      {serverLoginRequired && value === 'server' && (
        <p className="max-w-xl rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {t('mode.serverRequiresLogin')}
        </p>
      )}
    </div>
  );
}
