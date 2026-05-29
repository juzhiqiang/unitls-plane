'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface PasswordStrengthLabels {
  label: string;
  weak: string;
  fair: string;
  good: string;
  strong: string;
}

interface PasswordStrengthProps {
  value: string;
  labels: PasswordStrengthLabels;
}

/** Returns level 0 (empty) .. 4 (strong). */
function scorePassword(pw: string): number {
  if (!pw) return 0;
  let raw = 0;
  if (pw.length >= 8) raw++;
  if (pw.length >= 12) raw++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) raw++;
  if (/\d/.test(pw)) raw++;
  if (/[^A-Za-z0-9]/.test(pw)) raw++;
  // map raw 0..5 -> level 1..4 (never 0 once non-empty)
  if (raw <= 1) return 1;
  if (raw === 2) return 2;
  if (raw === 3) return 3;
  return 4;
}

export function PasswordStrength({ value, labels }: PasswordStrengthProps) {
  const level = useMemo(() => scorePassword(value), [value]);

  if (!value) {
    return <div className="h-[18px]" aria-hidden />;
  }

  const text = [labels.weak, labels.weak, labels.fair, labels.good, labels.strong][level];
  const barColor = level <= 1 ? 'bg-destructive' : level === 2 ? 'bg-foreground/40' : 'bg-accent';
  const textColor = level <= 1 ? 'text-destructive' : 'text-muted-foreground';

  return (
    <div
      className="flex items-center gap-2"
      role="status"
      aria-label={`${labels.label}: ${text}`}
    >
      <div className="flex gap-1 flex-1">
        {[1, 2, 3, 4].map((seg) => (
          <span
            key={seg}
            className={cn(
              'h-[3px] flex-1 rounded-full transition-colors',
              seg <= level ? barColor : 'bg-border',
            )}
          />
        ))}
      </div>
      <span
        className={cn(
          'text-[10px] font-mono uppercase tracking-wider tabular-nums w-10 text-right',
          textColor,
        )}
      >
        {text}
      </span>
    </div>
  );
}
