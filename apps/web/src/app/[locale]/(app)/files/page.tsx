import { getTranslations } from 'next-intl/server';

export default async function FilesPage() {
  const t = await getTranslations('FilesTool');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-medium">{t('title')}</h1>
      <p className="text-muted-foreground">{t('empty')}</p>
    </div>
  );
}
