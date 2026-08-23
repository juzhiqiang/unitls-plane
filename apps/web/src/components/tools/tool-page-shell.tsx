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
  /** 透传给步骤条:工具没有上传环节时可以传更短的步骤集。 */
  stages?: readonly ToolStage[];
  children: ReactNode;
  aside?: ReactNode;
  maxWidth?: 'default' | 'wide';
}

export function ToolPageShell({
  title,
  description,
  processing,
  retention,
  requiresLogin,
  recovery,
  stage,
  stages,
  children,
  aside,
  maxWidth = 'default',
}: ToolPageShellProps) {
  return (
    <div
      className={
        maxWidth === 'wide'
          ? 'mx-auto max-w-7xl space-y-6'
          : 'mx-auto max-w-6xl space-y-6'
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        </div>
        <ToolStepRail current={stage} stages={stages} />
      </div>
      <ToolTrustStrip
        processing={processing}
        retention={retention}
        requiresLogin={requiresLogin}
        recovery={recovery}
      />
      <div
        className={
          aside
            ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'
            : 'grid grid-cols-1 gap-6'
        }
      >
        <div className="min-w-0 space-y-6">{children}</div>
        {aside && <aside className="min-w-0 space-y-4">{aside}</aside>}
      </div>
    </div>
  );
}
