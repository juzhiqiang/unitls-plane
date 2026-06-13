'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { PDFDocument } from 'pdf-lib';
import { useRouter } from '@/i18n/navigation';
import { FileDropzone } from '@/components/tools/file-dropzone';
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

interface MetadataForm {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

const EMPTY_FORM: MetadataForm = {
  title: '',
  author: '',
  subject: '',
  keywords: '',
  creator: '',
  producer: '',
};

export default function MetadataPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/metadata')!;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [existing, setExisting] = useState<MetadataForm>(EMPTY_FORM);
  const [form, setForm] = useState<MetadataForm>(EMPTY_FORM);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultFile, setResultFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const uploadFile = useUploadFile();
  const createTask = useCreateTask();

  const { data: progress } = useTaskProgress(taskId, {
    onCompleted: async (outputFileId) => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/files/${outputFileId}/download`,
          { credentials: 'include' },
        );
        if (!response.ok) throw new Error('Download failed');
        const blob = await response.blob();
        const name = file?.name ?? 'output.pdf';
        setResultFile(new File([blob], name, { type: 'application/pdf' }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setProcessing(false);
      }
    },
    onFailed: (err) => {
      setError(err.message);
      setProcessing(false);
    },
  });

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    (async () => {
      try {
        const ab = await file.arrayBuffer();
        const doc = await PDFDocument.load(ab, { updateMetadata: false });
        if (cancelled) return;
        const meta: MetadataForm = {
          title: doc.getTitle() ?? '',
          author: doc.getAuthor() ?? '',
          subject: doc.getSubject() ?? '',
          keywords: (doc.getKeywords() ?? '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
            .join(', '),
          creator: doc.getCreator() ?? '',
          producer: doc.getProducer() ?? '',
        };
        setExisting(meta);
        setForm(meta);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const handleDrop = useCallback((files: File[]) => {
    const pdfFile = files.find((f) => f.type === 'application/pdf');
    if (!pdfFile) return;
    setFile(pdfFile);
    setExisting(EMPTY_FORM);
    setForm(EMPTY_FORM);
    setResultFile(null);
    setError(null);
  }, []);

  const handleChange = (key: keyof MetadataForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
    };

  const handleStart = async () => {
    if (!file) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/metadata');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResultFile(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const inputConfig: Record<string, unknown> = {};
      const textFields: Array<keyof Omit<MetadataForm, 'keywords' | 'producer'>> = [
        'title',
        'author',
        'subject',
        'creator',
      ];
      for (const key of textFields) {
        if (form[key] !== existing[key]) {
          inputConfig[key] = form[key];
        }
      }
      if (form.keywords !== existing.keywords) {
        inputConfig.keywords = form.keywords
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      const task = await createTask.mutateAsync({
        type: 'pdf_metadata',
        inputFileIds: [uploaded.id],
        inputConfig,
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const fields: Array<{
    key: keyof MetadataForm;
    label: string;
    hint?: string;
    readOnly?: boolean;
  }> = [
    { key: 'title', label: t('metadata.fieldTitle') },
    { key: 'author', label: t('metadata.fieldAuthor') },
    { key: 'subject', label: t('metadata.fieldSubject') },
    {
      key: 'keywords',
      label: t('metadata.fieldKeywords'),
      hint: t('metadata.fieldKeywordsHint'),
    },
    { key: 'creator', label: t('metadata.fieldCreator') },
    {
      key: 'producer',
      label: t('metadata.fieldProducer'),
      hint: t('metadata.fieldProducerHint'),
      readOnly: true,
    },
  ];

  const handleReset = () => {
    setFile(null);
    setExisting(EMPTY_FORM);
    setForm(EMPTY_FORM);
    setResultFile(null);
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const stage = resultFile
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('metadata.title')}
      description={t('metadata.description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
    >
      {!file && (
        <FileDropzone
          accept={{ 'application/pdf': ['.pdf'] }}
          maxSize={50 * 1024 * 1024}
          onDrop={handleDrop}
          hint="PDF"
          processingLabel={tShell('trust.processing.server')}
        />
      )}

      {file && (
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <p className="text-sm font-mono text-foreground">{file.name}</p>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('metadata.changeFile')}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            {fields.map(({ key, label, hint, readOnly }) => (
              <div key={key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <label
                    htmlFor={`field-${key}`}
                    className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider"
                  >
                    {label}
                  </label>
                  {hint && (
                    <span className="text-[10px] font-mono text-muted-foreground/70">
                      {hint}
                    </span>
                  )}
                </div>
                <input
                  id={`field-${key}`}
                  type="text"
                  value={form[key]}
                  onChange={handleChange(key)}
                  readOnly={readOnly}
                  disabled={processing}
                  className={
                    'w-full h-9 px-3 text-sm font-mono bg-background border border-border rounded-md ' +
                    'focus:outline-none focus:border-accent transition-colors ' +
                    'disabled:opacity-50 ' +
                    (readOnly ? 'text-muted-foreground cursor-not-allowed' : 'text-foreground')
                  }
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleStart}
            disabled={processing}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('metadata.processing') : t('metadata.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleStart}
          onReset={handleReset}
        />
      )}

      {resultFile && (
        <ResultPanel
          title={resultFile.name}
          description={tShell('result.ready')}
          action={<DownloadButton file={resultFile} />}
        />
      )}
    </ToolPageShell>
  );
}
