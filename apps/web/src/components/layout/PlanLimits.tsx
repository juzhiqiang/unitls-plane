import type { PlanDisplayLimit } from '@utils-plane/utils';

interface PlanLimitsProps {
  eyebrow: string;
  title: string;
  intro: string;
  plans: PlanDisplayLimit[];
  labels: {
    plan: string;
    uploadLimit: string;
    imageGenerate: string;
    unavailable: string;
    notes: string;
  };
  planLabels: Record<string, string>;
  planNotes: Record<string, string>;
  betaNote: string;
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb} MB`;
}

function formatDailyCount(count: number, unavailableLabel: string): string {
  return count > 0 ? String(count) : unavailableLabel;
}

export function PlanLimits({
  eyebrow,
  title,
  intro,
  plans,
  labels,
  planLabels,
  planNotes,
  betaNote,
}: PlanLimitsProps) {
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

      <div className="mt-10 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="py-3 pr-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {labels.plan}
              </th>
              <th className="py-3 pr-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {labels.uploadLimit}
              </th>
              <th className="py-3 pr-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {labels.imageGenerate}
              </th>
              <th className="py-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {labels.notes}
              </th>
            </tr>
          </thead>
          <tbody>
            {plans.map(
              ({ plan, uploadMaxFileSize, imageGenerateDailyCount, isPublicBetaTopTier }) => (
                <tr
                  key={plan}
                  data-highlight={isPublicBetaTopTier || undefined}
                  className="border-b border-border/50"
                >
                  <td className="py-3 pr-4 font-medium text-foreground">
                    {planLabels[plan]}
                  </td>
                  <td className="py-3 pr-4 font-mono text-muted-foreground">
                    {formatFileSize(uploadMaxFileSize)}
                  </td>
                  <td className="py-3 pr-4 font-mono text-muted-foreground">
                    {formatDailyCount(imageGenerateDailyCount, labels.unavailable)}
                  </td>
                  <td className="py-3 text-muted-foreground">
                    {planNotes[plan]}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {betaNote && (
        <p className="mt-8 max-w-2xl text-sm leading-6 text-muted-foreground">
          {betaNote}
        </p>
      )}
    </div>
  );
}
