'use client';

import {
  Clock3,
  LockKeyhole,
  RotateCcw,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ToolProcessing, ToolRetention } from '@/lib/tools/tool-metadata';

interface ToolTrustStripProps {
  processing: ToolProcessing;
  retention: ToolRetention;
  requiresLogin: boolean;
  recovery: string;
  className?: string;
}

export function ToolTrustStrip({
  processing,
  retention,
  requiresLogin,
  recovery,
  className,
}: ToolTrustStripProps) {
  const t = useTranslations('ToolShell.trust');
  const items = [
    {
      icon: processing === 'server' ? Server : ShieldCheck,
      term: t('labels.processing'),
      label: t(`processing.${processing}`),
    },
    {
      icon: Clock3,
      term: t('labels.retention'),
      label: t(`retention.${retention}`),
    },
    {
      icon: LockKeyhole,
      term: t('labels.login'),
      label: requiresLogin ? t('login.required') : t('login.notRequired'),
    },
    {
      icon: RotateCcw,
      term: t('labels.recovery'),
      label: recovery,
    },
  ];

  return (
    <dl
      className={`grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-4 ${className ?? ''}`}
    >
      {items.map(item => (
        <div key={item.label} className="bg-card px-3 py-3">
          <dt className="sr-only">{item.term}</dt>
          <dd className="flex items-start gap-2 text-xs text-muted-foreground">
            <item.icon
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground"
              strokeWidth={1.5}
            />
            <span>{item.label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
