'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ImageDown, RefreshCw } from 'lucide-react';

const tools = [
  {
    titleKey: 'tools.compress.title',
    descriptionKey: 'tools.compress.description',
    href: '/image/compress',
    icon: ImageDown,
  },
  {
    titleKey: 'tools.convert.title',
    descriptionKey: 'tools.convert.description',
    href: '/image/convert',
    icon: RefreshCw,
  },
] as const;

export default function ImagePage() {
  const t = useTranslations('ImageTool');

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-lg font-medium">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {tools.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group border border-border rounded-md p-6 space-y-3 transition-colors hover:bg-muted/40"
          >
            <tool.icon
              className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors"
              strokeWidth={1.5}
            />
            <div className="text-sm font-medium">{t(tool.titleKey)}</div>
            <div className="text-xs text-muted-foreground">
              {t(tool.descriptionKey)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
