'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useSession } from '@/hooks/use-session';
import { useTaskStatus, useImageGenerationQuota, useImageGenerateModels } from '@/hooks/api/use-tasks';
import { useAiTryOnReferences } from '@/hooks/api/use-ai-try-on';
import { buildImageTryOnTaskPayload, type BuildImageTryOnPayloadInput } from '@/components/tools/ai-try-on';
import { PoseLibraryWithFilters, UploadReferenceCard } from '@/components/tools/ai-try-on';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

type AiTryOnMode = 'product' | 'inspiration';

export default function AiTryOnPage() {
  const t = useTranslations('ImageTryOn');
  const locale = useLocale();
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();

  const [mode, setMode] = useState<AiTryOnMode>('product');
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [poseAssetId, setPoseAssetId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('auto');
  const [quality, setQuality] = useState<'auto' | 'standard' | 'high'>('high');
  const [model, setModel] = useState<string>('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  const { data: poseLibrary, isLoading: isPoseLoading, isError: isPoseError, refetch: refetchPose } =
    useAiTryOnReferences('pose');

  const { data: taskStatus } = useTaskStatus(taskId ?? '');
  
  const { data: quota } = useImageGenerationQuota();
  const { data: models } = useImageGenerateModels();

  const quotaText = useMemo(() => {
    if (!quota) return '加载中...';
    return `${quota.remaining} / ${quota.limit}`;
  }, [quota]);

  const canSubmit = personFile && garmentFile && !isSubmitting && !sessionPending && (quota?.remaining ?? 0) > 0;

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);

    const { data, error } = await api.POST('/files/upload', {
      body: formData as any,
    });

    if (error || !data) {
      throw new Error('File upload failed');
    }

    return (data as any).id;
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!personFile || !garmentFile) {
      toast.error(t('errors.missingPerson'));
      return;
    }

    if ((quota?.remaining ?? 0) <= 0) {
      toast.error(t('quotaExhausted'));
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(null);

    try {
      const filesToUpload = [
        { file: personFile, role: 'person' as const },
        { file: garmentFile, role: 'garment' as const },
      ];

      setUploadProgress({ current: 0, total: filesToUpload.length });

      const fileIds: Record<string, string> = {};
      for (let i = 0; i < filesToUpload.length; i++) {
        const { file, role } = filesToUpload[i];
        const fileId = await uploadFile(file);
        fileIds[role] = fileId;
        setUploadProgress({ current: i + 1, total: filesToUpload.length });
      }

      const input: BuildImageTryOnPayloadInput = {
        mode,
        person: { source: 'upload', fileId: fileIds.person } as any,
        garment: { source: 'upload', fileId: fileIds.garment } as any,
        poseAssetId: poseAssetId ?? undefined,
        promptAddition: prompt || undefined,
        size: size === 'auto' ? undefined : size,
        quality,
        model: model || undefined,
      };

      const payloadResult = buildImageTryOnTaskPayload(input);

      if (!payloadResult.ok) {
        throw new Error(t(`errors.${payloadResult.errorKey}` as any));
      }

      const { data, error } = await api.POST('/tasks', {
        body: payloadResult.payload as any,
      });

      if (error || !data) {
        throw new Error(t('errors.failed'));
      }

      setTaskId((data as any).id);
      toast.success(t('queued'));
    } catch (error) {
      toast.error((error as Error).message || t('errors.failed'));
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  }, [mode, personFile, garmentFile, poseAssetId, prompt, size, quality, model, quota?.remaining, uploadFile, t]);

  return (
    <div className="container mx-auto max-w-7xl space-y-8 px-4 py-8">
      {/* 页头 */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      {/* 额度提示 */}
      {quota && (
        <div className={`rounded-lg border p-4 text-sm ${
          quota.remaining > 0 
            ? 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300'
            : 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300'
        }`}>
          <p className="font-semibold">{t('quotaBadge', { remaining: quota.remaining, limit: quota.limit })}</p>
        </div>
      )}

      {/* 试衣模式切换 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('modeLabel')}</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setMode('product')}
            disabled={isSubmitting || sessionPending}
            className={`rounded-lg border-2 p-4 text-left transition-all ${
              mode === 'product'
                ? 'border-foreground bg-muted/30'
                : 'border-border hover:border-foreground/50'
            } disabled:opacity-50`}
          >
            <div className="font-semibold">{t('modes.product')}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t('modes.productDescription')}</p>
          </button>
          <button
            type="button"
            onClick={() => setMode('inspiration')}
            disabled={isSubmitting || sessionPending}
            className={`rounded-lg border-2 p-4 text-left transition-all ${
              mode === 'inspiration'
                ? 'border-foreground bg-muted/30'
                : 'border-border hover:border-foreground/50'
            } disabled:opacity-50`}
          >
            <div className="font-semibold">{t('modes.inspiration')}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t('modes.inspirationDescription')}</p>
          </button>
        </div>
      </div>

      {/* 人像上传 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('personLabel')}</h2>
        <UploadReferenceCard
          role="person"
          file={personFile}
          actionLabel={t('personUploadAction') || '上传人像照片'}
          maxFileSize={10 * 1024 * 1024}
          disabled={isSubmitting || sessionPending}
          onFileChange={setPersonFile}
          onOversizeError={(maxSizeFormatted) => {
            toast.error(t('errors.fileTooLarge', { size: maxSizeFormatted }));
          }}
        />
      </div>

      {/* 服饰上传 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{t('garmentLabel')}</h2>
        <UploadReferenceCard
          role="garment"
          file={garmentFile}
          actionLabel={t('garmentUploadAction') || '上传商品实拍图'}
          maxFileSize={10 * 1024 * 1024}
          disabled={isSubmitting || sessionPending}
          onFileChange={setGarmentFile}
          onOversizeError={(maxSizeFormatted) => {
            toast.error(t('errors.fileTooLarge', { size: maxSizeFormatted }));
          }}
        />
      </div>

      {/* 姿势选择 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('poseLabel')}</h2>
          <span className="text-sm text-muted-foreground">{t('optionalLabel')}</span>
        </div>

        <PoseLibraryWithFilters
          items={poseLibrary || []}
          selectedId={poseAssetId}
          onSelect={setPoseAssetId}
          isLoading={isPoseLoading}
          isError={isPoseError}
          onRetry={refetchPose}
          disabled={isSubmitting || sessionPending}
        />
      </div>

      {/* 生成参数 */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h3 className="font-semibold">{t('promptSectionTitle')}</h3>

        <div className="space-y-2">
          <label className="text-sm font-medium">{t('promptLabel')}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isSubmitting || sessionPending}
            placeholder={t('promptPlaceholder')}
            maxLength={5000}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
          />
          <div className="text-right text-xs text-muted-foreground">
            {t('promptCounter', { count: prompt.length, max: 5000 })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('sizeLabel')}</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              disabled={isSubmitting || sessionPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              <option value="auto">{t('sizes.auto')}</option>
              <option value="1024x1024">{t('sizes.square')}</option>
              <option value="1024x1536">{t('sizes.portrait')}</option>
              <option value="1536x1024">{t('sizes.landscape')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('qualityLabel')}</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as any)}
              disabled={isSubmitting || sessionPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              <option value="auto">{t('qualities.auto')}</option>
              <option value="standard">{t('qualities.standard')}</option>
              <option value="high">{t('qualities.high')}</option>
            </select>
          </div>
        </div>

        {/* 模型选择 */}
        {models && models.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('modelLabel')}</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isSubmitting || sessionPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-50"
            >
              <option value="">-- 默认模型 --</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 提交按钮 */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground px-8 py-3 font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSubmitting
            ? uploadProgress
              ? `上传中 (${uploadProgress.current}/${uploadProgress.total})`
              : t('submitting')
            : t('submit')}
        </button>
      </div>

      {/* 任务状态 */}
      {taskId && taskStatus && (
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2">
            {taskStatus.status === 'pending' || taskStatus.status === 'processing' ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : null}
            <h3 className="font-semibold">
              {taskStatus.status === 'pending' && t('queued')}
              {taskStatus.status === 'processing' && t('processing')}
              {taskStatus.status === 'completed' && t('resultTitle')}
              {taskStatus.status === 'failed' && '生成失败'}
            </h3>
          </div>

          {taskStatus.status === 'completed' && taskStatus.outputFileId && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => router.push(`/${locale}/files`)}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm hover:border-foreground"
              >
                {t('download')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}