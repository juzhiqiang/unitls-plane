import type { ReactNode } from 'react';

interface PageSectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageSectionHeader({
  eyebrow,
  title,
  description,
  action,
}: PageSectionHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-xl font-medium tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
