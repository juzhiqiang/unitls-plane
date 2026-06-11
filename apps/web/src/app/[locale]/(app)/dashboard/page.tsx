'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, FileText, History, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { PageSectionHeader } from '@/components/layout/page-section-header';
import { ToolCatalogGrid } from '@/components/tools/tool-catalog-grid';
import { recommendedTools, type ToolGroup } from '@/lib/tools/tool-metadata';
import { useFiles } from '@/hooks/api/use-files';
import { useTasks, type TaskType } from '@/hooks/api/use-tasks';

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export default function DashboardPage() {
  const t = useTranslations('Dashboard');
  const tasksQuery = useTasks({ page: 1, limit: 5 });
  const filesQuery = useFiles({ page: 1, limit: 5 });

  const tasks = tasksQuery.data?.tasks ?? [];
  const files = filesQuery.data?.files ?? [];
  const failedTasks = tasks.filter((task) => task.status === 'failed');
  const activeTasks = tasks.filter(
    (task) => task.status === 'pending' || task.status === 'processing',
  );

  const recommendedGroup = [
    {
      key: 'dashboardRecommended',
      titleKey: 'Dashboard.sections.quickTools',
      descriptionKey: 'Dashboard.sections.quickToolsDescription',
      tools: recommendedTools,
    },
  ] satisfies ToolGroup[];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageSectionHeader title={t('title')} description={t('welcome')} />

      <section className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-3">
        <div className="bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <History className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('sections.activeTasks')}
            </span>
          </div>
          <p className="text-2xl font-medium tabular-nums">{activeTasks.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('empty.activeTasks')}</p>
        </div>
        <div className="bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <AlertTriangle
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('sections.failedTasks')}
            </span>
          </div>
          <p className="text-2xl font-medium tabular-nums">{failedTasks.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('empty.failedTasks')}</p>
        </div>
        <div className="bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <ShieldCheck
              className="h-4 w-4 text-muted-foreground"
              strokeWidth={1.5}
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('sections.storage')}
            </span>
          </div>
          <p className="text-sm font-medium">{t('empty.storageTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('empty.storage')}</p>
        </div>
      </section>

      <ToolCatalogGrid groups={recommendedGroup} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <PageSectionHeader
            eyebrow="tasks"
            title={t('sections.recentTasks')}
            description={t('sections.recentTasksDescription')}
            action={
              <Link
                href="/tasks"
                className="text-xs font-mono text-muted-foreground hover:text-foreground"
              >
                {t('actions.viewTasks')}
              </Link>
            }
          />
          <div className="overflow-hidden rounded-md border border-border">
            {tasks.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t('empty.recentTasks')}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="grid grid-cols-[1fr_auto] gap-3 p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {t(`taskTypes.${task.type as TaskType}`)}
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {shortId(task.id)} / {formatDate(task.createdAt)}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t(`statuses.${task.status}`)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <PageSectionHeader
            eyebrow="files"
            title={t('sections.recentFiles')}
            description={t('sections.recentFilesDescription')}
            action={
              <Link
                href="/files"
                className="text-xs font-mono text-muted-foreground hover:text-foreground"
              >
                {t('actions.viewFiles')}
              </Link>
            }
          />
          <div className="overflow-hidden rounded-md border border-border">
            {files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {t('empty.recentFiles')}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-3 p-3 text-sm"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{file.filename}</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                        {file.mimeType} / {formatDate(file.createdAt)}
                      </p>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {shortId(file.id)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
