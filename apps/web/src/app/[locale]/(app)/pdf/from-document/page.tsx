'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, FileText, Server, Type } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DownloadButton } from '@/components/tools/download-button';
import { FailureRecoveryPanel } from '@/components/tools/failure-recovery-panel';
import { FileDropzone } from '@/components/tools/file-dropzone';
import { MarkdownEditor } from '@/components/tools/markdown-editor';
import { MarkdownPreview } from '@/components/tools/markdown-preview';
import { PdfResultPreview } from '@/components/tools/pdf-result-preview';
import { ProcessingProgress } from '@/components/tools/processing-progress';
import { ResultPanel } from '@/components/tools/result-panel';
import { ToolPageShell } from '@/components/tools/tool-page-shell';
import { useUploadFile } from '@/hooks/api/use-files';
import { useCreateTask } from '@/hooks/api/use-tasks';
import { useTaskProgress } from '@/hooks/api/use-task-progress';
import { useRequireLogin } from '@/hooks/use-require-login';
import {
  createMarkdownSourceFile,
  deriveDocumentPdfFilename,
  isMarkdownDocumentFile,
  readMarkdownDocumentFile,
} from '@/lib/processing/markdown-document-client';
import { printMarkdownPreviewPdf } from '@/lib/processing/markdown-print-client';
import { getToolByHref } from '@/lib/tools/tool-metadata';
import { cn } from '@/lib/utils';

type SourceMode = 'markdown' | 'docx';

const DEFAULT_MARKDOWN = `# Project Brief

## Goals

- Turn Markdown into a polished PDF
- Keep headings, lists, tables, and code readable
- Preview the source before conversion
`;

function ensurePdfFilename(value: string): string {
  const trimmed = value.trim() || 'document.pdf';
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
}

export default function FromDocumentPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/from-document')!;
  const markdownPreviewRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SourceMode>('markdown');
  const [markdown, setMarkdown] = useState(DEFAULT_MARKDOWN);
  const [markdownSourceName, setMarkdownSourceName] =
    useState('markdown-source.md');
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [outputFilename, setOutputFilename] = useState('document.pdf');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { requireLogin } = useRequireLogin();
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
        setResult(
          new File([blob], ensurePdfFilename(outputFilename), {
            type: 'application/pdf',
          })
        );
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

  const handleMarkdownDrop = useCallback((files: File[]) => {
    const file = files.find(isMarkdownDocumentFile);
    if (!file) return;

    readMarkdownDocumentFile(file)
      .then(text => {
        setMarkdown(text);
        setMarkdownSourceName(file.name);
        setOutputFilename(deriveDocumentPdfFilename(file.name));
        setResult(null);
        setError(null);
      })
      .catch(err => setError((err as Error).message));
  }, []);

  const handleDocxDrop = useCallback((files: File[]) => {
    const file = files.find(f => /\.docx$/i.test(f.name));
    if (!file) return;

    setDocxFile(file);
    setOutputFilename(`${file.name.replace(/\.docx$/i, '')}.pdf`);
    setResult(null);
    setError(null);
  }, []);

  const inputReady =
    mode === 'markdown' ? markdown.trim().length > 0 : docxFile !== null;

  const stage = result
    ? 'result'
    : processing
      ? 'processing'
      : inputReady
        ? 'configure'
        : 'upload';

  const handleLocalExport = () => {
    if (mode !== 'markdown' || !inputReady) return;

    setError(null);
    const didPrint = printMarkdownPreviewPdf({
      title: ensurePdfFilename(outputFilename),
      sourceElement: markdownPreviewRef.current,
    });

    if (!didPrint) {
      setError(t('fromDocument.localExportUnavailable'));
    }
  };

  const handleConvert = async () => {
    if (!inputReady) return;

    if (requireLogin('/pdf/from-document')) return;

    setProcessing(true);
    setError(null);
    setResult(null);

    try {
      const sourceFile =
        mode === 'markdown'
          ? createMarkdownSourceFile(markdown, markdownSourceName)
          : docxFile!;
      const uploaded = (await uploadFile.mutateAsync(sourceFile)) as any;
      const task = await createTask.mutateAsync({
        type: 'pdf_from_document',
        inputFileIds: [uploaded.id],
        inputConfig: {
          sourceFormat: mode,
          outputFilename: ensurePdfFilename(outputFilename),
        },
      });
      setTaskId(task.id);
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setDocxFile(null);
    setResult(null);
    setError(null);
    setTaskId(null);
    setProcessing(false);
  };

  const modeOptions = useMemo(
    () => [
      { value: 'markdown' as const, label: 'Markdown', icon: Type },
      { value: 'docx' as const, label: 'Word', icon: FileText },
    ],
    []
  );

  return (
    <ToolPageShell
      title={t('fromDocument.title')}
      description={t('fromDocument.description')}
      processing={tool.processing}
      retention={tool.retention}
      requiresLogin={tool.requiresLogin}
      recovery={tShell('catalogRecovery')}
      stage={stage}
      maxWidth="wide"
    >
      <div className="flex gap-2 border-b border-border">
        {modeOptions.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setResult(null);
              setError(null);
            }}
            disabled={processing}
            className={cn(
              'flex h-10 items-center gap-2 border-b-[1.5px] px-1 text-xs font-mono transition-colors -mb-px',
              mode === value
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={mode === value}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {mode === 'markdown' ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)]">
          <div className="min-w-0 space-y-4">
            <FileDropzone
              accept={{
                'text/markdown': ['.md', '.markdown', '.mdown', '.mkdn'],
                'text/plain': ['.txt'],
                'application/octet-stream': [
                  '.md',
                  '.markdown',
                  '.mdown',
                  '.mkdn',
                  '.txt',
                ],
              }}
              maxSize={10 * 1024 * 1024}
              onDrop={handleMarkdownDrop}
              disabled={processing}
              hint="MD / Markdown / TXT"
              processingLabel={tShell('trust.processing.server')}
              density="compact"
            />

            <MarkdownEditor
              value={markdown}
              onChange={value => {
                setMarkdown(value);
                setResult(null);
                setError(null);
              }}
              disabled={processing}
              label={t('fromDocument.markdown')}
            />
          </div>

          <div className="min-w-0 space-y-3 xl:sticky xl:top-6 xl:self-start">
            <div className="flex h-10 items-center justify-between border-b border-border">
              <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {t('fromDocument.preview')}
              </p>
              <p className="truncate pl-3 text-[10px] font-mono text-muted-foreground">
                {markdownSourceName}
              </p>
            </div>
            <div ref={markdownPreviewRef}>
              <MarkdownPreview
                content={markdown}
                format="markdown"
                className="min-h-[604px]"
                viewportClassName="min-h-[560px]"
                labelPreview={t('fromDocument.preview')}
                labelSource={t('fromDocument.source')}
                labelCopy={t('toText.copy')}
                labelCopied={t('toText.copied')}
                labelLines={t('toText.lines')}
                labelChars={t('toText.chars')}
                labelWords={t('toText.words')}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <FileDropzone
            accept={{
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                ['.docx'],
            }}
            maxSize={50 * 1024 * 1024}
            onDrop={handleDocxDrop}
            disabled={processing}
            hint="DOCX"
            processingLabel={tShell('trust.processing.server')}
            density="compact"
          />

          {docxFile && (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-mono text-foreground">
                  {docxFile.name}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground tabular-nums">
                  {(docxFile.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <button
                type="button"
                onClick={handleReset}
                disabled={processing}
                className="shrink-0 text-xs font-mono text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {t('fromDocument.changeFile')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {t('fromDocument.outputFilename')}
        </label>
        <input
          type="text"
          value={outputFilename}
          onChange={event => setOutputFilename(event.target.value)}
          disabled={processing}
          className="h-9 w-full rounded-md border border-border bg-transparent px-3 font-mono text-sm outline-none transition-colors focus:border-accent disabled:opacity-50"
        />
      </div>

      <div
        className={cn('grid gap-3', mode === 'markdown' && 'sm:grid-cols-2')}
      >
        {mode === 'markdown' && (
          <button
            type="button"
            onClick={handleLocalExport}
            disabled={processing || !inputReady}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-sm font-mono text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" strokeWidth={1.5} />
            {t('fromDocument.localExport')}
          </button>
        )}

        <button
          type="button"
          onClick={handleConvert}
          disabled={processing || !inputReady}
          className={cn(
            'flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-mono transition-colors disabled:opacity-50',
            mode === 'markdown'
              ? 'border border-border text-foreground hover:border-foreground/60'
              : 'bg-foreground text-background hover:opacity-90'
          )}
        >
          <Server className="h-4 w-4" strokeWidth={1.5} />
          {processing
            ? t('fromDocument.processing')
            : mode === 'markdown'
              ? t('fromDocument.serverExport')
              : t('fromDocument.start')}
        </button>
      </div>

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
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
          preview={
            <PdfResultPreview
              file={result}
              label={t('fromDocument.resultPreview')}
              previousLabel={t('fromDocument.previousPage')}
              nextLabel={t('fromDocument.nextPage')}
              pageIndicator={(page, total) =>
                t('fromDocument.pageIndicator', { page, total })
              }
              thumbnailLabel={page =>
                t('fromDocument.thumbnailLabel', { page })
              }
              loadingLabel={t('fromDocument.loadingPdf')}
            />
          }
          action={<DownloadButton file={result} />}
        />
      )}
    </ToolPageShell>
  );
}
