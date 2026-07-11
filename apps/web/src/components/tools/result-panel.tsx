import type { ReactNode } from 'react';

interface ResultPanelProps {
  title: string;
  description: string;
  meta?: { label: string; value: string }[];
  preview?: ReactNode;
  action: ReactNode;
}

export function ResultPanel({
  title,
  description,
  meta = [],
  preview,
  action,
}: ResultPanelProps) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      {preview && <div className="mb-4">{preview}</div>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          {meta.length > 0 && (
            <dl className="mt-3 grid gap-2 sm:grid-cols-3">
              {meta.map(item => (
                <div key={item.label}>
                  <dt className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {item.label}
                  </dt>
                  <dd className="font-mono text-xs text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="shrink-0">{action}</div>
      </div>
    </section>
  );
}
