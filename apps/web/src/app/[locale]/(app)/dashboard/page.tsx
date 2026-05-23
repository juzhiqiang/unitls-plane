import { getTranslations } from 'next-intl/server';

export default async function DashboardPage() {
  const t = await getTranslations('Dashboard');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-medium">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('welcome')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">{t('totalFiles')}</div>
          <div className="text-2xl font-medium mt-2">0</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">{t('activeTasks')}</div>
          <div className="text-2xl font-medium mt-2">0</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="text-sm text-muted-foreground">{t('completed')}</div>
          <div className="text-2xl font-medium mt-2">0</div>
        </div>
      </div>
    </div>
  );
}
