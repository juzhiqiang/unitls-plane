import { Link } from '@/i18n/navigation';
import type { ToolMeta } from '@/lib/tools/tool-metadata';
import { useTranslations } from 'next-intl';

export function HomepageQuickTools({ tools }: { tools: ToolMeta[] }) {
  const t = useTranslations();
  const featuredTools = [tools[0], tools[2]].filter(
    (tool): tool is ToolMeta => Boolean(tool)
  );
  const supportingTools = [tools[1], tools[3]].filter(
    (tool): tool is ToolMeta => Boolean(tool)
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        {featuredTools.map((tool, index) => (
          <Link
            key={tool.key}
            href={tool.href}
            className="homepage-product-panel group relative min-h-[310px] overflow-hidden rounded-md border border-border bg-card p-6 text-foreground transition-transform duration-500 hover:-translate-y-1"
          >
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div className="flex items-center justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-background/80 text-foreground backdrop-blur transition-colors group-hover:border-accent/60">
                  <tool.icon className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Product {String(index + 1).padStart(2, '0')}
                </span>
              </div>
              <div>
                <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-accent">
                  Utils Plane
                </p>
                <h3 className="max-w-[12ch] text-3xl font-medium leading-none tracking-tight sm:text-4xl">
                  {t(tool.titleKey)}
                </h3>
                <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
                  {t(tool.descriptionKey)}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {supportingTools.map((tool, index) => (
          <Link
            key={tool.key}
            href={tool.href}
            className="group flex min-h-[128px] items-center justify-between gap-4 rounded-md border border-border bg-card/80 p-5 transition-colors hover:bg-muted/30"
          >
            <div>
              <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Flow {String(index + 3).padStart(2, '0')}
              </div>
              <h3 className="text-base font-medium">{t(tool.titleKey)}</h3>
              <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
                {t(tool.descriptionKey)}
              </p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors group-hover:border-accent/60">
              <tool.icon className="h-4 w-4" strokeWidth={1.5} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
