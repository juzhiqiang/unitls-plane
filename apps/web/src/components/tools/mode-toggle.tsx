'use client';

import { cn } from '@/lib/utils';

export type ProcessMode = 'local' | 'server';

export interface ModeToggleProps {
  value: ProcessMode;
  onChange: (mode: ProcessMode) => void;
  recommendation?: ProcessMode;
  disabled?: boolean;
}

export function ModeToggle({
  value,
  onChange,
  recommendation,
  disabled,
}: ModeToggleProps) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
        处理位置
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
            {m === 'local' ? '本地' : '服务端'}
            {recommendation === m && (
              <span className="ml-1.5 text-[10px] opacity-70">推荐</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
