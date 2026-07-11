'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useTasks,
  useRetryTask,
  type TaskQuery,
  type TaskStatus,
  type TaskType,
} from '@/hooks/api/use-tasks';
import type { TaskResponseDto } from '@/hooks/api/types';
import { getTaskTypeCategory } from '@/lib/tasks/task-category';
import {
  ChevronDown,
  Download,
  RotateCcw,
  FileText,
  Image as ImageIcon,
  Type,
} from 'lucide-react';

type StatusFilter = 'all' | TaskStatus;
type TypeFilter = 'all' | 'image' | 'pdf' | 'font';
type ConfigSummaryItem = { label: string; value: string };

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(task: TaskResponseDto): string {
  if (!task.completedAt) {
    return '-';
  }
  const start = new Date(task.createdAt).getTime();
  const end = new Date(task.completedAt).getTime();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatConfigSummary(
  config: Record<string, unknown> | null | undefined
): ConfigSummaryItem[] {
  if (!config) return [];

  return Object.entries(config).map(([key, value]) => ({
    label: key,
    value:
      value !== null && typeof value === 'object'
        ? JSON.stringify(value)
        : String(value),
  }));
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('TasksTool');

  const config: Record<string, { label: string; className: string }> = {
    completed: {
      label: t('statusDone'),
      className: 'border-accent text-accent',
    },
    processing: {
      label: t('statusRun'),
      className: 'border-accent text-accent animate-pulse',
    },
    failed: {
      label: t('statusFail'),
      className: 'border-destructive text-destructive',
    },
    pending: {
      label: t('statusWait'),
      className: 'border-muted-foreground text-muted-foreground',
    },
  };

  const { label, className } = config[status] ?? config.pending!;

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider border ${className}`}
    >
      [ {label} ]
    </span>
  );
}

function TypeLabel({ type }: { type: TaskType }) {
  const t = useTranslations('TasksTool');

  const labels: Record<TaskType, string> = {
    compress: t('typeCompress'),
    convert: t('typeConvert'),
    image_watermark: t('typeImageWatermark'),
    image_id_photo: t('typeImageIdPhoto'),
    pdf_merge: t('typePdfMerge'),
    pdf_split: t('typePdfSplit'),
    pdf_to_image: t('typePdfToImage'),
    pdf_to_text: t('typePdfToText'),
    image_to_pdf: t('typeImageToPdf'),
    pdf_rotate: t('typePdfRotate'),
    pdf_watermark: t('typePdfWatermark'),
    pdf_encrypt: t('typePdfEncrypt'),
    pdf_compress: t('typePdfCompress'),
    pdf_metadata: t('typePdfMetadata'),
    pdf_rearrange: t('typePdfRearrange'),
    pdf_from_document: t('typePdfFromDocument'),
    font_convert: t('typeFontConvert'),
  };

  const icons: Record<string, React.ReactNode> = {
    image: <ImageIcon className="h-3 w-3" strokeWidth={1.5} />,
    pdf: <FileText className="h-3 w-3" strokeWidth={1.5} />,
    font: <Type className="h-3 w-3" strokeWidth={1.5} />,
  };

  const category = getTaskTypeCategory(type);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
      {icons[category]}
      {labels[type]}
    </span>
  );
}

function ProgressBar({
  progress,
  status,
}: {
  progress: number;
  status: string;
}) {
  if (status === 'completed') return null;
  if (status === 'failed') return null;
  if (status === 'pending' && progress === 0) return null;

  return (
    <div className="w-full h-[2px] bg-border rounded-none overflow-hidden">
      <div
        className={`h-full bg-accent transition-all duration-300 ${
          status === 'processing' && progress < 100 ? 'animate-pulse' : ''
        }`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function TaskDetailPanel({ task }: { task: TaskResponseDto }) {
  const t = useTranslations('TasksTool');
  const configSummary = formatConfigSummary(task.inputConfig);

  return (
    <div className="border-t border-border px-3 py-4 space-y-3 bg-muted/20">
      {/* Input files */}
      {task.inputFileIds && task.inputFileIds.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('inputFiles')}
          </span>
          <p className="text-[11px] font-mono text-foreground/80">
            {task.inputFileIds.length} {t('inputFiles')}
          </p>
          <div className="flex flex-wrap gap-2">
            {task.inputFileIds.map(id => (
              <span
                key={id}
                className="text-[11px] font-mono text-foreground/80"
              >
                {id.slice(0, 8)}...
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Output file */}
      {task.outputFileId && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('outputFile')}
          </span>
          <span className="text-[11px] font-mono text-foreground/80 block">
            {task.outputFileId.slice(0, 8)}... - {t('download')}
          </span>
        </div>
      )}

      {/* Error */}
      {task.errorCode && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-destructive">
            {t('failureReason')}
          </span>
          <p className="text-[11px] text-destructive/80 break-words">
            {task.errorMessage || task.errorCode}
          </p>
          <span className="block text-[10px] font-mono text-destructive/70">
            {task.errorCode}
          </span>
          <span className="block pt-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('suggestedAction')}
          </span>
          <p className="text-[11px] text-muted-foreground">
            {t('tryAgainOrReplace')}
          </p>
        </div>
      )}

      {/* Config */}
      {configSummary.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {t('parameterSummary')}
          </span>
          <dl className="grid gap-1">
            {configSummary.map(item => (
              <div
                key={item.label}
                className="grid gap-1 sm:grid-cols-[160px_1fr]"
              >
                <dt className="text-[10px] font-mono text-muted-foreground">
                  {item.label}
                </dt>
                <dd className="text-[11px] font-mono text-foreground/80 break-words">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  const t = useTranslations('TasksTool');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const query: TaskQuery = {
    page,
    limit: 20,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };

  const { data, isLoading } = useTasks(query);
  const retryTask = useRetryTask();

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const filteredTasks =
    typeFilter === 'all'
      ? tasks
      : tasks.filter(
          t => getTaskTypeCategory(t.type as TaskType) === typeFilter
        );

  const handleDownload = (task: TaskResponseDto) => {
    if (!task.outputFileId) return;
    const url = `${process.env.NEXT_PUBLIC_API_URL}/files/${task.outputFileId}/download`;
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    a.click();
  };

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: t('allStatuses') },
    { value: 'completed', label: t('completed') },
    { value: 'processing', label: t('processing') },
    { value: 'failed', label: t('failed') },
    { value: 'pending', label: t('pending') },
  ];

  const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: t('allTypes') },
    { value: 'image', label: t('images') },
    { value: 'pdf', label: t('pdfs') },
    { value: 'font', label: t('fonts') },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-medium">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('description')}</p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status filter */}
        <div className="flex border border-border rounded-md overflow-hidden">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setStatusFilter(f.value);
                setPage(1);
              }}
              className={`px-3 h-8 text-[11px] font-mono uppercase tracking-wider transition-colors relative ${
                statusFilter === f.value
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              {statusFilter === f.value && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex border border-border rounded-md overflow-hidden">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setTypeFilter(f.value);
                setPage(1);
              }}
              className={`px-3 h-8 text-[11px] font-mono uppercase tracking-wider transition-colors relative ${
                typeFilter === f.value
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              {typeFilter === f.value && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {filteredTasks.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground py-12 text-center">
          {t('empty')}
        </p>
      )}

      {/* Table */}
      {filteredTasks.length > 0 && (
        <div>
          {/* Table header (md+) */}
          <div className="hidden md:grid grid-cols-[140px_90px_140px_80px_1fr_80px] gap-3 px-3 py-2 border-b border-border">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('type')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('status')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('created')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('duration')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              {t('progress')}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider text-right">
              {t('actions')}
            </span>
          </div>

          {/* Rows */}
          {filteredTasks.map(task => (
            <div key={task.id}>
              {/* Mobile / tablet card layout */}
              <div
                className={`md:hidden border-b border-border px-3 py-3 cursor-pointer transition-colors ${
                  expandedId === task.id ? 'bg-muted/40' : 'hover:bg-muted/40'
                }`}
                onClick={() =>
                  setExpandedId(expandedId === task.id ? null : task.id)
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeLabel type={task.type as TaskType} />
                      <StatusBadge status={task.status} />
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                      <span>
                        {formatTimestamp(task.createdAt as unknown as string)}
                      </span>
                      <span className="tabular-nums">
                        {formatDuration(task)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {task.status === 'completed' && task.outputFileId && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleDownload(task);
                        }}
                        className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                        title={t('download')}
                        aria-label={t('download')}
                      >
                        <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                    {task.status === 'failed' && (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          retryTask.mutate(task.id);
                        }}
                        disabled={retryTask.isPending}
                        className="p-2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title={t('retry')}
                        aria-label={t('retry')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setExpandedId(expandedId === task.id ? null : task.id);
                      }}
                      className={`p-2 text-muted-foreground hover:text-foreground transition-all ${
                        expandedId === task.id ? 'rotate-180' : ''
                      }`}
                      title={t('details')}
                      aria-label={t('details')}
                    >
                      <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                {(task.status === 'processing' ||
                  task.status === 'pending') && (
                  <div className="mt-2.5">
                    <ProgressBar
                      progress={task.progress}
                      status={task.status}
                    />
                  </div>
                )}
              </div>

              {/* Desktop table row (md+) */}
              <div
                className={`hidden md:grid grid-cols-[140px_90px_140px_80px_1fr_80px] gap-3 px-3 py-3 border-b border-border transition-colors cursor-pointer ${
                  expandedId === task.id ? 'bg-muted/40' : 'hover:bg-muted/40'
                }`}
                onClick={() =>
                  setExpandedId(expandedId === task.id ? null : task.id)
                }
              >
                <TypeLabel type={task.type as TaskType} />
                <StatusBadge status={task.status} />
                <span className="text-[11px] font-mono text-muted-foreground">
                  {formatTimestamp(task.createdAt as unknown as string)}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {formatDuration(task)}
                </span>
                <div className="flex items-center">
                  <ProgressBar progress={task.progress} status={task.status} />
                  {task.status === 'completed' && (
                    <span className="text-[10px] font-mono text-accent">
                      100%
                    </span>
                  )}
                </div>
                <div className="flex justify-end items-center gap-1">
                  {task.status === 'completed' && task.outputFileId && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        handleDownload(task);
                      }}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                      title={t('download')}
                      aria-label={t('download')}
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        retryTask.mutate(task.id);
                      }}
                      disabled={retryTask.isPending}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      title={t('retry')}
                      aria-label={t('retry')}
                    >
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      setExpandedId(expandedId === task.id ? null : task.id);
                    }}
                    className={`p-1 text-muted-foreground hover:text-foreground transition-all ${
                      expandedId === task.id ? 'rotate-180' : ''
                    }`}
                    title={t('details')}
                    aria-label={t('details')}
                  >
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {/* Expanded detail panel */}
              {expandedId === task.id && <TaskDetailPanel task={task} />}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`h-7 w-7 text-xs font-mono rounded-md transition-colors ${
                p === page
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
