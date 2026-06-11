'use client';

import { useTranslations } from 'next-intl';
import { PageSectionHeader } from '@/components/layout/page-section-header';
import { ToolCatalogGrid } from '@/components/tools/tool-catalog-grid';
import { ToolTrustStrip } from '@/components/tools/tool-trust-strip';
import { groupedPdfTools } from '@/lib/tools/tool-metadata';

export default function PdfPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageSectionHeader title={t('title')} description={t('description')} />
      <ToolTrustStrip
        processing="server"
        retention="account-files"
        requiresLogin
        recovery={tShell('catalogRecovery')}
      />
      <ToolCatalogGrid groups={groupedPdfTools} />
    </div>
  );
}
