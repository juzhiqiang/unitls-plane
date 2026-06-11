import type { ReactNode } from 'react';
import type { ToolProcessing, ToolRetention } from '@/lib/tools/tool-metadata';
import type { ToolStage } from './tool-step-rail';
import { ToolStepRail } from './tool-step-rail';
import { ToolTrustStrip } from './tool-trust-strip';

interface ToolPageShellProps {
  title: string;
  description: string;
  processing: ToolProcessing;
  retention: ToolRetention;
  requiresLogin: boolean;
  recovery: string;
  stage: ToolStage;
  children: ReactNode;
  aside?: ReactNode;
}

export function ToolPageShell({
  title,
  description,
  processing,
  retention,
  requiresLogin,
  recovery,
  stage,
  children,
  aside,
}: ToolPageShellProps) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <ToolStepRail current={stage} />
      </div>
      <ToolTrustStrip
        processing={processing}
        retention={retention}
        requiresLogin={requiresLogin}
        recovery={recovery}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">{children}</div>
        {aside && <aside className="min-w-0 space-y-4">{aside}</aside>}
      </div>
    </div>
  );
}
