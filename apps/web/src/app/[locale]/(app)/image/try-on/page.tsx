'use client';

import { useTranslations } from 'next-intl';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { TryOnModePanel } from '@/components/tools/ai-try-on/TryOnModePanel';
import { TryOnReferencesPanel } from '@/components/tools/ai-try-on/TryOnReferencesPanel';
import { TryOnParametersPanel } from '@/components/tools/ai-try-on/TryOnParametersPanel';
import { TryOnTaskFeedback } from '@/components/tools/ai-try-on/TryOnTaskFeedback';
import { TryOnResult } from '@/components/tools/ai-try-on/TryOnResult';
import { useTryOnWorkbench } from '@/components/tools/ai-try-on/useTryOnWorkbench';
import { getToolByHref } from '@/lib/tools/tool-metadata';

export default function ImageTryOnPage() {
  const t = useTranslations('ImageTryOn');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/image/try-on')!;
  const workbench = useTryOnWorkbench();

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={workbench.stage}
    >
      <TryOnModePanel {...workbench} />
      <TryOnReferencesPanel {...workbench} />
      <TryOnParametersPanel {...workbench} />
      <TryOnTaskFeedback {...workbench} />
      <TryOnResult
        task={workbench.task}
        comparisonBeforeUrl={workbench.comparisonBeforeUrl}
        hasGarmentPreview={Boolean(
          workbench.form.garmentFile || workbench.selectedGarmentAsset
        )}
      />
    </ToolPageShell>
  );
}
