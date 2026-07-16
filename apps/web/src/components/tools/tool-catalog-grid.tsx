import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { ToolGroup } from '@/lib/tools/tool-metadata';

function ToolGridFillers({ toolCount }: { toolCount: number }) {
  const twoColumnCount = toolCount % 2;
  const threeColumnCount = (3 - (toolCount % 3)) % 3;

  return (
    <>
      {Array.from({ length: twoColumnCount }, (_, index) => (
        <div
          key={`two-column-${index}`}
          aria-hidden="true"
          data-tool-grid-filler="two-column"
          className="hidden min-h-[132px] bg-card sm:block xl:hidden"
        />
      ))}
      {Array.from({ length: threeColumnCount }, (_, index) => (
        <div
          key={`three-column-${index}`}
          aria-hidden="true"
          data-tool-grid-filler="three-column"
          className="hidden min-h-[132px] bg-card xl:block"
        />
      ))}
    </>
  );
}

export function ToolCatalogGrid({ groups }: { groups: ToolGroup[] }) {
  const t = useTranslations();

  return (
    <div className="space-y-8">
      {groups.map(group => (
        <section key={group.key} className="space-y-3">
          <div className="grid gap-1 sm:grid-cols-[220px_1fr]">
            <h2 className="text-sm font-medium">{t(group.titleKey)}</h2>
            <p className="text-xs text-muted-foreground">
              {t(group.descriptionKey)}
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
            {group.tools.map(tool => (
              <Link
                key={tool.key}
                href={tool.href}
                className="group min-h-[132px] bg-card p-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <tool.icon
                    className="h-5 w-5 text-muted-foreground group-hover:text-foreground"
                    strokeWidth={1.5}
                  />
                  {tool.recommended && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                      {t('ToolCatalog.recommended')}
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <h3 className="text-sm font-medium">{t(tool.titleKey)}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(tool.descriptionKey)}
                  </p>
                </div>
              </Link>
            ))}
            <ToolGridFillers toolCount={group.tools.length} />
          </div>
        </section>
      ))}
    </div>
  );
}
