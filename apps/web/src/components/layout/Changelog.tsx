export interface ChangelogGroup {
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  summary: string;
  groups: ChangelogGroup[];
}

interface ChangelogProps {
  eyebrow: string;
  title: string;
  intro: string;
  entries: ChangelogEntry[];
}

export function Changelog({ eyebrow, title, intro, entries }: ChangelogProps) {
  return (
    <div className="container-main max-w-4xl py-14 sm:py-20">
      <header className="max-w-2xl">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-accent">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
          {title}
        </h1>
        <p className="mt-4 text-base leading-7 text-muted-foreground">
          {intro}
        </p>
      </header>

      <div className="mt-12">
        {entries.map(entry => {
          const headingId = `changelog-${entry.version.replace(/[^a-z0-9]+/gi, '-')}`;

          return (
            <article
              key={entry.version}
              aria-labelledby={headingId}
              className="grid gap-6 border-t border-border py-10 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-10"
            >
              <div className="space-y-2">
                <p className="font-mono text-sm text-accent">{entry.version}</p>
                <time
                  dateTime={entry.date}
                  className="block text-sm text-muted-foreground"
                >
                  {entry.date}
                </time>
              </div>

              <div>
                <h2
                  id={headingId}
                  className="text-xl font-medium tracking-tight"
                >
                  {entry.title}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {entry.summary}
                </p>

                <div className="mt-8 grid gap-7 sm:grid-cols-3">
                  {entry.groups.map(group => (
                    <section key={group.title}>
                      <h3 className="font-mono text-[11px] uppercase tracking-wider text-foreground">
                        {group.title}
                      </h3>
                      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                        {group.items.map(item => (
                          <li key={item} className="relative pl-4">
                            <span
                              aria-hidden="true"
                              className="absolute left-0 top-[0.65rem] h-1.5 w-1.5 rounded-full bg-accent"
                            />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
