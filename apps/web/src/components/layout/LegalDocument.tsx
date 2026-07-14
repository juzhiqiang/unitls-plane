export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
};

type LegalDocumentProps = {
  title: string;
  effectiveDate: string;
  intro: string;
  sections: LegalSection[];
  operatorLabel: string;
  operator: string;
  supportLabel: string;
  supportEmail: string;
};

export function LegalDocument({
  title,
  effectiveDate,
  intro,
  sections,
  operatorLabel,
  operator,
  supportLabel,
  supportEmail,
}: LegalDocumentProps) {
  const titleId = `public-document-${sections[0]?.id ?? 'title'}`;

  return (
    <article
      className="container-main py-10 sm:py-14"
      aria-labelledby={titleId}
    >
      <div className="mx-auto max-w-3xl">
        <header className="border-b border-border pb-7">
          <p className="font-mono text-xs text-accent">{effectiveDate}</p>
          <h1
            id={titleId}
            className="mt-3 text-3xl font-medium leading-tight text-foreground sm:text-4xl"
          >
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            {intro}
          </p>
        </header>

        <div className="mt-8">
          {sections.map(section => (
            <section
              key={section.id}
              id={section.id}
              className="border-b border-border py-7 first:pt-0 last:border-b-0"
            >
              <h2 className="text-lg font-medium leading-7 text-foreground">
                {section.title}
              </h2>
              {section.paragraphs?.map(paragraph => (
                <p
                  key={paragraph}
                  className="mt-3 break-words text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7"
                >
                  {paragraph}
                </p>
              ))}
              {section.items && section.items.length > 0 ? (
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground marker:text-accent sm:text-base sm:leading-7">
                  {section.items.map(item => (
                    <li key={item} className="break-words pl-1">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <footer className="mt-4 border-t border-border pt-6 text-sm leading-6 text-muted-foreground">
          <p>
            <span className="text-foreground">{operatorLabel}</span> {operator}
          </p>
          <p className="mt-2 break-words">
            <span className="text-foreground">{supportLabel}</span>{' '}
            <a
              href={`mailto:${supportEmail}`}
              className="text-accent underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
            >
              {supportEmail}
            </a>
          </p>
        </footer>
      </div>
    </article>
  );
}
