'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import {
  Merge,
  Scissors,
  Image as ImageIcon,
  FileText,
  Images,
  RotateCw,
  Stamp,
  Lock,
  Minimize2,
  Info,
  ArrowUpDown,
} from 'lucide-react';

const tools = [
  { key: 'merge', icon: Merge, href: '/pdf/merge' },
  { key: 'split', icon: Scissors, href: '/pdf/split' },
  { key: 'toImage', icon: ImageIcon, href: '/pdf/to-image' },
  { key: 'toText', icon: FileText, href: '/pdf/to-text' },
  { key: 'fromImage', icon: Images, href: '/pdf/from-image' },
  { key: 'rotate', icon: RotateCw, href: '/pdf/rotate' },
  { key: 'watermark', icon: Stamp, href: '/pdf/watermark' },
  { key: 'encrypt', icon: Lock, href: '/pdf/encrypt' },
  { key: 'compress', icon: Minimize2, href: '/pdf/compress' },
  { key: 'metadata', icon: Info, href: '/pdf/metadata' },
  { key: 'rearrange', icon: ArrowUpDown, href: '/pdf/rearrange' },
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
