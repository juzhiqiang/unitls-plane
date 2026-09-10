'use client';

import { useTranslations } from 'next-intl';

export function CursorPagination({
  page,
  hasNext,
  busy,
  onFirst,
  onPrevious,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  busy: boolean;
  onFirst: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const t = useTranslations('Pagination');
  const style =
    'px-3 h-8 text-xs font-mono border border-border rounded-md disabled:opacity-40 hover:bg-muted';
  return (
    <nav
      aria-label={t('label')}
      className="flex items-center justify-center gap-2 pt-4"
    >
      <button
        type="button"
        className={style}
        disabled={busy || page === 1}
        onClick={onFirst}
      >
        {t('first')}
      </button>
      <button
        type="button"
        className={style}
        disabled={busy || page === 1}
        onClick={onPrevious}
      >
        {t('previous')}
      </button>
      <span aria-live="polite" className="text-xs font-mono">
        {t('page', { page })}
      </span>
      <button
        type="button"
        className={style}
        disabled={busy || !hasNext}
        onClick={onNext}
      >
        {t('next')}
      </button>
    </nav>
  );
}

export function ListQueryError({ retry }: { retry: () => void }) {
  const t = useTranslations('Pagination');
  return (
    <div role="alert" className="text-sm text-destructive py-4 text-center">
      {t('error')}{' '}
      <button type="button" onClick={retry} className="underline">
        {t('retry')}
      </button>
    </div>
  );
}
