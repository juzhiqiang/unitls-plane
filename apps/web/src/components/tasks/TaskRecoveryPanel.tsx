'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import {
  getTaskScope,
  taskReceipts,
  RECEIPT_RETENTION_MS,
} from '@/lib/tasks/task-receipts';
import { useTaskRecovery } from '@/hooks/api/use-task-recovery';
import { Link } from '@/i18n/navigation';
import { TaskRecoveryRow } from './TaskRecoveryRow';

export function TaskRecoveryPanel() {
  const { data: session, isPending } = useSession();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || isPending) return null;
  const scope = getTaskScope(session?.user.id);
  return (
    <RecoveryList key={scope} scope={scope} signedIn={!!session?.user.id} />
  );
}

function RecoveryList({
  scope,
  signedIn,
}: {
  scope: string;
  signedIn: boolean;
}) {
  const t = useTranslations('TaskRecovery');
  const records = useSyncExternalStore(
    taskReceipts.subscribe,
    () => taskReceipts.list(scope),
    taskReceipts.serverSnapshot
  );
  const [now, setNow] = useState(Date.now);
  const [visibleCount, setVisibleCount] = useState(10);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const receipts = records
    .filter(row => !row.hidden && row.startedAt > now - RECEIPT_RETENTION_MS)
    .slice()
    .reverse();
  const visible = receipts.slice(0, visibleCount);
  const query = useTaskRecovery(scope, visible);
  if (!receipts.length) return null;
  return (
    <details className="mx-4 mt-4 rounded-lg border border-border bg-card px-4 py-3 text-sm lg:mx-6">
      <summary className="cursor-pointer font-medium">
        {t('title', { count: receipts.length })}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">{t('background')}</p>
        {query.isError && (
          <p
            role="status"
            className="text-xs text-amber-600 dark:text-amber-400"
          >
            {t('reconnecting')}
          </p>
        )}
        <ul className="max-h-72 space-y-3 overflow-y-auto">
          {visible.map(receipt => (
            <TaskRecoveryRow
              key={receipt.key}
              scope={scope}
              receipt={receipt}
              now={now}
              status={query.data?.find(
                row => row.taskId === (receipt.taskId ?? receipt.key)
              )}
            />
          ))}
        </ul>
        <div className="flex flex-wrap gap-4 text-xs">
          <button
            type="button"
            onClick={() => {
              void query.refetch();
            }}
            disabled={query.isFetching}
            className="underline underline-offset-4 disabled:opacity-50"
          >
            {t('refresh')}
          </button>
          {receipts.length > visibleCount && (
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() =>
                setVisibleCount(count => Math.min(count + 10, 100))
              }
            >
              {t('showMore')}
            </button>
          )}
          {signedIn && (
            <Link href="/tasks" className="underline underline-offset-4">
              {t('allTasks')}
            </Link>
          )}
        </div>
      </div>
    </details>
  );
}
