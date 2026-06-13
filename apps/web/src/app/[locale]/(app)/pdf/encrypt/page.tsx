'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
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
import { cn } from '@/lib/utils';

type PermissionKey = 'print' | 'copy' | 'modify' | 'annotate';

export default function EncryptPage() {
  const t = useTranslations('PdfTool');
  const tShell = useTranslations('ToolShell');
  const tool = getToolByHref('/pdf/encrypt')!;
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [permissions, setPermissions] = useState<
    Record<PermissionKey, boolean>
  >({
    print: true,
    copy: true,
    modify: true,
    annotate: true,
  });
  const [taskId, setTaskId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultFile, setResultFile] = useState<File | null>(null);
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
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const baseName = file?.name.replace(/\.pdf$/i, '') ?? 'output';
        setResultFile(
          new File([pdfBlob], `${baseName}-encrypted.pdf`, {
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

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    import('@/lib/processing/pdf-client').then(({ loadPdf }) => {
      loadPdf(file).then(doc => {
        if (cancelled) return;
        setPageCount(doc.numPages);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const resetState = () => {
    setUserPassword('');
    setOwnerPassword('');
    setPermissions({ print: true, copy: true, modify: true, annotate: true });
    setResultFile(null);
    setError(null);
    setTaskId(null);
  };

  const handleDrop = useCallback((files: File[]) => {
    const pdfFile = files.find(f => f.type === 'application/pdf');
    if (!pdfFile) return;
    setFile(pdfFile);
    setPageCount(0);
    setUserPassword('');
    setOwnerPassword('');
    setPermissions({ print: true, copy: true, modify: true, annotate: true });
    setResultFile(null);
    setError(null);
    setTaskId(null);
  }, []);

  const handleChangeFile = () => {
    setFile(null);
    setPageCount(0);
    resetState();
  };

  const togglePermission = (key: PermissionKey) => {
    setPermissions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleEncrypt = async () => {
    if (!file || !ownerPassword) return;

    if (!session) {
      const next = encodeURIComponent('/pdf/encrypt');
      router.push(`/login?next=${next}`);
      return;
    }

    setProcessing(true);
    setError(null);
    setResultFile(null);

    try {
      const uploaded = (await uploadFile.mutateAsync(file)) as any;

      const inputConfig: Record<string, unknown> = {
        ownerPassword,
        permissions: {
          print: permissions.print,
          copy: permissions.copy,
          modify: permissions.modify,
          annotate: permissions.annotate,
        },
      };
      if (userPassword) {
        inputConfig.userPassword = userPassword;
      }

      const task = await createTask.mutateAsync({
        type: 'pdf_encrypt',
        inputFileIds: [uploaded.id],
        inputConfig,
      });
      setTaskId(task.id);

      // Clear passwords from memory after submission — backend has them
      setUserPassword('');
      setOwnerPassword('');
    } catch (err) {
      setError((err as Error).message);
      setProcessing(false);
    }
  };

  const permItems: { key: PermissionKey; label: string }[] = [
    { key: 'print', label: t('encrypt.permPrint') },
    { key: 'copy', label: t('encrypt.permCopy') },
    { key: 'modify', label: t('encrypt.permModify') },
    { key: 'annotate', label: t('encrypt.permAnnotate') },
  ];

  const stage = resultFile
    ? 'result'
    : processing
      ? 'processing'
      : file
        ? 'configure'
        : 'upload';

  return (
    <ToolPageShell
      title={t('encrypt.title')}
      description={t('encrypt.description')}
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
            <div>
              <p className="text-sm font-mono text-foreground">{file.name}</p>
              <p className="text-[10px] font-mono text-muted-foreground tabular-nums">
                {pageCount > 0 ? `${pageCount} pages` : '...'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleChangeFile}
              disabled={processing}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              Change file
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label
                htmlFor="encrypt-user-password"
                className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block"
              >
                {t('encrypt.userPassword')}
              </label>
              <input
                id="encrypt-user-password"
                type="password"
                value={userPassword}
                onChange={e => setUserPassword(e.target.value)}
                disabled={processing}
                autoComplete="new-password"
                className="w-full h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
              />
              <p className="text-[10px] font-mono text-muted-foreground">
                {t('encrypt.userPasswordHint')}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="encrypt-owner-password"
                className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block"
              >
                {t('encrypt.ownerPassword')}
              </label>
              <input
                id="encrypt-owner-password"
                type="password"
                value={ownerPassword}
                onChange={e => setOwnerPassword(e.target.value)}
                disabled={processing}
                autoComplete="new-password"
                required
                className="w-full h-9 px-3 text-sm font-mono bg-transparent border border-border rounded-md focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
              />
              <p className="text-[10px] font-mono text-muted-foreground">
                {t('encrypt.ownerPasswordHint')}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block">
              {t('encrypt.permissions')}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {permItems.map(({ key, label }) => (
                <label
                  key={key}
                  className={cn(
                    'flex items-center gap-3 px-3 h-9 border border-border rounded-md cursor-pointer transition-colors',
                    processing
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-muted/40'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={permissions[key]}
                    onChange={() => togglePermission(key)}
                    disabled={processing}
                    className="h-3.5 w-3.5 accent-foreground cursor-pointer disabled:cursor-not-allowed"
                  />
                  <span className="text-sm font-mono text-foreground">
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
            {t('encrypt.securityNote')}
          </p>

          <button
            type="button"
            onClick={handleEncrypt}
            disabled={processing || !ownerPassword}
            className="w-full h-10 text-sm font-mono bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {processing ? t('encrypt.processing') : t('encrypt.start')}
          </button>
        </div>
      )}

      {processing && progress && (
        <ProcessingProgress progress={progress.progress} stage="processing" />
      )}

      {error && (
        <FailureRecoveryPanel
          message={error}
          onRetry={handleEncrypt}
          onReset={handleChangeFile}
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
