'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { FontPreview } from '@/components/tools/font-preview';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { DownloadButton } from '@/components/tools/download-button';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { ResultPanel } from '@/components/tools/result-panel';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { authClient } from '@/lib/auth-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { X } from 'lucide-react';

type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

const FORMATS: { value: FontFormat; label: string }[] = [
  { value: 'woff2', label: 'WOFF2' },
  { value: 'woff', label: 'WOFF' },
  { value: 'ttf', label: 'TTF' },
  { value: 'otf', label: 'OTF' },
];

function FormatSegment({
  value,
  onChange,
  disabled,
}: {
  value: FontFormat;
  onChange: (v: FontFormat) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex border border-border rounded-md overflow-hidden">
      {FORMATS.map(fmt => (
        <button
          key={fmt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(fmt.value)}
          className={`flex-1 h-9 text-xs font-mono uppercase tracking-wider transition-colors relative disabled:opacity-50 ${
            value === fmt.value
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {fmt.label}
          {value === fmt.value && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
          )}
        </button>
      ))}
    </div>
  );
}

export default function FontPage() {
  const t = useTranslations('FontTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/font')!;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [toFormat, setToFormat] = useState<FontFormat>('woff2');
  const [subsetText, setSubsetText] = useState('');
  const [enableSubset, setEnableSubset] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async outputFileId => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
          { credentials: 'include' }
        );
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const ext = toFormat === 'woff2' ? 'woff2' : toFormat;
        const baseName = file?.name.replace(/\.[^.]+$/, '') ?? 'converted';
        setResult(new File([blob], `${baseName}.${ext}`, { type: blob.type }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProcessing(false);
      }
    },
    onFailed: err => {
      setError(err.message);
      setProcessing(false);
    },
  });

  const handleConvert = async () => {
    if (!file) return;

    if (!session) {
      const next = encodeURIComponent('/font');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as unknown as {
        id: string;
      };
      const task = await createTask.mutateAsync({
        type: 'font_convert',
        inputFileIds: [uploaded.id],
        inputConfig: {
          toFormat,
          subsetText: enableSubset ? subsetText : undefined,
        },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const stage = result
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('title')}
      description={t('description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      {!file && (
        <FileDropzone
          accept={{
            'font/ttf': ['.ttf'],
            'font/otf': ['.otf'],
            'font/woff': ['.woff'],
            'font/woff2': ['.woff2'],
            'application/octet-stream': ['.ttf', '.otf', '.woff', '.woff2'],
          }}
          maxSize={50 * 1024 * 1024}
          onDrop={files => setFile(files[0] ?? null)}
          hint={t('dropzoneHint')}
          processingLabel={tShell('trust.processing.server')}
        />
      )}

      {file && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-8">
          {/* Config panel */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                {file.name}
              </span>
              <button
                type="button"
                onClick={handleReset}
                disabled={processing}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                {t('targetFormat')}
              </label>
              <FormatSegment
                value={toFormat}
                onChange={setToFormat}
                disabled={processing}
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSubset}
                  onChange={e => setEnableSubset(e.target.checked)}
                  disabled={processing}
                  className="h-3.5 w-3.5 rounded-sm border border-border bg-transparent checked:bg-accent checked:border-accent transition-colors"
                />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  {t('subset')}
                </span>
              </label>
              {enableSubset && (
                <textarea
                  value={subsetText}
                  onChange={e => setSubsetText(e.target.value)}
                  disabled={processing}
                  placeholder={t('subsetPlaceholder')}
                  rows={4}
                  className="w-full bg-transparent border border-border rounded-md px-4 py-3 font-mono text-base resize-none focus:outline-none focus:border-accent placeholder:text-muted-foreground transition-colors disabled:opacity-50"
                />
              )}
            </div>

            {!session && (
              <p className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                {tShell('trust.login.required')}
              </p>
            )}

            <button
              type="button"
              onClick={handleConvert}
              disabled={processing || !file}
              className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {processing ? t('processing') : t('start')}
            </button>

            {processing && progress && (
              <ProcessingProgress
                progress={progress.progress}
                stage="processing"
              />
            )}

            {error && (
              <FailureRecoveryPanel
                message={error}
                onRetry={handleConvert}
                onReset={handleReset}
              />
            )}

            {result && (
              <ResultPanel
                title={result.name}
                description={tShell('result.ready')}
                action={<DownloadButton file={result} />}
              />
            )}
          </div>

          {/* Preview panel */}
          <div className="min-w-0">
            <FontPreview file={file} />
          </div>
        </div>
      )}
    </ToolPageShell>
  );
}
