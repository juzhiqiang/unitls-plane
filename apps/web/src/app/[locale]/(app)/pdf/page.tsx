'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Merge, Scissors } from 'lucide-react';

const tools = [
  { key: 'merge', icon: Merge, href: '/pdf/merge' },
  { key: 'split', icon: Scissors, href: '/pdf/split' },
] as const;

export default function PdfPage() {
  const t = useTranslations('PdfTool');
  const router = useRouter();

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border border border-border rounded-md overflow-hidden">
        {tools.map(({ key, icon: Icon, href }) => (
          <button
            key={key}
            type="button"
            onClick={() => router.push(href)}
            className="flex items-start gap-4 p-6 bg-background text-left transition-colors hover:bg-muted/40"
          >
            <Icon className="h-5 w-5 text-muted-foreground mt-0.5" strokeWidth={1.5} />
            <div>
              <p className="text-sm font-medium text-foreground">
                {t(`tools.${key}.title`)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(`tools.${key}.description`)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
